import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const [captureSource, transcriptSource] = await Promise.all([
  readFile(new URL("../../electron/live/RecallCapture.ts", import.meta.url), "utf8"),
  readFile(new URL("../../electron/live/recallTranscript.ts", import.meta.url), "utf8"),
]);
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ platform = "win32", arch = "x64", release = platform === "win32" ? "10.0.22631" : "23.2.0" } = {}) {
  const callbacks = new Map();
  const calls = [];
  const states = [], transcripts = [], errors = [];
  const timers = new Set();
  let sourceId = 0, imports = 0;
  const emit = (event, value) => { for (const fn of [...(callbacks.get(event) || [])]) fn(value); };
  const sdk = {
    addEventListener(event, callback) { const entries = callbacks.get(event) || new Set(); entries.add(callback); callbacks.set(event, entries); },
    removeEventListener(event, callback) { callbacks.get(event)?.delete(callback); },
    async init(config) { calls.push(["init", config]); },
    async requestPermission(permission) { calls.push(["permission", permission]); emit("permission-status", { permission, status: "granted" }); },
    async prepareDesktopAudioRecording() { const id = `source-${++sourceId}`; calls.push(["prepare", id]); return id; },
    async startRecording(value) { calls.push(["start", value]); emit("recording-started", { window: { id: value.windowId } }); },
    async pauseRecording(value) { calls.push(["pause", value]); },
    async resumeRecording(value) { calls.push(["resume", value]); },
    async stopRecording(value) { calls.push(["stop", value]); emit("recording-ended", { window: { id: value.windowId } }); },
    async shutdown() { calls.push(["shutdown"]); emit("shutdown", { code: 0, signal: "" }); },
  };
  const dependencies = {
    "node:crypto": { createHash },
    "node:os": { release: () => release },
    "@recallai/desktop-sdk": sdk,
  };
  function load(code) {
    const exports = {};
    vm.runInNewContext(compile(code), {
      exports, Date, process: { platform, arch },
      require(name) { if (name === "@recallai/desktop-sdk") imports++; return dependencies[name]; },
      setTimeout(fn, ms) { const timer = { fn, ms }; timers.add(timer); return timer; },
      clearTimeout(timer) { timers.delete(timer); },
    });
    return exports;
  }
  dependencies["./TranscriptText"] = load(readFileSync(new URL("../../electron/live/TranscriptText.ts", import.meta.url), "utf8"));
  dependencies["./recallTranscript"] = load(transcriptSource);
  const { RecallCapture } = load(captureSource);
  const create = (extra = {}) => new RecallCapture({
    onState: s => { states.push(s); extra.onState?.(s); },
    onTranscript: s => { transcripts.push(s); extra.onTranscript?.(s); },
    onError: e => { errors.push(e); extra.onError?.(e); },
  });
  return { sdk, calls, states, transcripts, errors, emit, create, RecallCapture, imports: () => imports,
    expire(ms = 15_000) { for (const timer of [...timers]) if (timer.ms === ms) { timers.delete(timer); timer.fn(); } },
    listenerCount: () => [...callbacks.values()].reduce((n, set) => n + set.size, 0),
    normalizer: () => dependencies["./recallTranscript"].createRecallTranscriptNormalizer(),
  };
}
const input = { kind: "recall-upload", uploadToken: "fixture-upload-token", apiUrl: "https://ap-northeast-1.recall.ai" };
const event = (id, text = "hello", partial = false, participant = { id: 1, is_host: true }, start = 0) => ({
  window: { id }, event: partial ? "transcript.partial_data" : "transcript.data",
  data: { data: { words: [{ text, start_timestamp: { relative: start }, end_timestamp: { relative: start + 0.5 } }], participant } },
});

test("explicit mac permission preflight shares the SDK owner and never prepares a source, records or uploads", async () => {
  const h = harness({ platform: "darwin", arch: "arm64" }), capture = h.create();
  const initial = capture.getPermissionSnapshot();
  assert.equal(initial.microphone.status, "unknown"); assert.equal(initial.microphone.observedAt, undefined);
  assert.equal(h.imports(), 0); assert.deepEqual(h.calls, []);
  await capture.preparePermissions(new AbortController().signal, { recallApiUrl: input.apiUrl });
  assert.deepEqual(h.calls.map(call => call[0]), ["init", "permission", "permission", "permission"]);
  assert.equal(h.calls[0][1].apiUrl, input.apiUrl);
  const observed = capture.getPermissionSnapshot();
  for (const permission of ["microphone", "systemAudio", "accessibility"]) {
    assert.equal(observed[permission].status, "granted"); assert.equal(typeof observed[permission].observedAt, "number");
  }
  observed.microphone.status = "denied";
  assert.equal(capture.getPermissionSnapshot().microphone.status, "granted");
  await assert.rejects(h.create().preparePermissions(new AbortController().signal, { recallApiUrl: input.apiUrl }), /仍持有/);
  // A later real start reuses this owned process and its observed permissions.
  await capture.start(input);
  assert.equal(h.calls.filter(call => call[0] === "init").length, 1);
  await capture.dispose(); assert.equal(h.listenerCount(), 0);
});

test("permission preflight has no implicit Recall region and Windows never imports or initializes the SDK", async () => {
  for (const recallApiUrl of [undefined, "", "https://unknown.recall.ai", "https://us-west-2.recall.ai/", "https://sensitive.example/"]) {
    const h = harness({ platform: "darwin", arch: "arm64" }), capture = h.create();
    await assert.rejects(capture.preparePermissions(new AbortController().signal, { recallApiUrl }), /区域配置/);
    assert.equal(h.imports(), 0); assert.deepEqual(h.calls, []);
    await capture.dispose();
  }
  const h = harness(), capture = h.create();
  await capture.preparePermissions(new AbortController().signal, {});
  for (const permission of ["microphone", "systemAudio", "accessibility"]) assert.equal(capture.getPermissionSnapshot()[permission].status, "not-required");
  await capture.dispose(); assert.equal(h.imports(), 0); assert.deepEqual(h.calls, []);
});

