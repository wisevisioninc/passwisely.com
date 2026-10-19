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
  const filename = path.join(root, "electron/live", `${name}.ts`);
  const js = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(id => id.startsWith("./") ? load(id.slice(2)) : require(id), module, module.exports);
  modules.set(name, module.exports);
  return module.exports;
}
const { LiveSessionService } = load("LiveSessionService");
const completion = (text = "建议先确认需求。", model = "actual-model") => ({
  model, choices: [{ finish_reason: "stop", message: { content: text } }],
});
const segment = (id, text, overrides = {}) => ({ id, text, source: "system", isFinal: true, receivedAt: Date.now(), ...overrides });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settled(check) {
  for (let index = 0; index < 20; index++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail("service did not settle");
}
function fixture(context, overrides = {}) {
  const captures = [], uploads = [], streams = [], publications = [];
  const deps = {
    support: { supported: true },
    async createUpload(sessionId, signal) { uploads.push({ sessionId, signal }); return { uploadToken: "fixture-upload", apiUrl: "https://us-west-2.recall.ai" }; },
    createCapture(callbacks) {
      const calls = [];
      const capture = {
        callbacks, calls,
        async start(upload) { calls.push(["start", upload]); callbacks.onState("recording"); },
        async pause() { calls.push(["pause"]); callbacks.onState("paused"); },
        async resume() { calls.push(["resume"]); callbacks.onState("recording"); },
        async stop() { calls.push(["stop"]); callbacks.onState("ended"); },
        async dispose() { calls.push(["dispose"]); },
      };
      captures.push(capture);
      return capture;
    },
    async stream(messages, signal, update) { streams.push({ messages, signal, update }); update("建议先确认需求。", "actual-model"); return completion(); },
    async images() { return []; },
    language() { return "zh-CN"; },
    publish(snapshot) { publications.push(snapshot); },
    ...overrides,
  };
  const service = new LiveSessionService(deps);
  context.after(() => service.dispose());
  return { service, deps, captures, uploads, streams, publications };
}

test("session replaces partials with final text and preserves both capture sources through pause, resume and stop", async context => {
  const f = fixture(context);
  assert.equal((await f.service.start()).success, true);
  const callbacks = f.captures[0].callbacks;
  callbacks.onTranscript(segment("system-1", "远端临时", { isFinal: false }));
  callbacks.onTranscript(segment("microphone-1", "本地临时", { source: "microphone", isFinal: false }));
  callbacks.onTranscript(segment("system-1", "远端最终"));
  callbacks.onTranscript(segment("microphone-1", "本地最终", { source: "microphone" }));
  assert.deepEqual(f.service.getSnapshot().transcripts.map(item => [item.source, item.text, item.isFinal]), [
    ["system", "远端最终", true], ["microphone", "本地最终", true],
  ]);
  assert.equal((await f.service.pause()).success, true);
  assert.equal(f.service.getSnapshot().captureStatus, "paused");
  assert.equal((await f.service.resume()).success, true);
  assert.equal(f.service.getSnapshot().captureStatus, "recording");
  assert.equal((await f.service.stop()).success, true);
  const ended = f.service.getSnapshot();
  assert.equal(ended.captureStatus, "ended");
  assert.equal(ended.captureNeedsCleanup, false);
  assert.equal(ended.transcripts.length, 2);
  assert.ok(ended.startedAt <= ended.endedAt);
  assert.deepEqual(f.captures[0].calls.map(([name]) => name), ["start", "pause", "resume", "stop", "dispose"]);
});

test("stopping during upload creation cancels startup and suppresses an eventual upload response", async context => {
  const upload = deferred();
  let uploadSignal;
  const f = fixture(context, { createUpload(_sessionId, signal) { uploadSignal = signal; return upload.promise; } });
  const starting = f.service.start();
  assert.equal(f.service.getSnapshot().captureStatus, "starting");
  assert.equal((await f.service.stop()).success, true);
  assert.equal(uploadSignal.aborted, true);
  upload.resolve({ uploadToken: "late-upload", apiUrl: "https://us-west-2.recall.ai" });
  assert.equal((await starting).success, false);
  assert.equal(f.captures.length, 0);
  assert.equal(f.service.getSnapshot().captureStatus, "ended");
});

test("stopping while native startup is pending cleans the owned capture and rejects late startup events", async context => {
  const f = fixture(context);
  const originalFactory = f.deps.createCapture;
  const nativeStart = deferred();
  f.deps.createCapture = callbacks => {
    const capture = originalFactory(callbacks);
    capture.start = async () => { await nativeStart.promise; callbacks.onState("recording"); };
    return capture;
  };
  const starting = f.service.start();
  await settled(() => f.captures.length === 1);
  assert.equal((await f.service.stop()).success, true);
  nativeStart.resolve();
  assert.equal((await starting).success, false);
  f.captures[0].callbacks.onTranscript(segment("late", "迟到文字"));
  assert.equal(f.service.getSnapshot().captureStatus, "ended");
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, false);
  assert.deepEqual(f.service.getSnapshot().transcripts, []);
});

