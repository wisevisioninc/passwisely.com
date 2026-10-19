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
  new Function("require", "module", "exports", js)(id => id.startsWith(".") ? load(path.join(path.dirname(name), id)) : require(id), module, module.exports);
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
  const captures = [], uploads = [], streams = [], publications = [], consumed = [];
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
    pendingScreenshots() { return ["fixture-main.png"]; },
    async images() { return ["data:image/jpeg;base64,ZmFrZQ=="]; },
    async consumeScreenshots(paths, signal) { consumed.push({ paths: [...paths], signal }); return { success: true }; },
    language() { return "zh-CN"; },
    publish(snapshot) { publications.push(snapshot); },
    ...overrides,
  };
  const service = new LiveSessionService(deps);
  context.after(() => service.dispose());
  return { service, deps, captures, uploads, streams, publications, consumed };
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

test("Start Over preserves an active or paused capture and incoming transcript while clearing answers only after Trash succeeds", async context => {
  for (const paused of [false, true]) {
    const trash = deferred();
    const f = fixture(context, { consumeScreenshots() { return trash.promise; } });
    await f.service.start();
    f.captures[0].callbacks.onTranscript(segment("before", "保留已有对话"));
    await f.service.ask({ question: "已有问题", includeScreenshots: false });
    await settled(() => f.service.getSnapshot().answers[0].status === "completed");
    if (paused) await f.service.pause();
    const before = f.service.getSnapshot();
    const clearing = f.service.startOver();
    assert.equal((await f.service.ask({ question: "等待清理", includeScreenshots: false })).success, false);
    assert.equal(f.service.getSnapshot().answers.length, 1);
    f.captures[0].callbacks.onTranscript(segment("during", "清理期间继续采集"));
    trash.resolve({ success: true });
    assert.equal((await clearing).success, true);
    const after = f.service.getSnapshot();
    assert.equal(after.sessionId, before.sessionId);
    assert.equal(after.captureStatus, paused ? "paused" : "recording");
    assert.deepEqual(after.transcripts.map(item => item.text), ["保留已有对话", "清理期间继续采集"]);
    assert.deepEqual(after.answers, []);
    assert.equal(f.captures[0].calls.some(([name]) => name === "stop" || name === "dispose"), false);
  }
});

test("Start Over clears stopped conversational context without losing an ended native capture that still needs cleanup", async context => {
  const f = fixture(context);
  await f.service.start();
  const old = f.captures[0].callbacks;
  old.onTranscript(segment("old", "结束前的文字"));
  old.onState("ended");
  const previous = f.service.getSnapshot();
  assert.equal((await f.service.startOver()).success, true);
  const after = f.service.getSnapshot();
  assert.equal(after.sessionId, previous.sessionId);
  assert.equal(after.transcripts.length, 0);
  assert.equal(after.captureStatus, "ended");
  assert.equal(after.captureNeedsCleanup, true);
  assert.equal(f.captures[0].calls.some(([name]) => name === "dispose"), false);
  old.onTranscript(segment("late", "不能恢复旧上下文")); old.onState("recording");
  assert.equal(f.service.getSnapshot().transcripts.length, 0);
  assert.equal(f.service.getSnapshot().captureStatus, "ended");
  assert.equal((await f.service.start()).success, false);
  assert.equal((await f.service.stop()).success, true);
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, false);
});

test("Start Over after failed native cleanup preserves its owner and reason until explicit stop retries", async context => {
  const f = fixture(context);
  await f.service.start();
  f.captures[0].callbacks.onTranscript(segment("old", "可清除上下文"));
  let disposals = 0;
  f.captures[0].dispose = async () => { if (++disposals === 1) throw new Error("owned native cleanup failed"); };
  assert.equal((await f.service.stop()).success, false);
  assert.equal((await f.service.startOver()).success, true);
  const after = f.service.getSnapshot();
  assert.equal(disposals, 1);
  assert.equal(after.captureNeedsCleanup, true);
  assert.equal(after.captureStatus, "error");
  assert.match(after.error, /owned native cleanup failed/);
  assert.deepEqual(after.transcripts, []);
  assert.equal((await f.service.stop()).success, true);
  assert.equal(disposals, 2);
});