test("permission request acknowledgement cannot grant access and preflight keeps exact refusal states", async () => {
  const h = harness({ platform: "darwin", arch: "arm64" }), capture = h.create();
  h.sdk.requestPermission = async () => undefined;
  const preparing = capture.preparePermissions(new AbortController().signal, { recallApiUrl: input.apiUrl });
  const rejected = assert.rejects(preparing, /60 秒/);
  await tick(); assert.equal(capture.getPermissionSnapshot().microphone.status, "unknown");
  h.expire(60_000); await rejected;
  assert.equal(h.calls.some(call => ["prepare", "start"].includes(call[0])), false);
  await capture.dispose();
  for (const status of ["denied", "not_installed", "error"]) {
    const f = harness({ platform: "darwin", arch: "arm64" }), refused = f.create();
    f.sdk.requestPermission = async permission => f.emit("permission-status", { permission, status: permission === "system-audio" ? status : "granted" });
    await assert.rejects(refused.preparePermissions(new AbortController().signal, { recallApiUrl: input.apiUrl }), error => error.message.includes(`system-audio=${status}`));
    assert.equal(refused.getPermissionSnapshot().systemAudio.status, status);
    assert.equal(f.calls.some(call => ["prepare", "start"].includes(call[0])), false);
    await refused.dispose();
  }
});

test("cancelling pending init or permission cannot race shutdown or lose the owner after a cleanup deadline", async () => {
  for (const command of ["init", "requestPermission"]) {
    const h = harness({ platform: "darwin", arch: "arm64" }), capture = h.create(), controller = new AbortController();
    let complete;
    h.sdk[command] = async value => { h.calls.push([command, value]); await new Promise(resolve => { complete = resolve; }); };
    const preparing = capture.preparePermissions(controller.signal, { recallApiUrl: input.apiUrl });
    const cancelled = assert.rejects(preparing, /取消/);
    await tick(); assert.equal(typeof complete, "function");
    controller.abort(); await cancelled;
    const disposing = capture.dispose(), timedOut = assert.rejects(disposing, /仍保留资源所有权/);
    await tick(); h.expire(); await timedOut;
    assert.equal(h.calls.some(call => call[0] === "shutdown"), false);
    const next = h.create();
    await assert.rejects(next.preparePermissions(new AbortController().signal, { recallApiUrl: input.apiUrl }), /仍持有/);
    complete(); await tick();
    assert.equal(h.calls.filter(call => call[0] === "shutdown").length, 0);
    await capture.dispose(); assert.equal(h.listenerCount(), 0);
    assert.equal(h.calls.filter(call => call[0] === "shutdown").length, 1);
    // Restore an acknowledging command for a genuinely fresh owner.
    h.sdk.init = async config => h.calls.push(["init", config]);
    h.sdk.requestPermission = async permission => h.emit("permission-status", { permission, status: "granted" });
    await next.preparePermissions(new AbortController().signal, { recallApiUrl: input.apiUrl });
    await next.dispose();
  }
});

test("a preflight cleanup retry may request shutdown again after acknowledgement without native exit", async () => {
  const h = harness({ platform: "darwin", arch: "arm64" }), capture = h.create();
  await capture.preparePermissions(new AbortController().signal, { recallApiUrl: input.apiUrl });
  h.sdk.shutdown = async () => h.calls.push(["shutdown"]);
  const disposing = capture.dispose(), timedOut = assert.rejects(disposing, /仍保留资源所有权/);
  await tick(); h.expire(); await timedOut;
  await assert.rejects(h.create().start(input), /仍持有/);
  h.sdk.shutdown = async () => { h.calls.push(["shutdown"]); h.emit("shutdown", { code: 0 }); };
  await capture.dispose();
  assert.equal(h.calls.filter(call => call[0] === "shutdown").length, 2);
  assert.equal(h.listenerCount(), 0);
});

test("startup diagnostics distinguish prepare from start while disclosing only fixed error categories and permission states", async () => {
  for (const command of ["init", "prepareDesktopAudioRecording", "startRecording"]) {
    const h = harness({ platform: "darwin", arch: "arm64" }); const capture = h.create();
    h.sdk[command] = async () => { throw new Error("HTTP 403: token=fixture-upload-token bearer=fixture-deepgram-credential https://sensitive.example/path"); };
    const phase = command === "init" ? "initializing" : command === "prepareDesktopAudioRecording" ? "preparing-source" : "start-command";
    await assert.rejects(capture.start(input), error => {
      assert.ok(error.message.includes(`phase=${phase}`));
      assert.ok(error.message.includes("cause=http-auth; http=403"));
      assert.ok(error.message.includes("commandAck=false; startedEvent=false"));
      if (command !== "init") assert.ok(error.message.includes("accessibility=granted,microphone=granted,system-audio=granted"));
      return !error.message.includes("fixture-") && !error.message.includes("sensitive.example");
    });
    assert.ok(h.errors.every(message => !message.includes("fixture-") && !message.includes("sensitive.example")));
    await capture.dispose();
  }
});

test("startup diagnostics do not forward unknown native errors or code fields", async () => {
  for (const [native, expected] of [
    [Object.assign(new Error("opaque fixture-upload-token fixture-deepgram-credential"), { code: "secret-code", type: "secret-type" }), "cause=unknown"],
    [Object.assign(new Error("fixture-upload-token"), { code: "ECONNREFUSED" }), "cause=network-or-ipc; code=ECONNREFUSED"],
    [Object.assign(new Error("fixture-deepgram-credential"), { code: "EPERM" }), "cause=reported-permission; code=EPERM"],
  ]) {
    const h = harness(); const capture = h.create();
    h.sdk.startRecording = async () => { throw native; };
    await assert.rejects(capture.start(input), error => error.message.includes(expected) && !/fixture-|secret-/.test(error.message));
    await capture.dispose();
  }
});

