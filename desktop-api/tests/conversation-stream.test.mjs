import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const filename = path.join(root, "electron", `${name}.ts`);
  const js = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(id => {
    if (id === "electron") return { app: { getAppPath: () => root, getVersion: () => "fixture" } };
    if (id.startsWith("./")) return load(id.slice(2));
    return require(id);
  }, module, module.exports);
  modules.set(name, module.exports);
  return module.exports;
}
const { ProcessingHelper } = load("ProcessingHelper");
const { WiseGrpcError } = load("WiseGrpcClient");
const messages = [{ role: "user", content: "请根据刚才的对话回答。" }];
const completion = (text = "建议先确认需求。", finish = "stop") => ({
  model: "actual-model", choices: [{ finish_reason: finish, message: { content: text } }],
});
function fixture(route = "direct") {
  const helper = new ProcessingHelper({
    getScreenshotHelper: () => ({}), getWiseAccessToken: () => "session-token",
    getMainWindow: () => null, setHasDebugged() {}, setProblemInfo() {},
  });
  helper.config = {
    route, provider: "kimi", providerLabel: "Kimi / Moonshot", model: "kimi-k3",
    apiKey: "fixture-key", supportsVision: true, responseLanguage: "zh-CN",
  };
  const calls = [];
  helper.openaiClient = { chat: { completions: { async create(body, options) {
    calls.push({ body, options });
    return (async function* () {
      yield { model: "actual-model", choices: [{ delta: { content: "建议" } }] };
      yield { model: "actual-model", choices: [{ delta: { content: "先确认需求。" }, finish_reason: "stop" }] };
    })();
  } } } };
  return { helper, calls };
}

test("conversation streams ordinary multimodal text through the direct route without JSON/code requirements", async () => {
  const { helper, calls } = fixture();
  const mixed = [{ role: "user", content: [
    { type: "text", text: "请结合对话与这张图回答。" },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,ZmFrZQ==" } },
  ] }];
  const updates = [];
  const result = await helper.streamConversation(mixed, new AbortController().signal,
    (text, model) => updates.push({ text, model }));
  assert.equal(result.choices[0].message.content, "建议先确认需求。");
  assert.deepEqual(updates.map(item => item.text), ["建议", "建议先确认需求。"]);
  assert.ok(updates.every(item => item.model === "actual-model"));
  assert.deepEqual(calls[0].body.messages, mixed);
  assert.equal(calls[0].body.response_format, undefined);
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.temperature, 0.6);
  assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
  assert.equal(calls[0].options.maxRetries, 0);
  assert.equal(calls[0].options.timeout, 90_000);
  assert.equal(helper.activeStreamControllers.size, 0);
});

test("conversation reuses Wise stream and current account token, preserving its actual model", async () => {
  const { helper, calls } = fixture("wise");
  helper.wiseGrpcClient = { async streamChat(body, options, update) {
    assert.deepEqual(body.messages, messages);
    assert.equal(body.response_format, undefined);
    assert.equal(options.token, "session-token");
    assert.equal(options.provider, "kimi");
    assert.equal(options.providerApiKey, "fixture-key");
    assert.match(options.requestId, /^[a-f0-9-]{36}$/);
    update("建议先确认需求。", "actual-model");
    return completion();
  } };
  const updates = [];
  const result = await helper.streamConversation(messages, new AbortController().signal,
    (text, model) => updates.push({ text, model }));
  assert.equal(result.model, "actual-model");
  assert.deepEqual(updates, [{ text: "建议先确认需求。", model: "actual-model" }]);
  assert.equal(calls.length, 0);
});

test("Wise authentication failures request account validation; personal provider failures do not invalidate the desktop account", async () => {
  for (const route of ["wise", "direct"]) {
    const { helper } = fixture(route);
    let validations = 0;
    helper.deps.onAuthenticationFailure = () => { validations++; };
    if (route === "wise") helper.wiseGrpcClient = { async streamChat() { throw new WiseGrpcError("fixture authentication failure", 16, 401); } };
    else helper.openaiClient.chat.completions.create = async () => { throw new WiseGrpcError("fixture provider failure", 16, 401); };
    await assert.rejects(helper.streamConversation(messages, new AbortController().signal, () => {}), /fixture/);
    assert.equal(validations, route === "wise" ? 1 : 0);
  }
});

