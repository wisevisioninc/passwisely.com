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
  const filename = path.join(root, "electron", name + ".ts");
  const js = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(id => {
    if (id === "electron") return { app: { getAppPath: () => root, getVersion: () => "fixture" } };
    if (id.startsWith("./")) return load(id.slice(2));
    return require(id);
  }, module, module.exports);
  modules.set(name, module.exports); return module.exports;
}
const { ProcessingHelper } = load("ProcessingHelper");
const { WiseGrpcError } = load("WiseGrpcClient");
function fixture() {
  const events = [];
  const helper = new ProcessingHelper({ getScreenshotHelper: () => ({}), getWiseAccessToken: () => "fixture",
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (event, value) => events.push({ event, value }) } }) });
  helper.config = { route: "wise", provider: "kimi" };
  return { helper, events };
}
const body = { model: "fixture", messages: [] };

test("desktop sends partial JSON to renderer before complete response", async () => {
  const f = fixture(); let release;
  const gate = new Promise(r => { release = r; });
  const complete = JSON.stringify({ thoughts: ["先遍历"], code: 'print("\\n")' });
  f.helper.wiseGrpcClient = { async streamChat(_body, _options, update) {
    update('{"thoughts":["先遍历', "actual-model"); await gate;
    update(complete, "actual-model");
    return { choices: [{ finish_reason: "stop", message: { content: complete } }] };
  } };
  const result = f.helper.createSolutionCompletion(body, new AbortController().signal);
  assert.deepEqual(f.events[0].value.data.thoughts, ["先遍历"]);
  assert.equal(f.events[0].value.model, "actual-model");
  release(); await result;
  assert.equal(f.events.at(-1).value.data.code, 'print("\\n")');
});

test("desktop only falls back for unsupported RPC before any output", async () => {
  for (const scenario of ["unsupported", "partial", "unavailable"]) {
    const f = fixture(); let httpCalls = 0;
    f.helper.wiseGrpcClient = { async streamChat(_b, _o, update) {
      if (scenario === "partial") update('{"thoughts":["已有内容', "fixture");
      throw new WiseGrpcError("fixture failure", scenario === "unavailable" ? 14 : 12);
    } };
    f.helper.openaiClient = { chat: { completions: { async create(request, options) {
      httpCalls++; assert.equal(request.stream, true); assert.equal(options.maxRetries, 0);
      return (async function* () { yield { choices: [{ delta: { content: '{"code":"ok"}' }, finish_reason: "stop" }] }; })();
    } } } };
    const result = f.helper.createSolutionCompletion(body, new AbortController().signal);
    if (scenario === "unsupported") await result; else await assert.rejects(result, /fixture failure/);
    assert.equal(httpCalls, scenario === "unsupported" ? 1 : 0);
  }
});

test("desktop rejects token-limit truncation and suppresses late preview after abort", async () => {
  const f = fixture(), controller = new AbortController();
  f.helper.wiseGrpcClient = { async streamChat(_b, _o, update) {
    update('{"code":"half', "fixture"); return { choices: [{ finish_reason: "length" }] };
  } };
  await assert.rejects(f.helper.createSolutionCompletion(body, controller.signal), /未完整生成/);
  f.events.length = 0;
  f.helper.wiseGrpcClient = { async streamChat(_b, _o, update) {
    controller.abort(); update('{"code":"stale', "fixture"); controller.signal.throwIfAborted();
  } };
  await assert.rejects(f.helper.createSolutionCompletion(body, controller.signal));
  assert.equal(f.events.length, 0);
});