test("start acknowledgement without its event reports the confirmation phase without exposing the source or upload", async () => {
  const h = harness(); const capture = h.create();
  h.sdk.startRecording = async () => undefined;
  const starting = capture.start(input);
  const rejected = assert.rejects(starting, error => error.message.includes("phase=await-start-event") && error.message.includes("commandAck=true; startedEvent=false") && !error.message.includes("fixture-upload-token") && !error.message.includes("source-1"));
  await tick(); h.expire(); await rejected;
  await capture.dispose();
});

test("unsupported hosts never import the native SDK; macOS audio-only boundary is14.2", async () => {
  for (const options of [{ platform: "linux" }, { platform: "darwin", arch: "x64" }, { platform: "darwin", arch: "arm64", release: "23.1.0" }]) {
    const h = harness(options);
    assert.equal(h.RecallCapture.support().supported, false);
    await assert.rejects(h.create().start(input));
    assert.equal(h.imports(), 0);
  }
  assert.equal(harness({ platform: "darwin", arch: "arm64" }).RecallCapture.support().supported, true);
});

test("Windows support follows vendor Windows 10 1803 OS build 17134 and unknown versions fail before native import", async () => {
  for (const release of ["10.0.17134", "10.0.19045", "10.0.22631", "10.0.26100.1"]) {
    assert.equal(harness({ release }).RecallCapture.support().supported, true, release);
  }
  for (const release of ["6.1.7601", "6.3.9600", "10.0.10240", "10.0.17133", "", "unknown", "10.0", "10.0.build", "999999999999999999999999.0.1"]) {
    const h = harness({ release });
    assert.equal(h.RecallCapture.support().supported, false, release);
    assert.match(h.RecallCapture.support().message, /17134/);
    await assert.rejects(h.create().start(input), /17134/); assert.equal(h.imports(), 0);
  }
  const arm = harness({ platform: "win32", arch: "arm64" });
  assert.equal(arm.RecallCapture.support().supported, false); assert.equal(arm.imports(), 0);
});

test("Windows native startup failure does not report macOS permission states as an unconfirmed Windows requirement", async () => {
  const h = harness(); const capture = h.create();
  h.sdk.startRecording = async () => { throw new Error("fixture-upload-token"); };
  await assert.rejects(capture.start(input), error => error.message.includes("permissions=macos-consent-not-required-on-windows") && !error.message.includes("accessibility=unknown") && !error.message.includes("fixture-upload-token"));
  assert.equal(h.calls.filter(call => call[0] === "permission").length, 0);
  await capture.dispose();
});

test("permissions are requested only during explicit start and listeners precede native init", async () => {
  const h = harness({ platform: "darwin", arch: "arm64" });
  const capture = h.create();
  assert.equal(h.imports(), 0);
  h.sdk.init = async config => { assert.ok(h.listenerCount() > 0); h.calls.push(["init", config]); };
  await capture.start(input);
  assert.deepEqual(h.calls.filter(c => c[0] === "permission").map(c => c[1]), ["accessibility", "microphone", "system-audio"]);
  assert.equal(h.calls[0][1].apiUrl, input.apiUrl);
  assert.equal(h.calls[0][1].restartOnError, false);
  assert.equal(h.calls[0][1].telemetryMode, "off");
  assert.deepEqual(Array.from(h.calls[0][1].acquirePermissionsOnStartup), []);
  assert.equal(h.states.at(-1), "recording");
  await capture.dispose();
  assert.equal(h.listenerCount(), 0);
});

test("start command acknowledgement is insufficient without matching recording-started", async () => {
  const h = harness(); const capture = h.create();
  h.sdk.startRecording = async value => { h.calls.push(["start", value]); };
  let resolved = false;
  const start = capture.start(input).then(() => { resolved = true; });
  await tick();
  h.emit("recording-started", { window: { id: "wrong-window" } });
  await tick(); assert.equal(resolved, false);
  h.emit("recording-started", { window: { id: "source-1" } });
  await start; assert.equal(resolved, true);
  await capture.dispose();
});

test("missing permission confirmation times out, and native error details stay private", async () => {
  const h = harness({ platform: "darwin", arch: "arm64" }); const capture = h.create();
  h.sdk.requestPermission = async () => undefined;
  const start = capture.start(input); const rejected = assert.rejects(start, /15 秒/);
  await tick(); h.expire(); await rejected;
  assert.equal(h.states.at(-1), "error");
  await capture.dispose();
  const h2 = harness(); const second = h2.create();
  h2.sdk.init = async () => { throw new Error("权限 fixture-secret-token"); };
  await assert.rejects(second.start(input), error => !error.message.includes("fixture-secret-token"));
  assert.ok(h2.errors.every(message => !message.includes("fixture-secret-token")));
  await second.dispose();
});

test("initial permission status events are observed without startup permission acquisition", async () => {
  const h = harness({ platform: "darwin", arch: "arm64" }); const capture = h.create();
  h.sdk.init = async config => {
    assert.deepEqual(Array.from(config.acquirePermissionsOnStartup), []);
    for (const permission of ["accessibility", "microphone", "system-audio"]) h.emit("permission-status", { permission, status: "granted" });
  };
  await capture.start(input);
  assert.equal(h.calls.filter(call => call[0] === "permission").length, 0);
  await capture.dispose();
});

test("permission refusals identify the exact missing permission and whitelisted status", async () => {
  for (const [missing, status] of [["accessibility", "denied"], ["microphone", "error"], ["system-audio", "not_installed"]]) {
    const h = harness({ platform: "darwin", arch: "arm64" }); const capture = h.create();
    h.sdk.requestPermission = async permission => h.emit("permission-status", {
      permission, status: permission === missing ? status : "granted", message: "fixture-secret-token",
    });
    await assert.rejects(capture.start(input), error => error.message.includes(`${missing}=${status}`) && !error.message.includes("fixture-secret-token") && !error.message.includes("=granted"));
    assert.equal(h.calls.filter(call => call[0] === "prepare").length, 0);
    await capture.dispose();
  }
});

