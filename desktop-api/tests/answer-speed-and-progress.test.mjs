import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const production = createProductionTsLoader({ env: {}, mocks: {
  electron: { app: { getAppPath: () => root, getVersion: () => "fixture" } },
  dotenv: { config() {} },
} });
const load = name => production(fileURLToPath(new URL(`../../electron/${name}.ts`, import.meta.url)));
const { ProcessingHelper } = load("ProcessingHelper");
const { WiseGrpcClient } = load("WiseGrpcClient");

function fixture({ route = "wise", answerSpeed = "standard", model = "kimi-k3.1-pro" } = {}) {
  const events = [];
  const helper = new ProcessingHelper({ getScreenshotHelper: () => ({}), getWiseAccessToken: () => "session-token",
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (event, value) => events.push({ event, value }), executeJavaScript: async () => "python" } }),
    setHasDebugged() {}, setProblemInfo() {} });
  helper.config = { route, provider: "kimi", providerLabel: "Kimi / Moonshot", model, apiKey: "", supportsVision: true, supportsJsonMode: true, responseLanguage: "zh-CN", answerSpeed, usesWiseDefaultKey: true };
  helper.openaiClient = {}; // helpers require an initialised client before choosing a route
  return { helper, events };
}
const answer = { code: "class Solution:\n    pass", time_complexity: "O(n)", space_complexity: "O(1)", thoughts: ["一次遍历。"], alternatives: [] };
const complete = JSON.stringify(answer);
const finished = (content = complete) => ({ model: "actual-model", choices: [{ finish_reason: "stop", message: { content } }] });
const body = { model: "kimi-k3.1-pro", messages: [{ role: "user", content: "合成题目" }] };

test("fast answer speed skips Kimi K3 reasoning on both routes; standard keeps the low default", async () => {
  for (const [answerSpeed, expected] of [["standard", "low"], ["fast", "none"], [undefined, "low"]]) {
    const grpc = fixture({ answerSpeed }); let seen;
    grpc.helper.wiseGrpcClient = { async streamChat(request, _options, update) { seen = request; update(complete, "actual-model"); return finished(); } };
    await grpc.helper.createSolutionCompletion(body, new AbortController().signal);
    assert.equal(seen.reasoning_effort, expected, `grpc ${answerSpeed}`);

    const http = fixture({ route: "direct", answerSpeed }); const calls = [];
    http.helper.openaiClient = { chat: { completions: { async create(request) { calls.push(request);
      return (async function* () { yield { choices: [{ delta: { content: complete }, finish_reason: "stop" }] }; })(); } } } };
    await http.helper.createSolutionCompletion(body, new AbortController().signal);
    assert.equal(calls[0].reasoning_effort, expected, `http ${answerSpeed}`);
  }
});

test("fast answer speed leaves models without the K3 contract untouched", async () => {
  const f = fixture({ answerSpeed: "fast", model: "moonshot-v1-8k" }); let seen;
  f.helper.wiseGrpcClient = { async streamChat(request, _options, update) { seen = request; update(complete, "actual-model"); return finished(); } };
  await f.helper.createSolutionCompletion({ ...body, model: "moonshot-v1-8k", temperature: 0.2 }, new AbortController().signal);
  assert.equal(seen.reasoning_effort, undefined);
  assert.equal(seen.temperature, 0.2);
});

test("hidden reasoning is reported as progress until the first visible content", async () => {
  const f = fixture();
  f.helper.wiseGrpcClient = { async streamChat(_request, options, update) {
    options.onThinking(1); options.onThinking(2); options.onThinking(3);
    update('{"code":"class', "actual-model");
    options.onThinking(4); // late reasoning chunk must not overwrite visible content
    update(complete, "actual-model");
    return finished();
  } };
  await f.helper.createSolutionCompletion(body, new AbortController().signal, "request-1");
  const progress = f.events.filter(e => e.event === "solution-progress").map(e => e.value);
  assert.deepEqual(progress[0], { requestId: "request-1", phase: "initial", data: {}, model: "kimi-k3.1-pro", thinking: 1 });
  const thinking = progress.filter(p => p.thinking);
  assert.equal(thinking.length, 1, "bursts inside the throttle window collapse into one update");
  const firstContent = progress.findIndex(p => p.data.code);
  assert.ok(firstContent > 0);
  assert.ok(progress.slice(firstContent).every(p => !p.thinking));
  assert.equal(progress.at(-1).data.code, answer.code);
});