test("SDK-ended capture stays owned until explicit cleanup, then a fresh session ignores old events", async context => {
  const f = fixture(context);
  await f.service.start();
  const old = f.captures[0].callbacks;
  old.onTranscript(segment("kept", "保留的对话"));
  old.onState("ended");
  const ended = f.service.getSnapshot();
  assert.equal(ended.captureStatus, "ended");
  assert.equal(ended.captureNeedsCleanup, true);
  assert.equal((await f.service.start()).success, false);
  assert.equal((await f.service.stop()).success, true);
  assert.equal((await f.service.start()).success, true);
  const fresh = f.service.getSnapshot();
  assert.notEqual(fresh.sessionId, ended.sessionId);
  old.onTranscript(segment("stale", "旧会话文字")); old.onState("error"); old.onError("旧会话错误");
  assert.equal(f.service.getSnapshot().captureStatus, "recording");
  assert.deepEqual(f.service.getSnapshot().transcripts, []);
  assert.equal(f.service.getSnapshot().error, undefined);
  assert.ok(f.service.getSnapshot().revision > ended.revision);
});

test("failed disposal retains ownership and stop can retry cleanup", async context => {
  const f = fixture(context);
  await f.service.start();
  let attempts = 0;
  f.captures[0].dispose = async () => { if (++attempts === 1) throw new Error("fixture cleanup failure"); };
  const first = await f.service.stop();
  assert.equal(first.success, false);
  assert.match(first.error, /cleanup failure/);
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, true);
  assert.equal(f.service.getSnapshot().captureStatus, "error");
  assert.equal((await f.service.start()).success, false);
  assert.equal((await f.service.stop()).success, true);
  assert.equal(attempts, 2);
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, false);
});

test("cancel then new answer cannot receive late text or completion from the old request", async context => {
  const pending = [];
  const f = fixture(context, { stream(messages, signal, update) {
    const result = deferred(); pending.push({ ...result, messages, signal, update }); return result.promise;
  } });
  const first = await f.service.ask({ question: "第一个问题", includeScreenshots: false });
  pending[0].update("已生成首段", "first-model");
  f.service.cancelAnswer();
  assert.equal(pending[0].signal.aborted, true);
  const second = await f.service.ask({ question: "第二个问题", includeScreenshots: false });
  pending[0].update("旧请求迟到内容", "stale-model");
  pending[0].resolve(completion("旧请求最终内容", "stale-model"));
  pending[1].update("新回答", "new-model");
  pending[1].resolve(completion("新回答最终内容", "new-model"));
  await settled(() => f.service.getSnapshot().answers.at(-1).status === "completed");
  const answers = f.service.getSnapshot().answers;
  assert.equal(answers[0].id, first.requestId);
  assert.equal(answers[0].status, "cancelled");
  assert.equal(answers[0].text, "已生成首段");
  assert.equal(answers[1].id, second.requestId);
  assert.equal(answers[1].text, "新回答最终内容");
  assert.equal(answers[1].model, "new-model");
});

test("question, screenshot and final transcript use the request snapshot while screenshots load", async context => {
  const images = deferred();
  const f = fixture(context, { images() { return images.promise; } });
  await f.service.start();
  const callbacks = f.captures[0].callbacks;
  callbacks.onTranscript(segment("initial", "请求发出前的最终转录"));
  callbacks.onTranscript(segment("partial", "请求发出前的临时转录", { isFinal: false }));
  const asked = await f.service.ask({ question: "结合图和对话回答", includeScreenshots: true });
  assert.equal(asked.success, true);
  callbacks.onTranscript(segment("later", "截图等待期间的新转录"));
  images.resolve(["data:image/jpeg;base64,ZmFrZQ=="]);
  await settled(() => f.service.getSnapshot().answers[0].status === "completed");
  const body = JSON.stringify(f.streams[0].messages);
  assert.match(body, /请求发出前的最终转录/);
  assert.match(body, /结合图和对话回答/);
  assert.match(body, /data:image\/jpeg;base64,ZmFrZQ==/);
  assert.doesNotMatch(body, /临时转录|截图等待期间的新转录/);
  assert.equal(f.service.getSnapshot().answers[0].screenshotCount, 1);
});