test("unrecognized or absent permission statuses remain unknown and safe in timeout diagnostics", async () => {
  const h = harness({ platform: "darwin", arch: "arm64" }); const capture = h.create();
  h.sdk.requestPermission = async permission => h.emit("permission-status", {
    permission, status: permission === "accessibility" ? "fixture-secret-status" : permission === "microphone" ? { toString() { throw new Error("must not stringify native data"); } } : undefined,
  });
  const start = capture.start(input);
  const rejected = assert.rejects(start, error => /15 秒/.test(error.message) && ["accessibility=unknown", "microphone=unknown", "system-audio=unknown"].every(value => error.message.includes(value)) && !error.message.includes("fixture-secret"));
  await tick(); h.expire(); await rejected;
  await capture.dispose();
});

test("permission command failures disclose the permission and normalized state without SDK errors", async () => {
  const h = harness({ platform: "darwin", arch: "arm64" }); const capture = h.create();
  h.sdk.requestPermission = async () => { throw new Error("fixture-secret-command"); };
  await assert.rejects(capture.start(input), error => error.message.includes("请求失败（accessibility）") && error.message.includes("accessibility=unknown") && !error.message.includes("fixture-secret"));
  await capture.dispose();
});

test("pause/resume wait command acknowledgement and drop paused or foreign-window transcripts", async () => {
  const h = harness(); const capture = h.create();
  await capture.start(input);
  h.emit("realtime-event", event("wrong-window"));
  h.emit("realtime-event", event("source-1"));
  assert.equal(h.transcripts.length, 1);
  let acknowledge;
  h.sdk.pauseRecording = () => new Promise(resolve => { acknowledge = resolve; });
  const pause = capture.pause();
  assert.equal(h.states.at(-1), "pausing");
  await tick();
  h.emit("realtime-event", event("source-1", "ignored", true));
  acknowledge(); await pause;
  assert.equal(h.states.at(-1), "paused");
  h.emit("realtime-event", event("source-1", "ignored too", true));
  await capture.resume();
  assert.equal(h.states.at(-1), "recording");
  h.emit("realtime-event", event("source-1", "second", false, { id: 1, is_host: true }, 2));
  assert.equal(h.transcripts.length, 2);
  await capture.dispose();
});

test("stop/start reuses one SDK process and filters late events from retired sources", async () => {
  const h = harness(); const capture = h.create();
  await capture.start(input);
  await capture.stop();
  await capture.start(input);
  h.emit("realtime-event", event("source-1", "old"));
  h.emit("recording-ended", { window: { id: "source-1" } });
  h.emit("realtime-event", event("source-2", "current"));
  assert.equal(h.states.at(-1), "recording");
  assert.equal(h.transcripts.length, 1);
  assert.equal(h.transcripts[0].text, "current");
  assert.equal(h.calls.filter(c => c[0] === "init").length, 1);
  await capture.dispose();
});

test("stopping while start awaits its event cancels that start without corrupting stop", async () => {
  const h = harness(); const capture = h.create();
  h.sdk.startRecording = async () => undefined;
  const start = capture.start(input); const rejected = assert.rejects(start, /取消/);
  await tick(); await capture.stop(); await rejected;
  assert.equal(h.states.at(-1), "ended");
  await capture.dispose();
});

test("missing stop acknowledgement retains source ownership and supports cleanup retry", async () => {
  const h = harness(); const capture = h.create();
  await capture.start(input);
  h.sdk.stopRecording = async () => undefined;
  const stop = capture.stop(); const rejected = assert.rejects(stop, /仍保留/);
  await tick(); h.expire(); await rejected;
  await assert.rejects(h.create().start(input), /仍持有/);
  await capture.dispose();
  assert.equal(h.listenerCount(), 0);
});

test("shutdown failure keeps the singleton owner and listeners until successful retry", async () => {
  const h = harness(); const capture = h.create();
  await capture.start(input);
  h.sdk.shutdown = async () => { throw new Error("fixture-secret"); };
  await assert.rejects(capture.dispose(), /仍保留/);
  assert.ok(h.listenerCount() > 0);
  const next = h.create();
  await assert.rejects(next.start(input), /仍持有/);
  h.sdk.shutdown = async () => { h.emit("shutdown", { code: 0 }); };
  await capture.dispose();
  assert.equal(h.listenerCount(), 0);
  await next.start(input);
  await next.dispose();
});

test("shutdown acknowledgement without native close cannot release the singleton owner", async () => {
  const h = harness(); const capture = h.create();
  await capture.start(input);
  h.sdk.shutdown = async () => undefined;
  const close = capture.dispose(); const rejected = assert.rejects(close, /仍保留/);
  await tick(); h.expire(); await rejected;
  assert.ok(h.listenerCount() > 0);
  await assert.rejects(h.create().start(input), /仍持有/);
  // A late close event is still authoritative and makes cleanup retryable.
  h.emit("shutdown", { code: 0 });
  await capture.dispose();
  assert.equal(h.listenerCount(), 0);
});

test("start refusal and absent recording-ended still permit direct bounded shutdown cleanup", async () => {
  const h = harness(); const capture = h.create();
  h.sdk.startRecording = async () => { throw new Error("fixture-invalid-token"); };
  await assert.rejects(capture.start(input));
  h.sdk.stopRecording = async () => undefined;
  const stop = capture.stop(); const rejected = assert.rejects(stop, /仍保留/);
  await tick(); h.expire(); await rejected;
  await capture.dispose();
  assert.equal(h.calls.filter(call => call[0] === "shutdown").length, 1);
  assert.equal(h.listenerCount(), 0);
  h.sdk.startRecording = async value => { h.emit("recording-started", { window: { id: value.windowId } }); };
  const next = h.create(); await next.start(input); await next.dispose();
});

test("listener cleanup failure remains retryable after the native process exits", async () => {
  const h = harness(); const capture = h.create();
  await capture.start(input);
  const remove = h.sdk.removeEventListener;
  h.sdk.removeEventListener = () => { throw new Error("fixture-secret"); };
  await assert.rejects(capture.dispose(), /监听器清理未完成/);
  await assert.rejects(h.create().start(input), /仍持有/);
  h.sdk.removeEventListener = remove;
  await capture.dispose();
  assert.equal(h.listenerCount(), 0);
  assert.equal(h.calls.filter(c => c[0] === "shutdown").length, 1);
});

