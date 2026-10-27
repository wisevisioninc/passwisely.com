import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
function production(mocks = {}) {
  const load = createProductionTsLoader({ mocks, env: { PASSWISELY_API_URL: "https://desktop-account.fixture.test/api/" } });
  return relative => load(path.resolve(root, relative));
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const token = "fixture.temporary.jwt";
const grant = (profile = "deepgram-en", expiresAt = Date.now() + 30_000) => ({
  kind: "native-deepgram", accessToken: token, expiresAt,
  transcriptionProfile: profile, language: profile === "deepgram-zh" ? "zh" : "en",
  model: "nova-3", wsUrl: "wss://api.deepgram.com/v1/listen",
});
function accountFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "passwisely-native-account-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let authLost = 0, accountToken = "fixture-account-bearer";
  const { AccountService } = production({ electron: {
    app: { getPath: () => directory }, safeStorage: { isEncryptionAvailable: () => false },
  } })("electron/account.ts");
  const account = new AccountService(() => { authLost++; });
  account.getToken = () => accountToken;
  return { account, setToken(value) { accountToken = value; }, authLost: () => authLost };
}
function sessionFixture(t, extra = {}) {
  const captures = [], requests = [], snapshots = [];
  const { LiveSessionService } = production()("electron/live/LiveSessionService.ts");
  const deps = {
    provider: "native-deepgram", support: { supported: true }, transcriptionProfile: () => "deepgram-en",
    async createSession(sessionId, signal, profileId) { requests.push({ sessionId, signal, profileId }); return grant(profileId); },
    createCapture(callbacks) {
      const capture = { callbacks, calls: [], onResume: () => {},
        async prepare(signal) { capture.calls.push(["prepare", signal]); signal.throwIfAborted(); },
        async start(authorization) { capture.calls.push(["start", authorization]); callbacks.onState("recording"); },
        async pause() { capture.calls.push(["pause"]); callbacks.onState("paused"); },
        async resume() { capture.calls.push(["resume"]); capture.onResume(); callbacks.onState("recording"); },
        async stop() { capture.calls.push(["stop"]); callbacks.onState("ended"); },
        async dispose() { capture.calls.push(["dispose"]); },
      };
      captures.push(capture); return capture;
    },
    publish(snapshot) { snapshots.push(snapshot); },
    pendingScreenshots: () => [], images: async () => [], consumeScreenshots: async () => ({ success: true }),
    language: () => "en-US", stream: async () => assert.fail("No AI request expected"), ...extra,
  };
  const service = new LiveSessionService(deps);
  t.after(() => service.dispose());
  return { service, captures, requests, snapshots, deps };
}
const segment = (id, source, text, isFinal = true, receivedAt = 1) => ({
  id, source, text, isFinal, receivedAt, channelId: `native-${source}`, startMs: 0, endMs: 100,
});

// These tests execute the production account, selection and session boundaries.
// They do not establish physical audio, native permissions or Deepgram quality.
test("Account native en/zh authorization uses its fixed route, bearer and profile-only request", async t => {
  const { account } = accountFixture(t), calls = [];
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    const { transcriptionProfile } = JSON.parse(init.body);
    return Response.json({ ...grant(transcriptionProfile), ignoredServerSecret: "fixture-long-lived-server-key" });
  });
  for (const profile of ["deepgram-en", "deepgram-zh"]) {
    const result = await account.createNativeCaptureSession("7e481d68-b998-4c55-8d20-40176819fe8f", controller.signal, profile);
    assert.equal(result.transcriptionProfile, profile);
    assert.equal(result.language, profile === "deepgram-zh" ? "zh" : "en");
    assert.deepEqual(Object.keys(result).sort(), ["accessToken", "expiresAt", "kind", "language", "model", "transcriptionProfile", "wsUrl"]);
    assert.doesNotMatch(JSON.stringify(result), /fixture-long-lived-server-key/);
  }
  for (let i = 0; i < calls.length; i++) {
    const { url, init } = calls[i];
    assert.equal(url, "https://desktop-account.fixture.test/api/desktop/deepgram/token");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("authorization"), "Bearer fixture-account-bearer");
    assert.equal(init.headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(init.body), { sessionId: "7e481d68-b998-4c55-8d20-40176819fe8f", transcriptionProfile: ["deepgram-en", "deepgram-zh"][i] });
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
  }
});