test("conversation retries only unsupported Wise RPC before content, never a partial response or disconnect", async () => {
  for (const scenario of ["unsupported", "partial", "unavailable"]) {
    const { helper, calls } = fixture("wise");
    helper.wiseGrpcClient = { async streamChat(_body, _options, update) {
      if (scenario === "partial") update("已生成", "actual-model");
      throw new WiseGrpcError("fixture failure", scenario === "unavailable" ? 14 : 12);
    } };
    const result = helper.streamConversation(messages, new AbortController().signal, () => {});
    if (scenario === "unsupported") await result;
    else await assert.rejects(result, /fixture failure/);
    assert.equal(calls.length, scenario === "unsupported" ? 1 : 0);
    if (calls.length) assert.ok(calls[0].options.headers["x-wise-request-id"]);
  }
});

test("conversation checks model/key readiness before sending context", async () => {
  const { helper, calls } = fixture();
  helper.config.supportsVision = false;
  await assert.rejects(helper.streamConversation([{ role: "user", content: [
    { type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } },
  ] }], new AbortController().signal, () => {}), /text-only/);
  helper.openaiClient = null;
  await assert.rejects(helper.streamConversation(messages, new AbortController().signal, () => {}), /not initialized/);
  assert.equal(calls.length, 0);
  const signedOut = fixture("wise");
  signedOut.helper.deps.getWiseAccessToken = () => "";
  await assert.rejects(signedOut.helper.streamConversation(messages, new AbortController().signal, () => {}), /sign in/);
  assert.equal(signedOut.calls.length, 0);
});

test("cancelled conversation suppresses late transport callbacks and releases its controller", async () => {
  const { helper } = fixture("wise");
  const controller = new AbortController();
  const updates = [];
  helper.wiseGrpcClient = { async streamChat(_body, options, update) {
    update("首段", "actual-model");
    controller.abort();
    assert.equal(options.signal.aborted, true);
    update("首段和迟到内容", "actual-model");
    return completion();
  } };
  await assert.rejects(helper.streamConversation(messages, controller.signal, text => updates.push(text)), { name: "AbortError" });
  assert.deepEqual(updates, ["首段"]);
  assert.equal(helper.activeStreamControllers.size, 0);
});

test("settings change and global cancellation abort active conversations without fallback", async () => {
  for (const action of ["configure", "cancel"]) {
    const { helper, calls } = fixture("wise");
    let lateUpdate, transportSignal, closed = false, release;
    const gate = new Promise(resolve => { release = resolve; });
    helper.wiseGrpcClient = { close() { closed = true; }, async streamChat(_body, options, update) {
      lateUpdate = update;
      transportSignal = options.signal;
      await gate;
      update("旧配置结果", "old-model");
      return completion();
    } };
    const updates = [];
    const pending = helper.streamConversation(messages, new AbortController().signal, text => updates.push(text));
    if (action === "configure") {
      helper.initializeAIClient = () => {};
      helper.configure({ ...helper.config, model: "next-model" });
      assert.equal(closed, true);
    } else helper.cancelOngoingRequests();
    assert.equal(transportSignal.aborted, true);
    assert.throws(() => lateUpdate("迟到内容", "old-model"), { name: "AbortError" });
    release();
    await assert.rejects(pending, { name: "AbortError" });
    assert.deepEqual(updates, []);
    assert.equal(calls.length, 0);
    assert.equal(helper.activeStreamControllers.size, 0);
  }
});

test("conversation rejects truncated and oversized output while preserving prior preview", async () => {
  for (const oversized of [false, true]) {
    const { helper } = fixture("wise");
    const updates = [];
    helper.wiseGrpcClient = { async streamChat(_body, _options, update) {
      update("首段", "actual-model");
      if (oversized) update("a".repeat(12 * 1024 * 1024 + 1), "actual-model");
      return completion("首段", "length");
    } };
    await assert.rejects(helper.streamConversation(messages, new AbortController().signal, text => updates.push(text)),
      oversized ? /响应过大/ : /未完整生成/);
    assert.deepEqual(updates, ["首段"]);
  }
});

test("conversation deadline aborts the shared transport and releases resources", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { helper } = fixture("wise");
  helper.wiseGrpcClient = { async streamChat(_body, options) {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  } };
  const result = helper.streamConversation(messages, new AbortController().signal, () => {});
  const rejected = assert.rejects(result, /模型请求超时/);
  context.mock.timers.tick(90_000);
  await rejected;
  assert.equal(helper.activeStreamControllers.size, 0);
});