test("pausing and stopping admit final tail utterances but never ongoing partials", async (t) => {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const h = harness(); const capture = h.create();
  await capture.start(input);
  h.emit("realtime-event", event("source-1", "hel", true));
  let paused;
  h.sdk.pauseRecording = () => new Promise(resolve => { paused = resolve; });
  const pause = capture.pause();
  await tick();
  h.emit("realtime-event", event("source-1", "hello", false));
  h.emit("realtime-event", event("source-1", "discard", true));
  assert.equal(h.transcripts.length, 2);
  assert.equal(h.transcripts[0].id, h.transcripts[1].id);
  paused(); await pause;
  h.emit("realtime-event", event("source-1", "tail", false, { id: 1, is_host: true }, 1));
  assert.equal(h.transcripts.length, 3);
  now += 2001;
  h.emit("realtime-event", event("source-1", "too late", false, { id: 1, is_host: true }, 2));
  assert.equal(h.transcripts.length, 3);
  await capture.resume();
  let ended;
  h.sdk.stopRecording = value => new Promise(resolve => { ended = () => { h.emit("recording-ended", { window: { id: value.windowId } }); resolve(); }; });
  const stop = capture.stop(); await tick();
  h.emit("realtime-event", event("source-1", "last", false, { id: 1, is_host: true }, 3));
  h.emit("realtime-event", event("source-1", "not final", true, { id: 1, is_host: true }, 4));
  assert.equal(h.transcripts.length, 4);
  ended(); await stop; await capture.dispose();
});

test("stop calls coalesce and native shutdown during stop confirms no capture remains", async () => {
  const h = harness(); const capture = h.create();
  await capture.start(input);
  let ended;
  h.sdk.stopRecording = () => new Promise(resolve => { ended = () => { h.emit("shutdown", { code: 0 }); resolve(); }; });
  const first = capture.stop(); const second = capture.stop();
  assert.equal(first, second);
  await tick(); ended(); await first;
  assert.equal(h.states.at(-1), "ended");
  await capture.dispose();
});

test("synchronous SDK failures cannot leave an unhandled event waiter or release ownership", async () => {
  const h = harness(); const capture = h.create();
  h.sdk.startRecording = () => { throw new Error("fixture-secret"); };
  await assert.rejects(capture.start(input), /无法启动/);
  await tick();
  h.sdk.stopRecording = () => { throw new Error("fixture-secret"); };
  await assert.rejects(capture.stop(), /仍保留/);
  await assert.rejects(h.create().start(input), /仍持有/);
  assert.ok(h.errors.every(message => !message.includes("fixture-secret")));
  await capture.dispose();
});

test("normalizer gives partial/final a stable ID, preserves timing, and deduplicates final", () => {
  const n = harness().normalizer();
  const a = n.normalize(event("source", "hel", true), 100);
  const b = n.normalize(event("source", "hello", true), 200);
  const c = n.normalize(event("source", "hello", false), 300);
  assert.equal(a.id, b.id); assert.equal(b.id, c.id);
  assert.equal(c.source, "microphone"); assert.equal(c.participantId, "1");
  assert.equal(c.startMs, 0); assert.equal(c.endMs, 500);
  assert.equal(a.isFinal, false); assert.equal(c.isFinal, true);
  assert.equal(n.normalize(event("source", "hello", false), 400), null);
  assert.equal(n.normalize(event("source", "late partial", true), 500), null);
});

test("normalizer source precedence does not share speaker IDs across simultaneous sources", () => {
  const n = harness().normalizer();
  const mic = event("source", "local", true, { id: 1, is_host: true });
  mic.data.source = "system";
  const a = n.normalize(mic);
  const b = n.normalize(event("source", "other", true, { id: 2, is_host: false }));
  const unknown = n.normalize(event("source", "unknown", false, {}));
  assert.equal(a.source, "system"); assert.equal(b.source, "system");
  assert.notEqual(a.id, b.id);
  assert.equal(unknown.source, "unknown"); assert.equal(unknown.participantId, undefined);
  assert.equal(n.normalize(event("source", "host", false, { name: "Host" }, 3)).source, "microphone");
  assert.equal(n.normalize(event("source", "guest", false, { name: "Guest" }, 4)).source, "system");
});

test("timestamp-free updates keep active partial identity but repeated utterances can complete", () => {
  const n = harness().normalizer();
  const make = partial => { const e = event("source", "yes", partial); delete e.data.data.words[0].start_timestamp; delete e.data.data.words[0].end_timestamp; return e; };
  const a = n.normalize(make(true), 100);
  const b = n.normalize(make(false), 200);
  assert.equal(a.id, b.id);
  assert.equal(n.normalize(make(false), 250), null);
  const c = n.normalize(make(true), 5000);
  const d = n.normalize(make(false), 5100);
  assert.notEqual(c.id, a.id); assert.equal(c.id, d.id);
  assert.equal(d.startMs, undefined);
  assert.equal(n.normalize({ event: "transcript.data", data: { data: { words: [] } } }), null);
});