test("Account rejects unavailable profiles and missing auth before reaching the grant route", async t => {
  const f = accountFixture(t);
  t.mock.method(globalThis, "fetch", () => assert.fail("Invalid profile/auth cannot reach transport"));
  for (const profile of ["recall-en", "recall-zh", "unknown", null, {}, []]) {
    await assert.rejects(f.account.createNativeCaptureSession("fixture-session", new AbortController().signal, profile));
  }
  f.setToken("");
  await assert.rejects(f.account.createNativeCaptureSession("fixture-session", new AbortController().signal, "deepgram-en"));
  assert.equal(f.authLost(), 1);
});

test("Account rejects malformed, expired, wrong-profile and hostile-host authorization without exposing payload secrets", async t => {
  const { account } = accountFixture(t), now = 100_000;
  t.mock.method(Date, "now", () => now);
  const valid = grant("deepgram-en", now + 30_000);
  for (const broken of [null, [], {},
    ...[
      { kind: "recall-upload" }, { transcriptionProfile: "deepgram-zh" }, { transcriptionProfile: undefined },
      { language: "zh" }, { model: "caller-model" }, { accessToken: "fixture-long-lived-server-key" },
      { accessToken: "" }, { accessToken: 42 }, { accessToken: `${"a".repeat(8189)}.b.c` },
      { expiresAt: now - 1 }, { expiresAt: now + 1000 }, { expiresAt: now + 60_001 },
      { expiresAt: "130000" }, { expiresAt: now + 30_000.5 },
      ...["ws://api.deepgram.com/v1/listen", "wss://api.deepgram.com.evil.test/v1/listen", "wss://evil.test/v1/listen",
        "wss://user:fixture-long-lived-server-key@api.deepgram.com/v1/listen", "wss://api.deepgram.com/v1/listen?token=fixture-long-lived-server-key",
        "wss://api.deepgram.com/v1/listen#fixture-long-lived-server-key", "wss://api.deepgram.com:443/v1/listen"].map(wsUrl => ({ wsUrl })),
    ].map(fields => ({ ...valid, ...fields, ignoredSecret: "fixture-long-lived-server-key" })),
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(broken));
    await assert.rejects(account.createNativeCaptureSession("fixture-session", new AbortController().signal, "deepgram-en"), error => {
      assert.doesNotMatch(error.message, /fixture-long-lived-server-key|fixture\.temporary\.jwt/); return true;
    });
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...valid, accessToken: `${"a".repeat(8188)}.b.c` }));
  assert.equal((await account.createNativeCaptureSession("fixture-session", new AbortController().signal, "deepgram-en")).accessToken.length, 8192);
  for (const remaining of [1001, 60_000]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(grant("deepgram-en", now + remaining)));
    assert.equal((await account.createNativeCaptureSession("fixture-session", new AbortController().signal, "deepgram-en")).expiresAt, now + remaining);
  }
});

test("Account native failures never forward raw server/transport credentials, while auth invalidation and abort remain observable", async t => {
  const f = accountFixture(t);
  for (const fetcher of [
    async () => { throw new Error("fixture-long-lived-server-key fixture.temporary.jwt"); },
    async () => Response.json({ error: "fixture-long-lived-server-key fixture.temporary.jwt" }, { status: 503 }),
    async () => Response.json({ error: "fixture-long-lived-server-key fixture.temporary.jwt" }, { status: 401 }),
  ]) {
    t.mock.method(globalThis, "fetch", fetcher);
    await assert.rejects(f.account.createNativeCaptureSession("fixture-session", new AbortController().signal, "deepgram-en"), error => {
      assert.doesNotMatch(error.message, /fixture-long-lived-server-key|fixture\.temporary\.jwt/); return true;
    });
  }
  assert.equal(f.authLost(), 1);
  const controller = new AbortController();
  controller.abort(new DOMException("fixture.temporary.jwt", "AbortError"));
  t.mock.method(globalThis, "fetch", async (_url, init) => { init.signal.throwIfAborted(); assert.fail("Aborted request cannot succeed"); });
  await assert.rejects(f.account.createNativeCaptureSession("fixture-session", controller.signal, "deepgram-en"), error => {
    assert.equal(controller.signal.aborted, true);
    assert.match(error.message, /取消/);
    assert.doesNotMatch(error.message, /fixture\.temporary\.jwt/); return true;
  });
});