test("failed Start Over retains answer and transcript evidence, reports Trash failure and allows retry", async context => {
  let fail = true;
  const f = fixture(context, { async consumeScreenshots() { return fail ? { success: false, error: "fixture Trash permission denied" } : { success: true }; } });
  await f.service.start();
  f.captures[0].callbacks.onTranscript(segment("kept", "保留现场"));
  await f.service.ask({ question: "不能丢的问题", includeScreenshots: false });
  await settled(() => f.service.getSnapshot().answers[0].status === "completed");
  const before = f.service.getSnapshot();
  const result = await f.service.startOver();
  assert.equal(result.success, false); assert.match(result.error, /Trash permission denied/);
  assert.deepEqual(f.service.getSnapshot().answers, before.answers);
  assert.deepEqual(f.service.getSnapshot().transcripts, before.transcripts);
  assert.equal(f.service.getSnapshot().sessionId, before.sessionId);
  assert.match(f.service.getSnapshot().screenshotError, /Trash permission denied/);
  fail = false;
  assert.equal((await f.service.startOver()).success, true);
  assert.equal(f.service.getSnapshot().answers.length, 0);
  assert.equal(f.service.getSnapshot().screenshotError, undefined);
});

test("late Start Over completion cannot clear a newly started session", async context => {
  const trash = deferred(); let signal;
  const f = fixture(context, { consumeScreenshots(_paths, operationSignal) { signal = operationSignal; return trash.promise; } });
  const clearing = f.service.startOver();
  await settled(() => !!signal);
  assert.equal((await f.service.start()).success, true);
  assert.equal(signal.aborted, true);
  f.captures[0].callbacks.onTranscript(segment("fresh", "新的会话文字"));
  await f.service.ask({ question: "新的问题", includeScreenshots: false });
  await settled(() => f.service.getSnapshot().answers[0].status === "completed");
  const fresh = f.service.getSnapshot();
  trash.resolve({ success: true });
  assert.equal((await clearing).success, false);
  assert.deepEqual(f.service.getSnapshot(), fresh);
});

test("the model and successful consumption use only the screenshot paths frozen before image loading", async context => {
  const imageResult = deferred(), pending = ["first.png"], prepared = [];
  const f = fixture(context, {
    pendingScreenshots: () => pending,
    images(paths, signal) { prepared.push({ paths: [...paths], signal }); return imageResult.promise; },
  });
  assert.equal((await f.service.ask({ question: "只发送当前图片", includeScreenshots: true })).success, true);
  pending.push("later.png");
  imageResult.resolve(["data:image/jpeg;base64,ZmFrZQ=="]);
  await settled(() => f.service.getSnapshot().answers[0].status === "completed");
  assert.deepEqual(prepared[0].paths, ["first.png"]);
  assert.deepEqual(f.consumed[0].paths, ["first.png"]);
  assert.equal(f.service.getSnapshot().answers[0].screenshotCount, 1);
});

test("image preparation and model failures before content do not consume pending screenshots", async context => {
  const failures = [
    { async images() { throw new Error("image preparation failed"); } },
    { async stream() { throw new Error("connection failed before response"); } },
    { async images() { return []; } },
  ];
  for (const overrides of failures) {
    const f = fixture(context, overrides);
    await f.service.ask({ question: "保留可重试截图", includeScreenshots: true });
    await settled(() => f.service.getSnapshot().answers[0].status === "error");
    assert.equal(f.consumed.length, 0);
  }
});