test("transcript boundary bounds words/text/speaker without colliding long identities", () => {
  const n = harness().normalizer();
  const a = event("source", "x".repeat(100_000), false, { id: "p".repeat(1000) + "a", name: "Guest".repeat(500), is_host: true });
  a.data.data.utterance_id = "u".repeat(1000) + "a";
  const first = n.normalize(a);
  const b = event("source", "x".repeat(100_000), false, { id: "p".repeat(1000) + "b", name: "Guest".repeat(500), is_host: true });
  b.data.data.utterance_id = "u".repeat(1000) + "b";
  const second = n.normalize(b);
  assert.ok(first.text.length <= 16_384); assert.ok(first.text.endsWith("…"));
  assert.ok(first.speaker.length <= 120); assert.ok(first.speaker.endsWith("…"));
  assert.equal(first.source, "microphone");
  assert.match(first.participantId, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(first.participantId, second.participantId); assert.notEqual(first.id, second.id);
  const c = event("source", "different utterance", false, a.data.data.participant);
  c.data.data.utterance_id = "u".repeat(1000) + "b";
  assert.notEqual(n.normalize(c).id, first.id);
  const many = event("source", "unused", false, { id: 2 });
  many.data.data.words = Array.from({ length: 10_000 }, () => ({ text: "w" }));
  const result = n.normalize(many);
  assert.equal(result.text.split(" ").length, 1024); assert.ok(result.text.endsWith("…"));
});

test("Recall word boundaries preserve Chinese, dates, Latin terms and punctuation", () => {
  const inputs = [
    [["今天", "是", "2026", "年", "10", "月", "20", "日", "，", "订单", "金额", "是", "128.50", "元", "。"], "今天是2026年10月20日，订单金额是128.50元。"],
    [["请用", "Python", "实现", "binary", "search", "，", "时间", "复杂度", "是", "O(log n)", "。"], "请用 Python 实现 binary search，时间复杂度是 O(log n)。"],
    [["Hello", ",", "world", "!", "(", "Again", ")"], "Hello, world! (Again)"],
    [["保留 ", " 空格", "与", "换行\n", "内容"], "保留  空格与换行\n内容"],
    [["𠮷", "野", "家"], "𠮷野家"],
  ];
  for (const [tokens, expected] of inputs) {
    const n = harness().normalizer();
    const partial = event("source", "unused", true, { id: 1, is_host: false });
    partial.data.data.words = tokens.map(text => ({ text }));
    partial.data.data.utterance_id = "chinese-utterance";
    const a = n.normalize(partial, 10);
    const final = structuredClone(partial); final.event = "transcript.data";
    const b = n.normalize(final, 20);
    assert.equal(a.text, expected); assert.equal(b.text, expected);
    assert.equal(a.id, b.id); assert.equal(b.source, "system");
    assert.equal(n.normalize(final, 30), null);
  }
});

test("Chinese text truncation preserves the UTF-16 boundary and resource bounds", () => {
  const n = harness().normalizer();
  const input = event("source", "文".repeat(16_382) + "𠮷家");
  const output = n.normalize(input);
  assert.ok(output.text.length <= 16_384);
  assert.ok(output.text.endsWith("…"));
  assert.ok(!/[\uD800-\uDBFF]$/u.test(output.text.slice(0, -1)));
  const many = event("source", "unused");
  many.data.data.words = Array.from({ length: 100_000 }, () => ({ text: "中" }));
  const result = n.normalize(many);
  assert.equal(result.text, "中".repeat(1024) + "…");
});

// Authored event sequences model revised word timestamps. These are synthetic
// regression inputs, not a raw Deepgram/Recall provider trace or ASR measurement.
test("drifting word starts reuse one active ID through three partials and final while keeping timing facts", () => {
  const n = harness().normalizer();
  const inputs = [
    event("source", "订单", true, { id: 1, is_host: true }, 1),
    event("source", "订单金额", true, { id: 1, is_host: true }, 1.25),
    event("source", "订单金额是128", true, { id: 1, is_host: true }, 1.125),
    event("source", "订单金额是128.50元。", false, { id: 1, is_host: true }, 1.375),
  ];
  const updates = inputs.map((input, index) => n.normalize(input, 100 + index * 100));
  assert.equal(new Set(updates.map(item => item.id)).size, 1);
  assert.deepEqual(updates.map(item => item.startMs), [1000, 1250, 1125, 1375]);
  assert.deepEqual(updates.map(item => item.endMs), [1500, 1750, 1625, 1875]);
  assert.deepEqual(updates.map(item => item.isFinal), [false, false, false, true]);
  assert.equal(updates.at(-1).text, "订单金额是128.50元。");
  assert.equal(n.normalize(inputs.at(-1), 500), null, "same final timestamp/text remains deduplicated");
  const latePartial = structuredClone(inputs.at(-1)); latePartial.event = "transcript.partial_data";
  assert.equal(n.normalize(latePartial, 600), null, "finalized event key still suppresses a late partial");
  const correctedFinal = structuredClone(inputs.at(-1)); correctedFinal.data.data.words[0].text = "订单金额是128.50元，已确认。";
  const correction = n.normalize(correctedFinal, 700);
  assert.equal(correction.id, updates[0].id, "existing timestamp final-correction identity remains unchanged");
  const next = n.normalize(event("source", "下一个问题", true, { id: 1, is_host: true }, 3), 800);
  assert.notEqual(next.id, updates[0].id, "final must release the previous active channel");
});

test("interleaved sources keep separate active IDs even with one participant and drifting coincident timestamps", () => {
  const n = harness().normalizer();
  const make = (source, text, partial, start) => {
    const input = event("source", text, partial, { id: 7, name: "fixture same participant" }, start);
    input.data.source = source;
    return input;
  };
  const system = [], microphone = [];
  const accept = (source, text, partial, start, receivedAt) => {
    const result = n.normalize(make(source, text, partial, start), receivedAt);
    (source === "system" ? system : microphone).push(result);
    return result;
  };
  accept("system", "数组", true, 10, 100);
  accept("microphone", "可以", true, 10, 110);
  accept("system", "数组允许", true, 10.25, 200);
  accept("microphone", "可以包含", true, 10.125, 210);
  accept("system", "数组允许负数吗？", false, 10.125, 300);
  accept("microphone", "可以包含负数。", false, 10.25, 310);
  assert.equal(new Set(system.map(item => item.id)).size, 1);
  assert.equal(new Set(microphone.map(item => item.id)).size, 1);
  assert.notEqual(system[0].id, microphone[0].id);
  assert.ok(system.every(item => item.source === "system"));
  assert.ok(microphone.every(item => item.source === "microphone"));
  assert.equal(system.at(-1).isFinal, true); assert.equal(microphone.at(-1).isFinal, true);
});

test("explicit utterance IDs still split a channel regardless of matching or drifting word starts", () => {
  const n = harness().normalizer();
  const make = (id, text, partial, start) => {
    const input = event("source", text, partial, { id: 1, is_host: true }, start);
    input.data.data.utterance_id = id;
    return input;
  };
  const first = n.normalize(make("first", "第一句", true, 1), 100);
  const revised = n.normalize(make("first", "第一句修订", true, 1.25), 200);
  assert.equal(first.id, revised.id);
  const second = n.normalize(make("second", "第二句", true, 1.25), 300);
  assert.notEqual(second.id, first.id);
  const final = n.normalize(make("second", "第二句完成。", false, 1.5), 400);
  assert.equal(second.id, final.id);
  assert.equal(n.normalize(make("second", "第二句完成。", false, 1.75), 500), null,
    "explicit identity remains stronger than word timestamps for finalized deduplication");
});

test("a corrected or duplicate prior final keeps its own row and cannot retire a newer active partial", () => {
  const n = harness().normalizer();
  // Synthetic same-channel sequence: old final A, new active B, then late A.
  const a = n.normalize(event("source", "alpha", false, { id: 1, is_host: true }, 1), 100);
  const b = n.normalize(event("source", "brav", true, { id: 1, is_host: true }, 3), 200);
  assert.notEqual(a.id, b.id);
  const corrected = n.normalize(event("source", "alpha corrected", false, { id: 1, is_host: true }, 1), 300);
  assert.equal(corrected.id, a.id);
  assert.equal(corrected.text, "alpha corrected");
  assert.equal(n.normalize(event("source", "alpha corrected", false, { id: 1, is_host: true }, 1), 400), null);
  const bRevised = n.normalize(event("source", "bravo revised", true, { id: 1, is_host: true }, 3.125), 500);
  assert.equal(bRevised.id, b.id, "neither old correction nor duplicate final may release B");
  const bFinal = n.normalize(event("source", "bravo final", false, { id: 1, is_host: true }, 3.25), 600);
  assert.equal(bFinal.id, b.id);
  assert.equal(bFinal.isFinal, true);
  const c = n.normalize(event("source", "charlie", true, { id: 1, is_host: true }, 5), 700);
  assert.notEqual(c.id, b.id, "B's own final must still clear B's active ownership");
});


test("beginning a capture epoch retires unfinished IDs but preserves final correction ownership", () => {
  const normalizer = harness().normalizer();
  const a = normalizer.normalize(event("owned", "A final", false, { id: 1, is_host: true }, 0), 1000);
  const b = normalizer.normalize(event("owned", "B interim", true, { id: 1, is_host: true }, 0.6), 2000);
  normalizer.beginCaptureEpoch();
  const c = normalizer.normalize(event("owned", "C interim", true, { id: 1, is_host: true }, 1.2), 3000);
  assert.notEqual(c.id, b.id);
  assert.equal(c.channelId, b.channelId);
  const correction = normalizer.normalize(event("owned", "A corrected", false, { id: 1, is_host: true }, 0), 4000);
  assert.equal(correction.id, a.id);
  assert.equal(normalizer.normalize(event("owned", "C updated", true, { id: 1, is_host: true }, 1.3), 5000).id, c.id);
  assert.equal(normalizer.normalize(event("owned", "C final", false, { id: 1, is_host: true }, 1.4), 6000).id, c.id);
});

const productionModules = createProductionTsLoader();
function captureSession(context, h) {
  const { LiveSessionService } = productionModules(fileURLToPath(new URL("../../electron/live/LiveSessionService.ts", import.meta.url)));
  const service = new LiveSessionService({
    support: { supported: true }, createCapture: callbacks => h.create(callbacks),
    async createSession() { return input; }, pendingScreenshots: () => [], images: async () => [],
    consumeScreenshots: async () => ({ success: true }), language: () => "zh-CN", publish() {},
    stream: async () => assert.fail("capture boundary test must not request a model"),
  });
  context.after(() => service.dispose());
  return service;
}

test("Windows uses vendor whole-desktop recording without Mac permissions and preserves Host/Guest partial-final source identity", async context => {
  const h = harness({ platform: "win32", arch: "x64", release: "10.0.22631" });
  const prepare = h.sdk.prepareDesktopAudioRecording;
  h.sdk.prepareDesktopAudioRecording = async (...args) => { assert.deepEqual(args, [], "vendor recommends default whole-desktop configuration"); return prepare(); };
  const service = captureSession(context, h);
  assert.equal((await service.start()).success, true);
  assert.equal(h.calls.filter(call => call[0] === "permission").length, 0);
  const host = { id: "local", name: "Host" }, guest = { id: "remote", name: "Guest" };
  for (const [person, text, partial] of [[host, "microphone interim", true], [guest, "system interim", true], [host, "microphone final", false], [guest, "system final", false]]) h.emit("realtime-event", event("source-1", text, partial, person));
  assert.deepEqual(service.getSnapshot().transcripts.map(row => [row.source, row.text, row.isFinal]), [["microphone", "microphone final", true], ["system", "system final", true]]);
  await service.pause();
  h.emit("realtime-event", event("source-1", "paused interim must not appear", true, host, 2));
  assert.equal(service.getSnapshot().transcripts.length, 2);
  await service.resume();
  h.emit("realtime-event", event("source-1", "resumed system", false, guest, 3));
  assert.equal(service.getSnapshot().transcripts.at(-1).source, "system");
  assert.equal(service.getSnapshot().transcripts.at(-1).captureEpoch, 1);
  assert.equal((await service.stop()).success, true); assert.equal(service.getSnapshot().captureStatus, "ended");
  assert.equal(h.calls.filter(call => call[0] === "permission").length, 0);
});

test("real Capture and Session keep a pre-pause pending row while resumed partial gets a fresh ID/epoch and old final correction stays owned", async context => {
  const h = harness(); const service = captureSession(context, h);
  await service.start();
  h.emit("realtime-event", event("source-1", "A final", false, { id: 1, is_host: true }, 0));
  h.emit("realtime-event", event("source-1", "B unfinished", true, { id: 1, is_host: true }, 0.6));
  const [a, b] = service.getSnapshot().transcripts;
  await service.pause(); await service.resume();
  h.emit("realtime-event", event("source-1", "C interim", true, { id: 1, is_host: true }, 1.2));
  const c = service.getSnapshot().transcripts[2];
  assert.notEqual(c.id, b.id); assert.equal(c.captureEpoch, 1);
  h.emit("realtime-event", event("source-1", "A corrected", false, { id: 1, is_host: true }, 0));
  h.emit("realtime-event", event("source-1", "C updated", true, { id: 1, is_host: true }, 1.3));
  h.emit("realtime-event", event("source-1", "C final", false, { id: 1, is_host: true }, 1.4));
  const rows = service.getSnapshot().transcripts;
  assert.deepEqual(rows.map(row => [row.id, row.text, row.isFinal, row.captureEpoch]), [
    [a.id, "A corrected", true, 0], [b.id, "B unfinished", false, 0], [c.id, "C final", true, 1],
  ]);
  const { projectTranscriptParagraphs } = productionModules(fileURLToPath(new URL("../../electron/live/TranscriptParagraphs.ts", import.meta.url)));
  assert.deepEqual(projectTranscriptParagraphs(rows).map(row => row.memberIds), [[a.id, b.id], [c.id]]);
});

test("Capture retires unfinished identities before native resume can synchronously emit a new final", async context => {
  const h = harness(); const service = captureSession(context, h);
  await service.start();
  h.emit("realtime-event", event("source-1", "A final", false, { id: 1, is_host: true }, 0));
  h.emit("realtime-event", event("source-1", "B unfinished", true, { id: 1, is_host: true }, 0.6));
  const b = service.getSnapshot().transcripts[1];
  await service.pause();
  h.sdk.resumeRecording = async ({ windowId }) => {
    h.calls.push(["resume", { windowId }]);
    h.emit("realtime-event", event(windowId, "C synchronous final", false, { id: 1, is_host: true }, 1.2));
  };
  await service.resume();
  const rows = service.getSnapshot().transcripts;
  assert.equal(rows.length, 3);
  assert.equal(rows[1].id, b.id); assert.equal(rows[1].isFinal, false);
  assert.notEqual(rows[2].id, b.id); assert.equal(rows[2].captureEpoch, 1);
});


test("a post-gap orphan final wholly before current audio gets an independent row without claiming the retired partial or stealing current active", () => {
  const normalizer = harness().normalizer();
  const a = normalizer.normalize(event("owned", "A final", false, { id: 1 }, 0), 1000);
  const b = normalizer.normalize(event("owned", "B unfinished", true, { id: 1 }, 0.6), 2000);
  normalizer.beginCaptureEpoch();
  const c = normalizer.normalize(event("owned", "C interim", true, { id: 1 }, 1.5), 3000);
  const late = normalizer.normalize(event("owned", "B orphan final", false, { id: 1 }, 0.6), 4000);
  assert.notEqual(late.id, b.id, "word timing does not prove the retired B identity");
  assert.notEqual(late.id, c.id, "audio ending before C cannot finalize C");
  const correction = normalizer.normalize(event("owned", "A corrected", false, { id: 1 }, 0), 5000);
  assert.equal(correction.id, a.id, "known final keys retain ownership");
  assert.equal(normalizer.normalize(event("owned", "C update", true, { id: 1 }, 1.6), 6000).id, c.id);
  assert.equal(normalizer.normalize(event("owned", "C final", false, { id: 1 }, 1.7), 7000).id, c.id);
  assert.equal(normalizer.normalize(event("owned", "B orphan corrected", false, { id: 1 }, 0.6), 8000).id, late.id);
});

test("an explicit matching utterance ID takes precedence over the post-gap timing exclusion", () => {
  const normalizer = harness().normalizer();
  normalizer.normalize(event("owned", "old unfinished", true, { id: 1 }, 0), 1000);
  normalizer.beginCaptureEpoch();
  const identified = (text, partial, start) => {
    const value = event("owned", text, partial, { id: 1 }, start);
    value.data.data.utterance_id = "synthetic-current-explicit-id";
    return value;
  };
  const current = normalizer.normalize(identified("current interim", true, 2), 2000);
  assert.equal(normalizer.normalize(identified("same explicit final", false, 0.5), 3000).id, current.id);
});

test("post-gap exclusion uses finite owner timing and retains its observed envelope when partial starts drift", () => {
  const run = next => {
    const normalizer = harness().normalizer();
    normalizer.normalize(event("owned", "old unfinished", true, { id: 1 }, 0), 1000);
    normalizer.beginCaptureEpoch();
    const c = normalizer.normalize(event("owned", "current interim", true, { id: 1 }, 2), 2000);
    next(normalizer, c);
  };
  run((normalizer, current) => {
    // A later interim expanded earlier; a final overlapping that evidence must
    // not be excluded merely by the first or latest display timestamp.
    assert.equal(normalizer.normalize(event("owned", "current expanded", true, { id: 1 }, 0.5), 3000).id, current.id);
    assert.equal(normalizer.normalize(event("owned", "current drifted", true, { id: 1 }, 2.1), 4000).id, current.id);
    assert.equal(normalizer.normalize(event("owned", "overlapping final", false, { id: 1 }, 1), 5000).id, current.id);
  });
  for (const changed of [
    value => { delete value.data.data.words[0].end_timestamp; },
    value => { value.data.data.words[0].end_timestamp.relative = -1; },
    value => { value.data.data.words[0].end_timestamp.relative = Number.POSITIVE_INFINITY; },
    value => { value.data.data.words[0].end_timestamp.relative = 0.1; },
  ]) run((normalizer, current) => {
    const unknown = event("owned", "timing cannot exclude current", false, { id: 1 }, 0.5);
    changed(unknown);
    assert.equal(normalizer.normalize(unknown, 3000).id, current.id, "missing/nonfinite/inverted intervals are not exclusion evidence");
  });
});