test("CaptureSelection owns legacy three, native two, ARM four and effective selection without rewriting saved intent", () => {
  const owner = production()("electron/live/CaptureSelection.ts");
  assert.equal(owner.captureBackend("darwin", "x64"), "native-deepgram");
  for (const [platform, arch] of [["darwin", "arm64"], ["win32", "x64"], ["linux", "x64"]]) assert.equal(owner.captureBackend(platform, arch), "recall-v2");
  const legacy = owner.parsePublicTranscriptionSettings({ profileId: "recall-en" });
  assert.deepEqual(legacy, { profileId: "recall-en", availableProfileIds: ["recall-en", "deepgram-zh", "recall-zh"], captureProvider: "recall-v2" });
  for (const [savedId, displayed] of [["recall-en", "deepgram-en"], ["recall-zh", "deepgram-zh"], ["deepgram-en", "deepgram-en"], ["deepgram-zh", "deepgram-zh"]]) {
    const saved = Object.freeze({ profileId: savedId });
    const value = owner.publicTranscriptionSettings(saved, "native-deepgram");
    assert.deepEqual(value, { profileId: displayed, availableProfileIds: ["deepgram-en", "deepgram-zh"], captureProvider: "native-deepgram" });
    assert.deepEqual(owner.parsePublicTranscriptionSettings(value), value);
    assert.equal(saved.profileId, savedId);
  }
  const arm = owner.publicTranscriptionSettings({ profileId: "recall-en" }, "recall-v2");
  assert.deepEqual(arm.availableProfileIds, ["recall-en", "deepgram-en", "deepgram-zh", "recall-zh"]);
  assert.equal(arm.profileId, "recall-en");
  const projected = owner.getAvailableTranscriptionProfiles(arm);
  projected[0].label = "fixture mutation"; arm.availableProfileIds.length = 0;
  assert.equal(owner.publicTranscriptionSettings({ profileId: "recall-en" }, "recall-v2").availableProfileIds.length, 4);
  assert.notEqual(owner.getAvailableTranscriptionProfiles({ profileId: "recall-en" })[0].label, "fixture mutation");
});

test("CaptureSelection rejects malformed public capabilities and non-string provider lookalikes", () => {
  const owner = production()("electron/live/CaptureSelection.ts");
  for (const value of [null, [], {}, { profileId: "deepgram-en" },
    ...[null, [], new Array(1), ["unknown"], ["deepgram-en", "deepgram-en"], "all", ["deepgram-zh"]].map(availableProfileIds => ({ profileId: "deepgram-en", availableProfileIds, captureProvider: "native-deepgram" })),
    { profileId: "recall-en", availableProfileIds: ["recall-en"], captureProvider: "native-deepgram" },
    ...[null, 0, {}, ["recall-v2"], new String("recall-v2")].map(captureProvider => ({ profileId: "recall-en", availableProfileIds: ["recall-en"], captureProvider })),
  ]) assert.equal(owner.parsePublicTranscriptionSettings(value), null);
  assert.deepEqual(owner.getAvailableTranscriptionProfiles({ availableProfileIds: new Array(1) }), []);
  const validSubset = { profileId: "deepgram-zh", availableProfileIds: ["deepgram-zh"], captureProvider: "native-deepgram" };
  assert.deepEqual(owner.parsePublicTranscriptionSettings(validSubset), validSubset);
});