test("cancelling while screenshots load prevents a late image from starting a model request", async context => {
  const images = deferred();
  const f = fixture(context, { images() { return images.promise; } });
  await f.service.ask({ question: "带截图的问题", includeScreenshots: true });
  f.service.cancelAnswer();
  await f.service.ask({ question: "新的纯文本问题", includeScreenshots: false });
  await settled(() => f.service.getSnapshot().answers.at(-1).status === "completed");
  images.resolve(["data:image/jpeg;base64,ZmFrZQ=="]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.streams.length, 1);
  const answers = f.service.getSnapshot().answers;
  assert.equal(answers[0].status, "cancelled");
  assert.equal(answers[0].text, "");
  assert.equal(answers[1].status, "completed");
  assert.match(JSON.stringify(f.streams[0].messages), /新的纯文本问题/);
  assert.doesNotMatch(JSON.stringify(f.streams[0].messages), /data:image/);
});

test("retained transcript count, UTF-8 text and answer history remain bounded", async context => {
  const f = fixture(context);
  await f.service.start();
  const callbacks = f.captures[0].callbacks;
  for (let index = 0; index < 600; index++) callbacks.onTranscript(segment(`small-${index}`, "短句"));
  assert.equal(f.service.getSnapshot().transcripts.length, 500);
  for (let index = 0; index < 40; index++) callbacks.onTranscript(segment(`large-${index}`, "中文😀".repeat(10_000)));
  let snapshot = f.service.getSnapshot();
  assert.ok(snapshot.transcripts.every(item => Buffer.byteLength(item.text) <= 16 * 1024));
  assert.ok(snapshot.transcripts.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0) <= 128 * 1024);
  assert.ok(snapshot.transcripts.every(item => !item.text.includes("\uFFFD")));
  assert.equal(snapshot.transcriptTruncated, true);
  for (let index = 0; index < 15; index++) {
    assert.equal((await f.service.ask({ question: `问题${index}`, includeScreenshots: false })).success, true);
    await settled(() => f.service.getSnapshot().answers.at(-1).status === "completed");
  }
  snapshot = f.service.getSnapshot();
  assert.equal(snapshot.answers.length, 12);
  assert.equal(snapshot.answers[0].question, "问题3");
});

test("published revisions are globally increasing across resets and snapshots are defensive copies", async context => {
  const f = fixture(context);
  await f.service.start();
  f.captures[0].callbacks.onTranscript(segment("one", "原始文字"));
  const copy = f.service.getSnapshot();
  copy.transcripts[0].text = "外部修改";
  assert.equal(f.service.getSnapshot().transcripts[0].text, "原始文字");
  await f.service.pause(); await f.service.resume();
  const previous = f.service.getSnapshot();
  await f.service.reset();
  assert.notEqual(f.service.getSnapshot().sessionId, previous.sessionId);
  assert.ok(f.service.getSnapshot().revision > previous.revision);
  for (let index = 1; index < f.publications.length; index++) assert.ok(f.publications[index].revision > f.publications[index - 1].revision);
});

test("a corrected final utterance replaces the earlier final text with the same identity", async context => {
  const f = fixture(context);
  await f.service.start();
  const callbacks = f.captures[0].callbacks;
  callbacks.onTranscript(segment("utterance-1", "Kimi Key", { receivedAt: 1 }));
  callbacks.onTranscript(segment("utterance-1", "Kimi K3", { receivedAt: 2 }));
  callbacks.onTranscript(segment("utterance-1", "更早但迟到的最终文本", { receivedAt: 1 }));
  callbacks.onTranscript(segment("utterance-1", "最终文本之后的临时文本", { isFinal: false, receivedAt: 3 }));
  assert.deepEqual(f.service.getSnapshot().transcripts.map(item => item.text), ["Kimi K3"]);
});

test("a completion cannot bypass the 128 KiB answer budget when it skips stream updates", async context => {
  const f = fixture(context, { async stream() { return completion("a".repeat(128 * 1024 + 1)); } });
  await f.service.ask({ question: "普通问题", includeScreenshots: false });
  await settled(() => ["completed", "cancelled", "error"].includes(f.service.getSnapshot().answers[0].status));
  const answer = f.service.getSnapshot().answers[0];
  assert.ok(Buffer.byteLength(answer.text) <= 128 * 1024);
  assert.notEqual(answer.status, "completed");
});

test("oversized transcript metadata cannot make retained snapshots unbounded", async context => {
  const f = fixture(context);
  await f.service.start();
  f.captures[0].callbacks.onTranscript(segment("metadata", "正常短文本", { speaker: "x".repeat(2 * 1024 * 1024), participantId: "y".repeat(2 * 1024 * 1024) }));
  // Generous allowance beyond the 128 KiB text budget for source, identity and
  // timing metadata. A single label must not add multiple MiB to every clone.
  assert.ok(Buffer.byteLength(JSON.stringify(f.service.getSnapshot().transcripts)) <= 1024 * 1024);
  assert.equal(f.service.getSnapshot().transcriptTruncated, true);
});