test("first real content consumes the accepted image snapshot once; Trash failure keeps a completed answer with a separate warning", async context => {
  const response = deferred(); let update;
  const f = fixture(context, {
    stream(_messages, _signal, content) { update = content; return response.promise; },
    async consumeScreenshots(paths) { f.consumed.push({ paths: [...paths] }); return { success: false, error: "Trash unavailable; pending files retained" }; },
  });
  await f.service.ask({ question: "图片回答", includeScreenshots: true });
  await settled(() => !!update);
  assert.equal(f.consumed.length, 0);
  update("first answer content", "fixture-model");
  await settled(() => f.consumed.length === 1);
  update("continued answer content", "fixture-model");
  response.resolve(completion("complete answer", "fixture-model"));
  await settled(() => f.service.getSnapshot().answers[0].status === "completed");
  assert.equal(f.consumed.length, 1);
  const state = f.service.getSnapshot();
  assert.equal(state.answers[0].text, "complete answer");
  assert.match(state.answers[0].screenshotCleanupError, /pending files retained/);
  assert.match(state.screenshotError, /Trash unavailable/);
});

test("cancelled image loading does not consume; an in-flight accepted-image cleanup prevents a second image request until settled", async context => {
  const images = deferred();
  const f = fixture(context, { images: () => images.promise });
  await f.service.ask({ question: "取消加载", includeScreenshots: true });
  f.service.cancelAnswer(); images.resolve(["data:image/jpeg;base64,ZmFrZQ=="]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.consumed.length, 0);

  const cleanup = deferred(), stream = deferred(); let update, signal;
  const g = fixture(context, {
    stream(_messages, _signal, content) { update = content; return stream.promise; },
    consumeScreenshots(_paths, operationSignal) { signal = operationSignal; return cleanup.promise; },
  });
  await g.service.ask({ question: "已提交图片", includeScreenshots: true });
  await settled(() => !!update);
  update("accepted", "fixture-model"); await settled(() => !!signal);
  g.service.cancelAnswer();
  assert.equal(signal.aborted, true);
  assert.equal((await g.service.ask({ question: "第二次图片", includeScreenshots: true })).success, false);
  cleanup.resolve({ success: false, error: "cancelled cleanup" }); stream.resolve(completion("late old answer"));
  await settled(() => g.service.getSnapshot().answers[0].status === "cancelled");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(g.service.getSnapshot().screenshotError, undefined);
  assert.equal(g.service.getSnapshot().answers[0].text, "accepted");
});

test("Start Over during upload preparation keeps startup owned and permits its eventual recording", async context => {
  const upload = deferred(); let uploadSignal;
  const f = fixture(context, { createUpload(_sessionId, signal) { uploadSignal = signal; return upload.promise; } });
  const starting = f.service.start();
  const previous = f.service.getSnapshot();
  assert.equal((await f.service.startOver()).success, true);
  assert.equal(uploadSignal.aborted, false);
  assert.equal(f.service.getSnapshot().sessionId, previous.sessionId);
  assert.equal(f.service.getSnapshot().captureStatus, "starting");
  upload.resolve({ uploadToken: "fixture-upload", apiUrl: "https://us-west-2.recall.ai" });
  assert.equal((await starting).success, true);
  f.captures[0].callbacks.onTranscript(segment("after", "继续采集"));
  assert.equal(f.service.getSnapshot().transcripts[0].text, "继续采集");
});

test("Start Over joins an accepted image cleanup and never consumes a screenshot added after the clear snapshot", async context => {
  const cleanup = deferred(), stream = deferred(), pending = ["accepted.png"], consumed = []; let update;
  const f = fixture(context, {
    pendingScreenshots: () => pending,
    stream(_messages, _signal, content) { update = content; return stream.promise; },
    async consumeScreenshots(paths, signal) {
      consumed.push([...paths]);
      if (consumed.length === 1) await cleanup.promise;
      // In-flight OS Trash can complete for the first file despite cancellation.
      for (const filename of paths) { const index = pending.indexOf(filename); if (index >= 0) pending.splice(index, 1); }
      return { success: true };
    },
  });
  await f.service.ask({ question: "首张图", includeScreenshots: true });
  await settled(() => !!update); update("accepted answer", "fixture-model");
  await settled(() => consumed.length === 1);
  const clearing = f.service.startOver();
  pending.push("later.png");
  cleanup.resolve(); stream.resolve(completion("stale completion"));
  assert.equal((await clearing).success, true);
  assert.deepEqual(consumed, [["accepted.png"]]);
  assert.deepEqual(pending, ["later.png"]);
  assert.deepEqual(f.service.getSnapshot().answers, []);
});