test("actual Account-to-LiveSession native start freezes the profile and publishes no authorization", async t => {
  const { account } = accountFixture(t);
  const requests = [];
  let selected = "deepgram-en";
  t.mock.method(globalThis, "fetch", async (_url, init) => { const input = JSON.parse(init.body); requests.push(input); return Response.json(grant(input.transcriptionProfile)); });
  const f = sessionFixture(t, { transcriptionProfile: () => selected,
    createSession: (sessionId, signal, profileId) => account.createNativeCaptureSession(sessionId, signal, profileId) });
  assert.equal(f.service.getSnapshot().provider, "native-deepgram");
  assert.equal((await f.service.start()).success, true);
  selected = "deepgram-zh";
  assert.equal(f.service.getSnapshot().transcription.id, "deepgram-en");
  assert.equal(f.service.getSnapshot().captureStatus, "recording");
  assert.equal(f.captures[0].calls.find(([name]) => name === "start")[1].kind, "native-deepgram");
  assert.equal(f.captures[0].calls.find(([name]) => name === "start")[1].transcriptionProfile, "deepgram-en");
  assert.equal(requests[0].transcriptionProfile, "deepgram-en");
  assert.doesNotMatch(JSON.stringify(f.snapshots), /fixture\.temporary\.jwt|fixture-account-bearer|accessToken|uploadToken/);
  assert.equal((await f.service.stop()).success, true);
  assert.equal((await f.service.start()).success, true);
  assert.equal(f.service.getSnapshot().transcription.id, "deepgram-zh");
  assert.equal(requests[1].transcriptionProfile, "deepgram-zh");
});

test("LiveSession native profile mismatch never starts recording and retains the prepared owner for stop", async t => {
  for (const returnedProfile of ["deepgram-zh", undefined, "recall-en"]) {
    const authorization = { ...grant(), transcriptionProfile: returnedProfile };
    const f = sessionFixture(t, { createSession: async () => authorization });
    const result = await f.service.start();
    assert.equal(result.success, false);
    assert.match(result.error, /转录配置/);
    assert.equal(f.captures.length, 1);
    assert.deepEqual(f.captures[0].calls.map(([name]) => name), ["prepare"]);
    assert.equal(f.service.getSnapshot().captureNeedsCleanup, true);
    assert.equal(f.service.getSnapshot().provider, "native-deepgram");
    assert.equal((await f.service.stop()).success, true);
    assert.deepEqual(f.captures[0].calls.map(([name]) => name), ["prepare", "stop", "dispose"]);
  }
});

test("cancelling pending native authorization aborts the actual Account request and ignores its late response", async t => {
  const { account } = accountFixture(t), pending = deferred();
  let transportSignal;
  t.mock.method(globalThis, "fetch", async (_url, init) => { transportSignal = init.signal; return pending.promise; });
  const f = sessionFixture(t, { createSession: (sessionId, signal, profileId) => account.createNativeCaptureSession(sessionId, signal, profileId) });
  const starting = f.service.start();
  await tick();
  assert.equal(f.service.getSnapshot().captureStatus, "starting");
  assert.equal((await f.service.stop()).success, true);
  assert.equal(transportSignal.aborted, true);
  pending.resolve(Response.json(grant()));
  assert.equal((await starting).success, false);
  assert.equal(f.captures.length, 1);
  assert.deepEqual(f.captures[0].calls.map(([name]) => name), ["prepare", "stop", "dispose"]);
  assert.equal(f.service.getSnapshot().captureStatus, "ended");
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, false);
});

test("native pause/resume reuses capture, preserves sources and fences new rows before synchronous resume callbacks", async t => {
  const f = sessionFixture(t);
  assert.equal((await f.service.start()).success, true);
  const capture = f.captures[0];
  capture.callbacks.onTranscript(segment("old-system", "system", "unfinished", false));
  assert.equal((await f.service.pause()).success, true);
  capture.callbacks.onTranscript(segment("old-system", "system", "final before resume", true, 2));
  capture.onResume = () => {
    capture.callbacks.onTranscript(segment("new-system", "system", "new system interval", true, 3));
    capture.callbacks.onTranscript(segment("new-mic", "microphone", "new microphone interval", true, 3));
    capture.callbacks.onTranscript(segment("old-system", "system", "late final correction", true, 4));
  };
  assert.equal((await f.service.resume()).success, true);
  const snapshot = f.service.getSnapshot();
  assert.equal(snapshot.provider, "native-deepgram");
  assert.deepEqual(snapshot.transcripts.map(({ id, source, captureEpoch }) => ({ id, source, captureEpoch })), [
    { id: "old-system", source: "system", captureEpoch: 0 },
    { id: "new-system", source: "system", captureEpoch: 1 },
    { id: "new-mic", source: "microphone", captureEpoch: 1 },
  ]);
  assert.equal(snapshot.transcripts[0].text, "late final correction");
  assert.equal(f.requests.length, 1);
  assert.equal(f.captures.length, 1);
  assert.equal((await f.service.stop()).success, true);
  assert.deepEqual(capture.calls.map(([name]) => name), ["prepare", "start", "pause", "resume", "stop", "dispose"]);
  assert.equal(f.service.getSnapshot().transcripts.length, 3);
});


