import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
function production(mocks = {}) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename);
    const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module.exports);
    new Function("require", "module", "exports", javascript)(id => {
      if (id in mocks) return mocks[id];
      if (id.startsWith(".")) return load(path.relative(root, path.resolve(path.dirname(filename), `${id}.ts`)));
      return require(id);
    }, module, module.exports);
    cache.set(filename, module.exports);
    return module.exports;
  }
  return load;
}

function temp(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "passwisely-transcription-test-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function settingsFixture(context) {
  const directory = temp(context);
  const load = production({ electron: { app: { getPath: () => directory }, safeStorage: {
    isEncryptionAvailable() { assert.fail("ASR preferences must not read or modify AI keys"); },
  } } });
  const { SettingsStore } = load("electron/settings.ts");
  return { store: new SettingsStore(), directory, filename: path.join(directory, "settings.json") };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function sessionFixture(context, extra = {}) {
  const captures = [], uploads = [];
  const { LiveSessionService } = production()("electron/live/LiveSessionService.ts");
  const service = new LiveSessionService({
    support: { supported: true },
    async createUpload(sessionId, signal, profileId) { uploads.push({ sessionId, signal, profileId }); return { uploadToken: "fixture", apiUrl: "https://ap-northeast-1.recall.ai", transcriptionProfile: profileId }; },
    createCapture(callbacks) {
      const capture = { calls: [],
        async start() { capture.calls.push("start"); callbacks.onState("recording"); },
        async pause() { capture.calls.push("pause"); callbacks.onState("paused"); },
        async resume() { capture.calls.push("resume"); callbacks.onState("recording"); },
        async stop() { capture.calls.push("stop"); callbacks.onState("ended"); },
        async dispose() { capture.calls.push("dispose"); },
      };
      captures.push(capture);
      return capture;
    },
    pendingScreenshots: () => [], images: async () => [], consumeScreenshots: async () => ({ success: true }),
    language: () => "zh-CN", publish() {}, stream: async () => assert.fail("No model request expected"),
    ...extra,
  });
  context.after(() => service.dispose());
  return { service, captures, uploads };
}

test("ASR default is English and reading the preference does not create or migrate settings", context => {
  const { store, filename } = settingsFixture(context);
  assert.deepEqual(store.getTranscriptionSettings(), { profileId: "recall-en" });
  assert.equal(fs.existsSync(filename), false);
});

test("saving ASR preserves AI language/provider, backs up exact bytes once, and protects both files", context => {
  const { store, filename } = settingsFixture(context);
  const original = '{\n "activeProvider":"kimi", "responseLanguage":"en", "model":"legacy-fixture", "custom":{"kept":true}\n}\n';
  fs.writeFileSync(filename, original, { mode: 0o644 });
  assert.deepEqual(store.saveTranscriptionSettings({ profileId: "deepgram-zh" }), { profileId: "deepgram-zh" });
  const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
  assert.equal(saved.activeProvider, "kimi"); assert.equal(saved.responseLanguage, "en");
  assert.equal(saved.model, "legacy-fixture"); assert.deepEqual(saved.custom, { kept: true });
  const backup = `${filename}.before-transcription.bak`;
  assert.equal(fs.readFileSync(backup, "utf8"), original);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  store.saveTranscriptionSettings({ profileId: "recall-zh" });
  store.saveTranscriptionSettings({ profileId: "recall-zh" });
  assert.equal(fs.readFileSync(backup, "utf8"), original);
  assert.deepEqual(store.getTranscriptionSettings(), { profileId: "recall-zh" });
});

test("ASR persistence rejects unknown inputs and preserves malformed existing settings", context => {
  const { store, filename } = settingsFixture(context);
  for (const input of [null, [], "deepgram-zh", {}, { profileId: 2 }, { profileId: "zh" }, { profileId: "recall-en", responseLanguage: "en" }]) {
    assert.throws(() => store.saveTranscriptionSettings(input), /transcription/i);
    assert.equal(fs.existsSync(filename), false);
  }
  for (const content of ['{malformed', '[]', 'null']) {
    fs.writeFileSync(filename, content);
    assert.throws(() => store.saveTranscriptionSettings({ profileId: "deepgram-zh" }));
    assert.equal(fs.readFileSync(filename, "utf8"), content);
    assert.equal(fs.existsSync(`${filename}.before-transcription.bak`), false);
  }
});

test("a conflicting backup path prevents ASR writes rather than replacing the original settings", context => {
  const { store, filename } = settingsFixture(context);
  const original = '{"responseLanguage":"en"}';
  fs.writeFileSync(filename, original);
  const backup = `${filename}.before-transcription.bak`;
  fs.mkdirSync(backup);
  assert.throws(() => store.saveTranscriptionSettings({ profileId: "deepgram-zh" }), /regular file/);
  assert.equal(fs.readFileSync(filename, "utf8"), original);
  assert.equal(fs.statSync(backup).isDirectory(), true);
});

test("new capture freezes profile before pending upload; pause/resume/end keep it and next start reads new preference", async context => {
  let profileId = "deepgram-zh";
  const pending = deferred(), requests = [];
  const f = sessionFixture(context, {
    transcriptionProfile: () => profileId,
    createUpload(sessionId, signal, requested) {
      requests.push({ sessionId, signal, profileId: requested });
      return requests.length === 1 ? pending.promise : Promise.resolve({ uploadToken: "fixture", apiUrl: "https://ap-northeast-1.recall.ai", transcriptionProfile: requested });
    },
  });
  const starting = f.service.start();
  const original = f.service.getSnapshot();
  assert.equal(original.transcription.id, "deepgram-zh"); assert.equal(original.transcription.language, "zh");
  profileId = "recall-zh";
  assert.equal(requests[0].profileId, "deepgram-zh");
  pending.resolve({ uploadToken: "fixture", apiUrl: "https://ap-northeast-1.recall.ai", transcriptionProfile: "deepgram-zh" });
  assert.equal((await starting).success, true);
  assert.equal((await f.service.pause()).success, true);
  profileId = "recall-en";
  assert.equal((await f.service.resume()).success, true);
  assert.equal((await f.service.stop()).success, true);
  const ended = f.service.getSnapshot();
  assert.equal(ended.sessionId, original.sessionId);
  assert.deepEqual(ended.transcription, original.transcription);
  assert.equal(requests.length, 1);
  assert.deepEqual(f.captures[0].calls, ["start", "pause", "resume", "stop", "dispose"]);
  assert.equal((await f.service.start()).success, true);
  assert.notEqual(f.service.getSnapshot().sessionId, original.sessionId);
  assert.equal(f.service.getSnapshot().transcription.language, "en");
  assert.equal(requests[1].profileId, "recall-en");
});

test("a changed or omitted Chinese response profile fails before native capture allocation", async context => {
  for (const response of [undefined, "recall-en", "recall-zh", null, 42]) {
    const f = sessionFixture(context, { transcriptionProfile: () => "deepgram-zh", async createUpload() {
      return { uploadToken: "fixture", apiUrl: "https://ap-northeast-1.recall.ai", transcriptionProfile: response };
    } });
    const result = await f.service.start();
    assert.equal(result.success, false); assert.match(result.error, /转录配置/);
    assert.equal(f.captures.length, 0); assert.equal(f.service.getSnapshot().captureNeedsCleanup, false);
  }
});

test("English legacy upload responses remain compatible but explicit mismatches are rejected", async context => {
  const legacy = sessionFixture(context, { async createUpload() { return { uploadToken: "fixture", apiUrl: "https://ap-northeast-1.recall.ai" }; } });
  assert.equal((await legacy.service.start()).success, true);
  const mismatch = sessionFixture(context, { async createUpload() { return { uploadToken: "fixture", apiUrl: "https://ap-northeast-1.recall.ai", transcriptionProfile: "deepgram-zh" }; } });
  assert.equal((await mismatch.service.start()).success, false);
  assert.equal(mismatch.captures.length, 0);
});

function ipcFixture(settingsOps) {
  const handles = new Map();
  const frame = {}, contents = { mainFrame: frame };
  let window = { isDestroyed: () => false, webContents: contents };
  const { initializeLiveIpc } = production({ electron: { ipcMain: { handle: (channel, operation) => handles.set(channel, operation) }, clipboard: { writeText() {} } } })("electron/live/ipc.ts");
  initializeLiveIpc({}, () => window, () => {}, () => false, settingsOps);
  return { handles, event: { sender: contents, senderFrame: frame }, contents, frame, setWindow: next => { window = next; } };
}

function mainSettingsOperations(state) {
  // Run the actual production registration callbacks without executing Electron's
  // app startup, reading login state, or constructing any model transport.
  const filename = path.join(root, "electron/main.ts");
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  let operations;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "initializeLiveIpc") {
      assert.equal(node.arguments.length, 5);
      operations = node.arguments[4].getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(operations, "production must register independent speech-settings callbacks");
  const javascript = ts.transpileModule(`module.exports = (${operations});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function("state", "module", javascript)(state, module);
  return module.exports;
}

test("speech preload IPC reaches independent settings operations and never configures or cancels active AI answers", async context => {
  const { store } = settingsFixture(context);
  const answer = deferred();
  let signal, configureCalls = 0;
  const f = sessionFixture(context, { async stream(_messages, abortSignal) { signal = abortSignal; return answer.promise; } });
  const boundary = ipcFixture(mainSettingsOperations({ settingsStore: store, processingHelper: { configure() { configureCalls++; } } }));
  const exposed = new Map();
  production({ electron: { contextBridge: { exposeInMainWorld: (name, api) => exposed.set(name, api) }, ipcRenderer: {
    invoke: (channel, ...args) => boundary.handles.get(channel)(boundary.event, ...args), on() {}, removeListener() {},
  } } })("electron/preload.ts");
  await f.service.ask({ question: "authored synthetic pending question", includeScreenshots: false });
  await tick();
  assert.ok(signal); assert.equal(signal.aborted, false);
  const api = exposed.get("electronAPI");
  assert.deepEqual(await api.getTranscriptionSettings(), { profileId: "recall-en" });
  assert.deepEqual(await api.saveTranscriptionSettings({ profileId: "deepgram-zh" }), { success: true, settings: { profileId: "deepgram-zh" } });
  assert.equal(signal.aborted, false);
  assert.equal(f.service.getSnapshot().answers[0].status, "preparing");
  assert.equal(configureCalls, 0);
  answer.resolve({ model: "fixture-only", choices: [{ message: { content: "authored result" } }] });
  await tick();
  assert.equal(f.service.getSnapshot().answers[0].status, "completed");
});

test("ASR settings IPC rejects foreign senders, subframes, stale windows and malformed input before persistence", async () => {
  let saves = 0, gets = 0;
  const boundary = ipcFixture({ get() { gets++; return { profileId: "recall-en" }; }, save(input) { saves++; return input; } });
  for (const channel of ["get-transcription-settings", "save-transcription-settings"]) {
    for (const event of [{ sender: {}, senderFrame: boundary.frame }, { sender: boundary.contents, senderFrame: {} }]) {
      assert.throws(() => boundary.handles.get(channel)(event, { profileId: "deepgram-zh" }), /Untrusted/);
    }
  }
  for (const input of [undefined, null, [], "deepgram-zh", {}, { profileId: "unknown" }, { profileId: "recall-en", apiKey: "synthetic-disallowed-field" }]) {
    assert.equal((await boundary.handles.get("save-transcription-settings")(boundary.event, input)).success, false);
  }
  assert.equal(saves, 0); assert.equal(gets, 0);
  boundary.setWindow(null);
  assert.throws(() => boundary.handles.get("get-transcription-settings")(boundary.event), /Untrusted/);
  const optional = ipcFixture();
  assert.equal((await optional.handles.get("live-copy-text")(optional.event, "authored clipboard")).success, true);
});

test("Account upload request carries profile and rejects token/origin/profile corruption without leaking to capture", async context => {
  const directory = temp(context), calls = [];
  const previousFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = previousFetch; });
  const { AccountService } = production({ electron: { app: { getPath: () => directory }, safeStorage: { isEncryptionAvailable: () => false } } })("electron/account.ts");
  const account = new AccountService();
  account.getToken = () => "authored-fixture-not-a-real-token";
  const valid = { uploadToken: "authored-upload", uploadId: "authored-id", apiUrl: "https://ap-northeast-1.recall.ai", transcriptionProfile: "deepgram-zh" };
  globalThis.fetch = async (_url, input) => { calls.push(JSON.parse(input.body)); return Response.json(valid); };
  const result = await account.createRecallUpload("authored-session-id", new AbortController().signal, "deepgram-zh");
  assert.equal(result.transcriptionProfile, "deepgram-zh");
  assert.deepEqual(calls[0], { sessionId: "authored-session-id", transcriptionProfile: "deepgram-zh" });
  for (const broken of [
    { ...valid, transcriptionProfile: "recall-en" }, { ...valid, transcriptionProfile: undefined },
    { ...valid, uploadToken: "" }, { ...valid, uploadToken: 1 },
    { ...valid, apiUrl: "https://ap-northeast-1.recall.ai.evil.test" }, { ...valid, apiUrl: "http://ap-northeast-1.recall.ai" },
  ]) {
    globalThis.fetch = async () => Response.json(broken);
    await assert.rejects(account.createRecallUpload("authored-session-id", new AbortController().signal, "deepgram-zh"));
  }
  globalThis.fetch = async () => Response.json({ ...valid, transcriptionProfile: undefined });
  assert.equal((await account.createRecallUpload("authored-session-id", new AbortController().signal)).uploadToken, "authored-upload");
});

test("default and explicit English uploads remain compatible with the strict sessionId-only legacy token route", async context => {
  const directory = temp(context), requests = [];
  const previousFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = previousFetch; });
  const { AccountService } = production({ electron: { app: { getPath: () => directory }, safeStorage: { isEncryptionAvailable: () => false } } })("electron/account.ts");
  const account = new AccountService();
  account.getToken = () => "authored-fixture-not-a-real-token";
  globalThis.fetch = async (_url, input) => {
    const body = JSON.parse(input.body);
    requests.push(body);
    // Match the production legacy route's fail-closed request schema.
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some(key => key !== "sessionId")) {
      return Response.json({ error: "Only a sessionId UUID is accepted.", code: "INVALID_SESSION_REQUEST" }, { status: 400 });
    }
    return Response.json({ uploadToken: "authored-upload", uploadId: "authored-id", apiUrl: "https://ap-northeast-1.recall.ai" });
  };
  const signal = new AbortController().signal;
  const sessionId = "0d27f8e0-a559-4a27-a93b-876d27751a6e";
  assert.equal((await account.createRecallUpload(sessionId, signal)).uploadToken, "authored-upload");
  assert.equal((await account.createRecallUpload(sessionId, signal, "recall-en")).uploadToken, "authored-upload");
  assert.deepEqual(requests.slice(0, 2), [{ sessionId }, { sessionId }]);
  // A Chinese opt-in must still be explicit and must not fall back silently.
  for (const profileId of ["deepgram-zh", "recall-zh"]) {
    await assert.rejects(account.createRecallUpload(sessionId, signal, profileId), /Only a sessionId/);
    assert.deepEqual(requests.at(-1), { sessionId, transcriptionProfile: profileId });
  }
});