test("the HTTPS stream reports reasoning chunks the same way", async () => {
  const f = fixture({ route: "direct" });
  f.helper.openaiClient = { chat: { completions: { async create() { return (async function* () {
    yield { choices: [{ delta: { reasoning_content: "思考" } }] };
    yield { choices: [{ delta: { reasoning_content: "继续" } }] };
    yield { choices: [{ delta: { content: complete }, finish_reason: "stop" }] };
  })(); } } } };
  await f.helper.createSolutionCompletion(body, new AbortController().signal);
  const progress = f.events.filter(e => e.event === "solution-progress").map(e => e.value);
  assert.equal(progress[0].thinking, 1);
  assert.equal(progress.at(-1).data.code, answer.code);
});

test("a stream that drops after the code closed keeps the finished fields and says so", async () => {
  const f = fixture();
  const cut = complete.slice(0, complete.indexOf('"thoughts"') + 14);
  f.helper.wiseGrpcClient = { async streamChat(_request, _options, update) { update(cut, "actual-model"); throw new Error("Connection dropped"); } };
  const completion = await f.helper.createSolutionCompletion(body, new AbortController().signal);
  assert.equal(completion.choices[0].finish_reason, "stop");
  assert.deepEqual(JSON.parse(completion.choices[0].message.content), { code: answer.code, time_complexity: "O(n)", space_complexity: "O(1)" });
  const result = await f.helper.generateSolutionsHelper("合成题面", "", new AbortController().signal);
  assert.equal(result.success, true);
  assert.equal(result.data.code, answer.code);
  assert.match(result.data.notice, /连接中途中断/);
});

test("a drop before the code is complete, or a user cancel, still fails", async () => {
  const f = fixture();
  f.helper.wiseGrpcClient = { async streamChat(_request, _options, update) { update('{"code":"class Solution:', "actual-model"); throw new Error("Connection dropped"); } };
  await assert.rejects(f.helper.createSolutionCompletion(body, new AbortController().signal), /Connection dropped/);
  const cancelled = fixture(); const controller = new AbortController();
  cancelled.helper.wiseGrpcClient = { async streamChat(_request, _options, update) { update(complete.slice(0, -1), "actual-model"); controller.abort(); throw new Error("cancelled"); } };
  await assert.rejects(cancelled.helper.createSolutionCompletion(body, controller.signal));
});

test("a complete answer carries no interruption notice", async () => {
  const f = fixture();
  f.helper.wiseGrpcClient = { async streamChat(_request, _options, update) { update(complete, "actual-model"); return finished(); } };
  const result = await f.helper.generateSolutionsHelper("合成题面", "", new AbortController().signal);
  assert.equal(result.success, true);
  assert.equal("notice" in result.data, false);
});

test("the Wise channel is warmed at most once per 20 seconds and never on the direct route", () => {
  const f = fixture(); let warmed = 0;
  f.helper.wiseGrpcClient = { warmUp: async () => { warmed++; return true; } };
  f.helper.warmUpTransport(); f.helper.warmUpTransport();
  assert.equal(warmed, 1);
  f.helper.lastTransportWarmUpAt = Date.now() - 21_000;
  f.helper.warmUpTransport();
  assert.equal(warmed, 2);
  const direct = fixture({ route: "direct" }); let directWarmed = 0;
  direct.helper.wiseGrpcClient = { warmUp: async () => { directWarmed++; return true; } };
  direct.helper.warmUpTransport();
  assert.equal(directWarmed, 0);
});

test("the gRPC client sends the reasoning level, counts empty deltas as thinking and warms via Health", async () => {
  const client = new WiseGrpcClient(); let request;
  const call = new EventEmitter(); call.cancel = () => {};
  client.client.ChatStream = (sent) => { request = sent; return call; };
  let healthCalls = 0;
  client.client.Health = (_request, _metadata, _options, callback) => { healthCalls++; callback(null, { status: "SERVING" }); };
  const thinking = [], content = [];
  const pending = client.streamChat({ ...body, reasoning_effort: "none", max_tokens: 4096 },
    { signal: new AbortController().signal, token: "session-token", provider: "kimi", requestId: "request-1", onThinking: n => thinking.push(n) },
    text => content.push(text));
  assert.equal(request.reasoningEffort, "none");
  call.emit("data", { delta: "" }); call.emit("data", { delta: "" });
  call.emit("data", { delta: "答案" });
  call.emit("data", { delta: "" }); // after content: not thinking
  call.emit("data", { delta: "", finishReason: "stop", totalTokens: 3 });
  call.emit("data", { done: true });
  call.emit("end");
  const result = await pending;
  assert.deepEqual(thinking, [1, 2]);
  assert.deepEqual(content, ["答案"]);
  assert.equal(result.choices[0].message.content, "答案");
  assert.equal(await client.warmUp(), true);
  assert.equal(healthCalls, 1);
  client.client.Health = () => { throw new Error("channel closed"); };
  assert.equal(await client.warmUp(), false);
  client.close();
});