test("native permission preparation completes before any token grant or recording start", async t => {
  const preparation = deferred(), order = [];
  let selected = "deepgram-en";
  const f = sessionFixture(t, { transcriptionProfile: () => selected,
    async createSession(_id, _signal, profile) { order.push("grant"); assert.equal(profile, "deepgram-en"); return grant(profile); },
  });
  const factory = f.deps.createCapture;
  f.deps.createCapture = callbacks => {
    order.push("construct");
    const capture = factory(callbacks), start = capture.start;
    capture.prepare = async signal => { capture.calls.push(["prepare", signal]); order.push("prepare"); await preparation.promise; signal.throwIfAborted(); order.push("prepared"); };
    capture.start = async authorization => { order.push("start"); return start(authorization); };
    return capture;
  };
  const starting = f.service.start();
  await tick();
  selected = "deepgram-zh";
  assert.deepEqual(order, ["construct", "prepare"]);
  assert.equal(f.service.getSnapshot().captureStatus, "starting");
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, true);
  assert.equal(f.service.getSnapshot().startedAt, undefined);
  assert.deepEqual(f.service.getSnapshot().transcripts, []);
  assert.equal(f.captures[0].calls.some(([name]) => name === "start"), false);
  preparation.resolve();
  assert.equal((await starting).success, true);
  assert.deepEqual(order, ["construct", "prepare", "prepared", "grant", "start"]);
  assert.equal(f.service.getSnapshot().transcription.id, "deepgram-en");
});

test("cancelling permission preparation never mints a token or starts audio and disposes its owner", async t => {
  const preparation = deferred();
  let prepareSignal, grants = 0;
  const f = sessionFixture(t, { async createSession() { grants++; return grant(); } });
  const factory = f.deps.createCapture;
  f.deps.createCapture = callbacks => {
    const capture = factory(callbacks);
    capture.prepare = async signal => { prepareSignal = signal; capture.calls.push(["prepare"]); await preparation.promise; signal.throwIfAborted(); };
    return capture;
  };
  const starting = f.service.start();
  await tick();
  assert.equal(grants, 0);
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, true);
  assert.equal((await f.service.stop()).success, true);
  assert.equal(prepareSignal.aborted, true);
  assert.deepEqual(f.captures[0].calls.map(([name]) => name), ["prepare", "stop", "dispose"]);
  preparation.resolve();
  assert.equal((await starting).success, false);
  assert.equal(grants, 0);
  assert.equal(f.service.getSnapshot().captureStatus, "ended");
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, false);
  assert.deepEqual(f.service.getSnapshot().transcripts, []);
});

test("a failed grant retains the prepared native owner until explicit bounded cleanup and retry", async t => {
  let grants = 0;
  const f = sessionFixture(t, { async createSession() { grants++; throw new Error("safe grant refusal"); } });
  const result = await f.service.start();
  assert.equal(result.success, false);
  assert.match(result.error, /safe grant refusal/);
  assert.equal(f.service.getSnapshot().captureStatus, "error");
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, true);
  assert.deepEqual(f.captures[0].calls.map(([name]) => name), ["prepare"]);
  assert.equal((await f.service.start()).success, false);
  assert.equal(grants, 1);
  let disposeAttempts = 0;
  const capture = f.captures[0], dispose = capture.dispose;
  capture.dispose = async () => { if (++disposeAttempts === 1) throw new Error("safe helper cleanup refusal"); return dispose(); };
  assert.equal((await f.service.stop()).success, false);
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, true);
  assert.equal((await f.service.start()).success, false);
  assert.equal((await f.service.stop()).success, true);
  assert.equal(disposeAttempts, 2);
  assert.equal(f.service.getSnapshot().captureNeedsCleanup, false);
  f.deps.createSession = async () => grant();
  assert.equal((await f.service.start()).success, true);
  assert.equal(f.captures.length, 2);
});
