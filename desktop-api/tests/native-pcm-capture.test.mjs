import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 30; i++) { if (predicate()) return; await tick(); } assert.fail("capture did not settle"); }
const prepare = capture => capture.prepare(new AbortController().signal);
const preparedStart = async capture => { await prepare(capture); await capture.start(session()); };
const session = () => ({ kind: "native-deepgram", accessToken: "fixture-private-jwt", expiresAt: 60_000,
  transcriptionProfile: "deepgram-en", language: "en", model: "nova-3", wsUrl: "wss://api.deepgram.com/v1/listen" });
const result = (text, final = false, start = 0) => ({ type: "Results", start, duration: 1, is_final: final,
  channel_index: [0, 1], channel: { alternatives: [{ transcript: text }] } });
const audio = (source = "system", bytes = Buffer.from([1, 0, 2, 0])) => ({ event: "audio", source, audio: bytes.toString("base64") });

function harness(t, overrides = {}) {
  const load = createProductionTsLoader();
  const { NativePcmCapture } = load(fileURLToPath(new URL("../../electron/live/NativePcmCapture.ts", import.meta.url)));
  const timers = new Set(), states = [], transcripts = [], errors = [], children = [], sockets = [], captures = [], commands = [];
  const fakeClock = {
    setTimeout(fn, ms) { const timer = { fn, ms }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    setInterval(fn, ms) { const timer = { fn, ms, repeat: true }; timers.add(timer); return timer; },
    clearInterval(timer) { timers.delete(timer); },
  };
  class Child extends EventEmitter {
    stdout = new PassThrough(); stderr = new PassThrough(); kills = []; closed = false;
    stdin = new Writable({ write: (bytes, _encoding, done) => {
      const command = JSON.parse(bytes.toString()).command; commands.push(command);
      if (command === "prepare") { if (overrides.autoPrepare !== false) this.event({ event: "prepared" }); }
      else if (command === "start" || command === "resume") this.event({ event: "state", state: "recording" });
      else if (command === "pause") this.event({ event: "state", state: "paused" });
      else if (command === "stop") { this.event({ event: "state", state: "ended" }); if (overrides.autoExit !== false) queueMicrotask(() => this.finish()); }
      done();
    } });
    event(value) { this.stdout.write(JSON.stringify(value) + "\n"); }
    finish(code = 0) { if (!this.closed) { this.closed = true; this.emit("exit", code, null); this.emit("close", code, null); } }
    kill(signal) { this.kills.push(signal); if (overrides.autoExit !== false) queueMicrotask(() => this.finish(1)); return true; }
  }
  class Socket extends EventEmitter {
    readyState = 0; bufferedAmount = 0; sent = []; terminated = false; closed = false;
    constructor(url, options, source) {
      super(); Object.assign(this, { url, options, source });
      if (overrides.autoOpen !== false) queueMicrotask(() => this.open());
    }
    open() { this.readyState = 1; this.emit("open"); }
    message(value) { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
    send(value, done) {
      this.sent.push(value); this.emit("sent", value);
      if (this.sendFailure) { queueMicrotask(() => done?.(new Error("fixture-private-jwt provider-internal"))); return; }
      done?.();
      if (typeof value === "string" && JSON.parse(value).type === "CloseStream" && overrides.autoSocketClose !== false) queueMicrotask(() => {
        if (this.finalText) this.message(result(this.finalText, true, 10));
        this.finish();
      });
    }
    finish() { if (!this.closed) { this.closed = true; this.readyState = 3; this.emit("close", 1000, Buffer.from("fixture-private-close-reason")); } }
    terminate() { this.terminated = true; if (overrides.autoSocketClose !== false) queueMicrotask(() => this.finish()); }
  }
  const options = { helperPath: "/fixture/native-audio", host: { platform: "darwin", arch: "x64", release: "22.0.0" },
    now: () => 1000, clock: fakeClock,
    spawnHelper() { const child = new Child(); children.push(child); return child; },
    createSocket(url, value, source) { const socket = new Socket(url, value, source); sockets.push(socket); return socket; },
    ...overrides.options,
  };
  const create = () => {
    const capture = new NativePcmCapture({ onState: state => { states.push(state); overrides.onState?.(state); }, onTranscript: row => transcripts.push(row), onError: error => errors.push(error) }, options);
    captures.push(capture); return capture;
  };
  t.after(async () => {
    for (const child of children) child.finish();
    for (const socket of sockets) socket.finish();
    await tick();
    await Promise.all(captures.map(capture => capture.dispose().catch(() => undefined)));
  });
  return { create, NativePcmCapture, options, children, sockets, states, transcripts, errors, commands, timers,
    fire(ms) { for (const timer of [...timers]) if (timer.ms <= ms) { if (!timer.repeat) timers.delete(timer); timer.fn(); } } };
}

test("Intel macOS13 support and mandatory prepare reject unsupported hosts and invalid sessions", async t => {
  const h = harness(t);
  for (const host of [{ platform: "darwin", arch: "arm64", release: "25.0.0" }, { platform: "darwin", arch: "x64", release: "21.6.0" },
    { platform: "win32", arch: "x64", release: "25.0.0" }, { platform: "darwin", arch: "x64", release: "unknown" }]) assert.equal(h.NativePcmCapture.support(host).supported, false);
  assert.equal(h.NativePcmCapture.support(h.options.host).supported, true);
  const capture = h.create();
  await assert.rejects(capture.start(session()), /先完成权限准备/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(capture.prepare(aborted.signal), /取消/);
  assert.equal(h.children.length, 0);
  await prepare(capture);
  for (const patch of [{ kind: "recall-upload" }, { transcriptionProfile: "recall-en" }, { language: "zh" }, { expiresAt: 999 },
    { wsUrl: "wss://sensitive.example/" }, { accessToken: "fixture\nheader" }, { model: "other" }]) await assert.rejects(capture.start({ ...session(), ...patch }));
  assert.equal(h.sockets.length, 0);
  await capture.stop();
});

test("native permission preflight reads only retained evidence and prepares then disposes without PCM or ASR", async t => {
  const h = harness(t, { autoPrepare: false }), capture = h.create();
  assert.equal(capture.getPermissionSnapshot().microphone.status, "unknown");
  assert.equal(h.children.length, 0);
  const preparing = capture.preparePermissions(new AbortController().signal, {});
  assert.deepEqual(h.commands, ["prepare"]); assert.equal(h.sockets.length, 0);
  assert.equal(capture.getPermissionSnapshot().systemAudio.status, "unknown");
  h.children[0].event({ event: "prepared" }); await preparing;
  const snapshot = capture.getPermissionSnapshot();
  for (const permission of ["microphone", "systemAudio"]) {
    assert.equal(snapshot[permission].status, "granted"); assert.equal(snapshot[permission].observedAt, 1000);
  }
  snapshot.microphone.status = "denied";
  assert.equal(capture.getPermissionSnapshot().microphone.status, "granted");
  await capture.dispose();
  assert.deepEqual(h.commands, ["prepare", "stop"]); assert.equal(h.sockets.length, 0); assert.deepEqual(h.transcripts, []);
});

test("native permission evidence distinguishes explicit denials from unavailable devices and sources", async t => {
  for (const code of ["MICROPHONE_PERMISSION_DENIED", "SCREEN_PERMISSION_DENIED", "NO_DISPLAY", "MICROPHONE_UNAVAILABLE", "SYSTEM_AUDIO_UNAVAILABLE"]) {
    const h = harness(t, { autoPrepare: false }), capture = h.create();
    const preparing = capture.preparePermissions(new AbortController().signal, {});
    const rejected = assert.rejects(preparing, error => error.message.includes(code));
    h.children[0].event({ event: "error", code }); await rejected;
    const snapshot = capture.getPermissionSnapshot();
    assert.equal(snapshot.microphone.status, code === "MICROPHONE_PERMISSION_DENIED" ? "denied" : "unknown");
    assert.equal(snapshot.systemAudio.status, code === "SCREEN_PERMISSION_DENIED" ? "denied" : "unknown");
    await capture.dispose();
    assert.equal(h.commands.includes("start"), false); assert.equal(h.sockets.length, 0);
  }
});

test("native preflight cancellation keeps its owner until child close even when disposal times out", async t => {
  const h = harness(t, { autoPrepare: false, autoExit: false }), capture = h.create(), controller = new AbortController();
  const preparing = capture.preparePermissions(controller.signal, {}), rejected = assert.rejects(preparing, /取消/);
  controller.abort(); await rejected;
  const disposing = capture.dispose(), timedOut = assert.rejects(disposing, /清理尚未确认完成/);
  await tick(); h.fire(15_000); await timedOut;
  const next = h.create();
  await assert.rejects(next.preparePermissions(new AbortController().signal, {}), /尚未关闭/);
  h.children[0].emit("exit", 0, null); await tick();
  await assert.rejects(next.preparePermissions(new AbortController().signal, {}), /尚未关闭/);
  h.children[0].finish(); await tick(); await capture.dispose();
  const retry = next.preparePermissions(new AbortController().signal, {});
  h.children[1].event({ event: "prepared" }); await retry;
  h.children[1].finish(); await next.dispose();
  assert.equal(h.sockets.length, 0); assert.equal(h.commands.includes("start"), false);
});

test("permission preparation owns a child without ASR or PCM, so a fresh grant can follow a long permission wait", async t => {
  let now = 1000;
  const h = harness(t, { autoPrepare: false, options: { now: () => now } }), capture = h.create();
  const preparing = prepare(capture);
  assert.deepEqual(h.commands, ["prepare"]); assert.equal(h.sockets.length, 0);
  now = 56_000;
  h.children[0].event({ event: "prepared" }); await preparing;
  assert.deepEqual(h.commands, ["prepare"]); assert.equal(h.sockets.length, 0);
  await capture.start({ ...session(), expiresAt: now + 30_000 });
  assert.deepEqual(h.commands, ["prepare", "start"]);
  await capture.stop();
});

test("abort during prepare retains ownership through actual child close and ignores late prepared callbacks", async t => {
  const h = harness(t, { autoPrepare: false, autoExit: false }), capture = h.create(), controller = new AbortController();
  const preparing = capture.prepare(controller.signal); const rejected = assert.rejects(preparing, /取消/);
  controller.abort(); await rejected;
  assert.ok(h.children[0].kills.includes("SIGTERM")); assert.equal(h.sockets.length, 0);
  h.children[0].event({ event: "prepared" });
  await assert.rejects(prepare(h.create()), /尚未关闭/);
  h.children[0].emit("exit", 0, null); await tick();
  await assert.rejects(prepare(h.create()), /尚未关闭/);
  h.children[0].finish(); await tick(); await capture.dispose();
  const replacement = h.create(); const again = prepare(replacement);
  h.children[1].event({ event: "prepared" }); await again;
  const stopping = replacement.stop(); h.children[1].finish(); await stopping;
});

test("synchronous cancellation from starting cannot spawn a helper or leave a static owner", async t => {
  const controller = new AbortController();
  const h = harness(t, { onState: state => { if (state === "starting") controller.abort(); } });
  const capture = h.create(); await assert.rejects(capture.prepare(controller.signal), /取消/);
  await capture.dispose(); assert.equal(h.children.length, 0); assert.equal(h.timers.size, 0);
  const replacement = harness(t).create(); await prepare(replacement); await replacement.stop();
});

test("prepare has a 60 second deadline and a native permission denial fails before any provider connection", async t => {
  for (const timeout of [false, true]) {
    const h = harness(t, { autoPrepare: false, autoExit: false }), capture = h.create();
    const preparing = prepare(capture); const rejected = assert.rejects(preparing, timeout ? /60 秒/ : /MICROPHONE_PERMISSION_DENIED/);
    if (timeout) h.fire(60_000);
    else h.children[0].event({ event: "error", code: "MICROPHONE_PERMISSION_DENIED" });
    await rejected; assert.equal(h.sockets.length, 0); assert.equal(h.commands.includes("start"), false);
    await assert.rejects(prepare(h.create()), /尚未关闭/);
    h.children[0].finish(1); await tick(); await capture.dispose();
  }
});

test("stopping a prepared child requests stop and waits for ended plus close without starting capture", async t => {
  const h = harness(t, { autoExit: false }), capture = h.create(); await prepare(capture);
  let complete = false; const stopping = capture.stop().then(() => { complete = true; });
  await tick(); assert.deepEqual(h.commands, ["prepare", "stop"]); assert.equal(complete, false);
  assert.equal(h.children[0].kills.length, 0); assert.equal(h.sockets.length, 0);
  h.children[0].finish(); await stopping;
});

test("both provider handshakes gate recording and each PCM stream and transcript stays with its actual source", async t => {
  const h = harness(t, { autoOpen: false }), capture = h.create();
  await prepare(capture);
  const started = capture.start(session());
  await until(() => h.sockets.length === 2);
  assert.equal(h.states.at(-1), "starting");
  assert.deepEqual(h.commands, ["prepare"]);
  const [system, microphone] = h.sockets;
  assert.match(system.url, /encoding=linear16/); assert.match(system.url, /sample_rate=16000/);
  assert.equal(system.options.headers.Authorization, "Bearer fixture-private-jwt");
  assert.equal(system.url.includes("fixture-private"), false);
  system.open(); await tick(); assert.equal(h.states.at(-1), "starting");
  microphone.open(); await started;
  assert.deepEqual(h.commands, ["prepare", "start"]);
  h.children[0].event(audio("system")); h.children[0].event(audio("microphone", Buffer.from([3, 0])));
  assert.equal(h.states.at(-1), "recording");
  assert.deepEqual(system.sent.filter(Buffer.isBuffer), [Buffer.from([1, 0, 2, 0])]);
  assert.deepEqual(microphone.sent.filter(Buffer.isBuffer), [Buffer.from([3, 0])]);
  system.message(result("remote interim")); system.message(result("remote final", true));
  microphone.message(result("local final", true));
  assert.equal(h.transcripts[0].id, h.transcripts[1].id);
  assert.deepEqual(h.transcripts.map(row => row.source), ["system", "system", "microphone"]);
  await capture.stop();
});

test("pause flushes finals, sends KeepAlive without new PCM, and resume reuses the owned two connections", async t => {
  const h = harness(t), capture = h.create(); await preparedStart(capture);
  h.children[0].event(audio()); h.sockets[0].message(result("before pause"));
  await capture.pause(); assert.equal(h.states.at(-1), "paused");
  for (const socket of h.sockets) assert.ok(socket.sent.some(value => typeof value === "string" && JSON.parse(value).type === "Finalize"));
  h.sockets[0].message(result("tail final", true)); h.sockets[0].message(result("stale interim", false, 1));
  assert.equal(h.transcripts.at(-1).text, "tail final");
  h.fire(3000);
  for (const socket of h.sockets) assert.equal(JSON.parse(socket.sent.at(-1)).type, "KeepAlive");
  await capture.resume(); h.children[0].event(audio("microphone"));
  h.sockets[0].message(result("fresh interim", false, 1));
  const fresh = h.transcripts.at(-1);
  h.sockets[0].message(result("fresh final", true, 1));
  assert.equal(h.transcripts.at(-1).id, fresh.id);
  assert.equal(h.sockets.length, 2); assert.equal(h.states.at(-1), "recording");
  await capture.stop(); assert.deepEqual(h.commands, ["prepare", "start", "pause", "resume", "stop"]);
});

test("stop drains through actual native close, then Finalize/CloseStream, retaining tail finals until both sockets close", async t => {
  const h = harness(t, { autoExit: false, autoSocketClose: false }), capture = h.create(); await preparedStart(capture);
  h.children[0].event(audio());
  let complete = false;
  const stopping = capture.stop().then(() => { complete = true; });
  await tick(); assert.equal(complete, false);
  assert.equal(h.sockets[0].sent.filter(value => typeof value === "string").length, 0);
  h.children[0].emit("exit", 0, null); await tick(); assert.equal(complete, false);
  await assert.rejects(prepare(h.create()), /尚未关闭/);
  h.children[0].finish();
  await until(() => h.sockets.every(socket => socket.sent.some(value => typeof value === "string" && JSON.parse(value).type === "CloseStream")));
  for (const socket of h.sockets) assert.deepEqual(socket.sent.filter(value => typeof value === "string").map(value => JSON.parse(value).type), ["Finalize", "CloseStream"]);
  h.sockets[0].message(result("last words", true)); h.sockets[0].finish(); await tick(); assert.equal(complete, false);
  h.sockets[1].finish(); await stopping;
  assert.equal(h.transcripts.at(-1).text, "last words"); assert.equal(h.states.at(-1), "ended");
  assert.equal(h.timers.size, 0);
});

test("bounded ws backpressure preserves frame order, and a full application queue fails without silent audio loss", async t => {
  const h = harness(t), capture = h.create(); await preparedStart(capture);
  h.sockets[0].bufferedAmount = 128000;
  h.children[0].event(audio("system", Buffer.from([1, 0]))); h.children[0].event(audio("system", Buffer.from([2, 0])));
  assert.equal(h.sockets[0].sent.length, 0);
  h.sockets[0].bufferedAmount = 0; h.fire(20);
  assert.deepEqual(h.sockets[0].sent, [Buffer.from([1, 0]), Buffer.from([2, 0])]);
  await capture.stop();
  const h2 = harness(t), second = h2.create(); await preparedStart(second);
  h2.sockets[0].bufferedAmount = 128000;
  for (let index = 0; index < 9; index++) h2.children[0].event(audio("system", Buffer.alloc(16000)));
  await until(() => h2.errors.length === 1); assert.match(h2.errors[0], /队列已满/);
  assert.ok(h2.children[0].kills.includes("SIGTERM"));
});

test("each pause waits for its own pending PCM before Finalize, including after a previous drain completed", async t => {
  const h = harness(t), capture = h.create(); await preparedStart(capture);
  for (let cycle = 0; cycle < 2; cycle++) {
    h.sockets[0].bufferedAmount = 128000;
    h.children[0].event(audio());
    const before = h.sockets[0].sent.length;
    let completed = false;
    const pausing = capture.pause().then(() => { completed = true; });
    await tick(); assert.equal(completed, false); assert.equal(h.sockets[0].sent.length, before);
    h.sockets[0].bufferedAmount = 0; h.fire(20); await pausing;
    assert.ok(Buffer.isBuffer(h.sockets[0].sent[before]));
    assert.equal(JSON.parse(h.sockets[0].sent[before + 1]).type, "Finalize");
    await capture.resume();
  }
  await capture.stop();
});

test("provider send errors and oversized results fail the capture and retain neither private bodies nor successful state", async t => {
  for (const trigger of [h => { h.sockets[0].sendFailure = true; h.children[0].event(audio()); },
    h => h.sockets[0].emit("message", Buffer.alloc(65537, 65), false),
    h => h.sockets[0].message({ type: "Error", description: "fixture-private-jwt sensitive-provider-body" })]) {
    const h = harness(t), capture = h.create(); await preparedStart(capture); trigger(h);
    await until(() => h.errors.length === 1 && h.children[0].closed);
    assert.equal(h.errors.join(" ").includes("fixture-private"), false);
    assert.equal(h.states.at(-1), "error");
    await capture.dispose();
  }
});

test("native failure and unexpected provider close each clean up both resources without exposing private diagnostics", async t => {
  for (const trigger of [h => h.children[0].event({ event: "error", code: "MICROPHONE_PERMISSION_DENIED" }),
    h => h.sockets[0].emit("error", new Error("fixture-private-jwt provider-secret")), h => h.sockets[0].finish()]) {
    const h = harness(t), capture = h.create(); await preparedStart(capture); trigger(h);
    await until(() => h.children[0].closed && h.sockets.every(socket => socket.closed));
    assert.equal(h.states.includes("error"), true); assert.equal(h.errors.length, 1);
    assert.equal(h.errors.join(" ").includes("fixture-private"), false);
    await capture.dispose();
  }
});

test("native NDJSON handles fragmented lines and rejects oversized, invalid, or odd-length PCM at the producer boundary", async t => {
  for (const invalid of [Buffer.alloc(65537, 65), Buffer.from('{"event":"audio","source":"system","audio":"!!!"}\n'),
    Buffer.from(JSON.stringify(audio("system", Buffer.from([1]))) + "\n")]) {
    const h = harness(t), capture = h.create(); await preparedStart(capture);
    const valid = JSON.stringify(audio()) + "\n";
    h.children[0].stdout.write(valid.slice(0, 10)); h.children[0].stdout.write(valid.slice(10));
    assert.equal(h.sockets[0].sent.filter(Buffer.isBuffer).length, 1);
    h.children[0].stdout.write(invalid);
    await until(() => h.errors.length === 1);
    await capture.dispose();
  }
});

test("a socket close during native shutdown is not mistaken for confirmed provider finalization", async t => {
  const h = harness(t, { autoExit: false }), capture = h.create(); await preparedStart(capture);
  const stopping = capture.stop(); const rejected = assert.rejects(stopping, /意外关闭/);
  h.sockets[0].finish();
  assert.equal(h.errors.length, 1); assert.match(h.errors[0], /意外关闭/);
  assert.ok(h.children[0].kills.includes("SIGTERM"));
  h.children[0].finish(); await rejected;
});

test("an abnormal native exit during stop is reported even if the ended event arrived", async t => {
  const h = harness(t, { autoExit: false }), capture = h.create(); await preparedStart(capture);
  const stopping = capture.stop(); const rejected = assert.rejects(stopping, /正常退出确认/);
  h.children[0].finish(1); await rejected;
  assert.equal(h.errors.length, 1);
});

test("a stop timeout retains child ownership after kill/exit until close is actually observed", async t => {
  const h = harness(t, { autoExit: false }), capture = h.create(); await preparedStart(capture);
  const stopping = capture.stop(); const rejected = assert.rejects(stopping, /15 秒/);
  await tick(); h.fire(15000); await rejected;
  assert.ok(h.children[0].kills.includes("SIGTERM"));
  await assert.rejects(prepare(h.create()), /尚未关闭/);
  h.children[0].emit("exit", 0, null); await tick();
  await assert.rejects(prepare(h.create()), /尚未关闭/);
  h.children[0].finish(); await tick(); await capture.dispose();
  assert.equal(h.timers.size, 0);
});

test("canceling startup closes connecting sockets, and stale callbacks cannot revive the stopped run", async t => {
  const h = harness(t, { autoOpen: false }), capture = h.create();
  await prepare(capture);
  const started = capture.start(session()); const rejected = assert.rejects(started);
  await until(() => h.sockets.length === 2);
  await capture.stop(); await rejected;
  const before = h.transcripts.length;
  h.sockets[0].open(); h.sockets[0].message(result("late", true));
  assert.equal(h.transcripts.length, before); assert.equal(h.states.at(-1), "ended");
});

test("a real owned child pipe drives the production NDJSON callbacks with synthetic PCM and exits on stop", { timeout: 3000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "passwisely-pcm-protocol-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const helper = path.join(directory, "fixture.cjs");
  await writeFile(helper, `const lines=require('node:readline').createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
lines.on('line',line=>{const {command}=JSON.parse(line);if(command==='prepare'){send({event:'prepared'})}else if(command==='start'){send({event:'state',state:'recording'});setTimeout(()=>{for(const source of ['system','microphone'])send({event:'audio',source,audio:Buffer.from([1,0,2,0]).toString('base64')})},10)}else if(command==='stop'){send({event:'state',state:'ended'});process.exit(0)}});`);
  const h = harness(t, { options: { helperPath: helper, spawnHelper: file => spawn(process.execPath, [file], { stdio: ["pipe", "pipe", "pipe"] }) } });
  const capture = h.create(); await preparedStart(capture);
  await Promise.all(h.sockets.map(socket => socket.sent.some(Buffer.isBuffer) ? Promise.resolve() : new Promise(resolve => socket.on("sent", value => { if (Buffer.isBuffer(value)) resolve(); }))));
  await capture.stop(); assert.equal(h.states.at(-1), "ended");
});
