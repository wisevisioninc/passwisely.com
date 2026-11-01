import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { EventEmitter } from "node:events";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const sourcePath = relative => new URL(`../../electron/${relative}`, import.meta.url).pathname;
const item = (snapshot, id) => { const found = snapshot.items.find(value => value.id === id); assert.ok(found, `missing ${id}`); return found; };
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(context, options = {}) {
  const directory = options.directory || fs.mkdtempSync(path.join(os.tmpdir(), "passwisely-permission-test-"));
  if (!options.directory) context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  if (options.marker !== undefined) fs.writeFileSync(path.join(directory, "capture-permission-guide.json"), options.marker);
  const effects = [], reads = [], writes = [];
  const state = {
    now: 1000, media: { screen: "unknown", microphone: "unknown", ...options.media }, trusted: false, audio: null,
    capture: { captureNeedsCleanup: false, captureStatus: "idle", platformSupported: true, ...options.capture },
  };
  const fileSystem = { ...fs,
    readFileSync(...args) { reads.push(["file", ...args]); return fs.readFileSync(...args); },
    mkdirSync(...args) { writes.push(["mkdir", ...args]); return fs.mkdirSync(...args); },
    copyFileSync(...args) { writes.push(["backup", ...args]); return fs.copyFileSync(...args); },
    openSync(...args) { writes.push(["open", ...args]); return fs.openSync(...args); },
    writeFileSync(...args) { writes.push(["write", ...args]); return fs.writeFileSync(...args); },
    renameSync(...args) { writes.push(["rename", ...args]); return fs.renameSync(...args); },
    unlinkSync(...args) { writes.push(["unlink", ...args]); return fs.unlinkSync(...args); },
  };
  const deps = {
    platform: options.platform || "darwin", architecture: options.architecture || "x64",
    mediaStatus(type) { reads.push(["media", type]); const value = state.media[type]; return typeof value === "function" ? value() : value; },
    async askMicrophone() { effects.push(["microphone"]); return options.microphone ? options.microphone(state) : false; },
    accessibilityTrusted() { reads.push(["accessibility"]); if (typeof state.trusted === "function") return state.trusted(); return state.trusted; },
    async probeScreen() { effects.push(["probe"]); if (options.probe) return options.probe(state); },
    async openSettings(url) { effects.push(["settings", url]); },
    audioSnapshot() { reads.push(["audio"]); return state.audio; },
    async prepareAudio(input) { effects.push(["prepare", input]); return options.prepare ? options.prepare(state, input) : { success: true, permissions: state.audio, cleanupRequired: false }; },
    captureState() { reads.push(["capture"]); return { ...state.capture }; },
    recallApiUrl() { return "https://fixture.example/api/recall"; }, now: () => state.now,
  };
  const load = createProductionTsLoader({ mocks: { "node:fs": fileSystem }, env: {}, console: { log() {}, error() {} } });
  const { PermissionService } = load(sourcePath("PermissionService.ts"));
  return { service: new PermissionService(deps), state, deps, directory, effects, reads, writes, PermissionService };
}

test("constructor and snapshots only observe state, without capture, authorization, settings or persistence", context => {
  const f = fixture(context, { architecture: "arm64" });
  assert.deepEqual(f.reads, [], "construction does not perform a second screen query before startup");
  const first = f.service.snapshot(); f.state.now = 2000; const second = f.service.snapshot();
  assert.equal("firstRun" in first, false); assert.equal(second.audioCheckBusy, false);
  assert.equal(item(second, "screen").status, "unknown");
  assert.equal(item(second, "microphone").status, "unknown");
  assert.deepEqual(f.effects, []); assert.deepEqual(f.writes, []);
  assert.deepEqual(fs.readdirSync(f.directory), []);
});

test("Intel Big Sur audio support failure does not block independent screen permission probing", async context => {
  const f = fixture(context, {
    media: { screen: "denied" }, capture: { platformSupported: false, platformMessage: "Intel audio requires macOS 13+" },
    probe(state) { state.media.screen = "granted"; },
  });
  const before = f.service.snapshot();
  assert.equal(before.audioSupported, false); assert.equal(item(before, "system-audio").status, "unsupported");
  assert.equal(item(before, "system-audio").action, "none");
  assert.equal(item(before, "screen").action, "request");
  const result = await f.service.request("screen");
  assert.equal(result.success, true); assert.equal(item(result.snapshot, "screen").status, "granted");
  assert.equal(result.snapshot.restartRecommended, true);
  assert.deepEqual(f.effects, [["probe"]]);
  const audio = await f.service.request("system-audio");
  assert.equal(audio.success, false); assert.match(audio.error, /macOS 13/);
  assert.deepEqual(f.effects, [["probe"]]);
});

test("Mac denied screen first attempts the real probe, then offers the exact controlled settings destination", async context => {
  const f = fixture(context, { media: { screen: "denied" }, probe() { throw "Failed to get sources."; } });
  assert.equal(item(f.service.snapshot(), "screen").action, "request");
  const result = await f.service.request("screen");
  assert.equal(result.success, false); assert.equal(result.error, "Failed to get sources.");
  assert.equal(item(result.snapshot, "screen").status, "denied");
  assert.equal(item(result.snapshot, "screen").action, "settings");
  assert.equal((await f.service.settings("screen")).success, true);
  assert.deepEqual(f.effects, [["probe"], ["settings", "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"]]);
});

test("probe success never invents a granted OS status, and unreadable statuses stay unknown", async context => {
  for (const status of ["granted", "unknown", "not-determined", "unexpected", () => { throw new Error("unreadable"); }]) {
    const f = fixture(context, { media: { screen: status } });
    const result = await f.service.request("screen");
    assert.equal(result.success, true);
    const expected = ["granted", "not-determined"].includes(status) ? status : "unknown";
    assert.equal(item(result.snapshot, "screen").status, expected);
    assert.equal(result.snapshot.restartRecommended, false);
    assert.deepEqual(f.effects, [["probe"]]);
  }
});

test("restart advice follows observed missing screen permission within this launch, including revocation after startup", context => {
  for (const initial of ["granted", "unknown"]) {
    const f = fixture(context, { media: { screen: initial, microphone: "granted" } });
    const startup = f.service.startupCheck();
    assert.equal(startup.snapshot.restartRecommended, false);
    f.state.media.screen = "denied";
    assert.equal(f.service.snapshot().restartRecommended, false);
    f.state.media.screen = "granted";
    assert.equal(f.service.snapshot().restartRecommended, true, `${initial} → denied → granted needs restart advice`);
    assert.equal(f.service.startupCheck(), startup, "manual changes do not replace the cached startup decision");
    assert.equal(startup.snapshot.restartRecommended, false);
    assert.deepEqual(f.effects, []); assert.deepEqual(f.writes, []);
  }
  const unknown = fixture(context, { media: { screen: "unknown", microphone: "granted" } });
  unknown.service.startupCheck();
  unknown.state.media.screen = "granted";
  assert.equal(unknown.service.snapshot().restartRecommended, false, "unknown → granted alone cannot prove a new authorization");
  assert.deepEqual(unknown.effects, []); assert.deepEqual(unknown.writes, []);
});

test("Mac microphone asks only from not-determined and reports the actual state after the prompt", async context => {
  const first = fixture(context, { media: { microphone: "not-determined" }, microphone(state) { state.media.microphone = "denied"; return false; } });
  const refused = await first.service.request("microphone");
  assert.equal(refused.success, true); assert.equal(item(refused.snapshot, "microphone").status, "denied");
  assert.deepEqual(first.effects, [["microphone"]]);
  await first.service.request("microphone");
  assert.deepEqual(first.effects.at(-1), ["settings", "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"]);
  for (const status of ["granted", "denied", "restricted", "unknown"]) {
    const f = fixture(context, { media: { microphone: status } });
    const result = await f.service.request("microphone");
    assert.equal(item(result.snapshot, "microphone").status, status);
    assert.deepEqual(f.effects, status === "granted" ? [] : [["settings", "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"]]);
  }
});

test("Windows uses desktop screen tests and Windows settings without Mac microphone, accessibility or audio permission APIs", async context => {
  const f = fixture(context, { platform: "win32", media: { screen: "denied", microphone: "not-determined" } });
  assert.equal(item(f.service.snapshot(), "screen").status, "not-required");
  await f.service.request("screen"); await f.service.request("microphone"); await f.service.request("system-audio");
  assert.deepEqual(f.effects, [["probe"], ["settings", "ms-settings:privacy-microphone"], ["settings", "ms-settings:sound"]]);
  assert.equal(f.reads.some(([kind]) => kind === "accessibility"), false);
  assert.equal(f.service.snapshot().restartRecommended, false);
});

test("audio preflight invokes only its actual owner and preserves the timestamp of retained evidence", async context => {
  const f = fixture(context, { architecture: "arm64", prepare: () => ({ success: true, permissions: { systemAudio: { status: "granted", observedAt: 1500 } }, cleanupRequired: false }) });
  f.state.audio = { microphone: { status: "unknown" }, systemAudio: { status: "denied", observedAt: 100 } };
  const before = f.service.snapshot(); f.state.now = 5000;
  const result = await f.service.request("system-audio");
  assert.equal(result.success, true);
  assert.deepEqual(f.effects, [["prepare", { recallApiUrl: "https://fixture.example/api/recall" }]]);
  assert.equal(item(before, "system-audio").observedAt, 100);
  assert.equal(item(result.snapshot, "system-audio").observedAt, 100);
  assert.equal(item(result.snapshot, "system-audio").status, "denied", "successful operation acknowledgement is not a replacement observation");
  f.state.audio.systemAudio = { status: "granted", observedAt: 4500 };
  assert.equal(item(f.service.snapshot(), "system-audio").observedAt, 4500);
  assert.deepEqual(f.writes, []);
});

test("current accessibility trust distinguishes known not-granted from unknown without reusing provider history", context => {
  const f = fixture(context, { architecture: "arm64" });
  f.state.audio = { microphone: { status: "unknown" }, systemAudio: { status: "unknown" }, accessibility: { status: "denied", observedAt: 80 } };
  const retained = item(f.service.snapshot(), "accessibility");
  assert.equal(retained.status, "not-granted"); assert.equal(retained.observedAt, 1000);
  f.state.audio.accessibility = { status: "granted", observedAt: 90 };
  assert.equal(item(f.service.snapshot(), "accessibility").status, "not-granted", "current absent trust cannot reuse a historical grant");
  f.state.audio = null;
  assert.equal(item(f.service.snapshot(), "accessibility").status, "not-granted");
  f.state.trusted = true;
  assert.equal(item(f.service.snapshot(), "accessibility").status, "granted");
  for (const value of [undefined, "true", () => { throw new Error("unreadable"); }]) {
    f.state.trusted = value;
    const unreadable = item(f.service.snapshot(), "accessibility");
    assert.equal(unreadable.status, "unknown"); assert.equal(unreadable.observedAt, undefined);
  }
});

test("startup caches one current OS check, while manual snapshots stay fresh and the next launch rechecks", context => {
  const f = fixture(context, { architecture: "arm64", media: { screen: "granted", microphone: "granted" } });
  f.state.trusted = true;
  const startup = f.service.startupCheck();
  assert.equal(startup.shouldPrompt, false);
  assert.equal(item(startup.snapshot, "system-audio").status, "unknown", "uninitialized audio is not a grant and does not force the guide");
  assert.deepEqual(f.reads.filter(([kind]) => kind === "media" || kind === "accessibility"), [["media", "screen"], ["media", "microphone"], ["accessibility"]]);
  const reads = f.reads.length;
  f.state.media.screen = "denied"; f.state.trusted = false; f.state.now = 2000;
  assert.equal(f.service.startupCheck(), startup);
  assert.equal(f.reads.length, reads, "repeated startup getters never query or operate again");
  const manual = f.service.snapshot();
  assert.equal(item(manual, "screen").status, "denied");
  assert.equal(item(manual, "accessibility").status, "not-granted");
  assert.equal(startup.shouldPrompt, false); assert.equal(item(startup.snapshot, "screen").status, "granted");
  const nextLaunch = new f.PermissionService(f.deps).startupCheck();
  assert.equal(nextLaunch.shouldPrompt, true); assert.equal(item(nextLaunch.snapshot, "screen").observedAt, 2000);
  assert.deepEqual(f.effects, []); assert.deepEqual(f.writes, []);
});

test("startup prompts for known missing OS permission only, independently of SDK history and audio capability", context => {
  const cases = [
    { media: { screen: "not-determined" }, expected: true },
    { media: { screen: "denied" }, expected: true },
    { media: { screen: "restricted" }, expected: true },
    { media: { microphone: "not-determined" }, expected: true },
    { media: { microphone: "denied" }, expected: true },
    { media: { microphone: "restricted" }, expected: true },
    { media: { screen: "unknown", microphone: "unknown" }, expected: false },
    { media: { screen: () => { throw new Error("unreadable"); }, microphone: "unexpected" }, expected: false },
    { architecture: "arm64", trusted: false, expected: true },
    { architecture: "arm64", trusted: () => { throw new Error("unreadable"); }, expected: false },
    { architecture: "arm64", trusted: false, media: { microphone: "denied" }, capture: { platformSupported: false }, expected: false },
    { media: { screen: "denied", microphone: "denied" }, capture: { platformSupported: false }, expected: true },
    { platform: "win32", media: { screen: "denied", microphone: "unknown" }, expected: false },
    { platform: "win32", media: { microphone: "denied" }, expected: true },
    { platform: "win32", media: { microphone: "restricted" }, capture: { platformSupported: false }, expected: false },
    { platform: "linux", media: { screen: "denied", microphone: "denied" }, expected: false },
  ];
  for (const entry of cases) {
    const f = fixture(context, { ...entry, media: { screen: "granted", microphone: "granted", ...entry.media } });
    f.state.trusted = entry.trusted ?? true;
    f.state.audio = { microphone: { status: "denied", observedAt: 1 }, systemAudio: { status: "denied", observedAt: 1 }, accessibility: { status: "granted", observedAt: 1 } };
    assert.equal(f.service.startupCheck().shouldPrompt, entry.expected, JSON.stringify(entry));
    assert.deepEqual(f.effects, []); assert.deepEqual(f.writes, []);
    assert.equal(f.reads.some(([kind]) => kind === "file"), false);
  }
});

test("an old acknowledged marker neither suppresses missing permissions nor forces the guide for granted permissions", context => {
  const original = '{"version":1,"acknowledgedAt":50}\n';
  for (const status of ["denied", "granted"]) {
    const f = fixture(context, { marker: original, media: { screen: status, microphone: "granted" } });
    assert.equal(f.service.startupCheck().shouldPrompt, status === "denied");
    assert.equal(fs.readFileSync(path.join(f.directory, "capture-permission-guide.json"), "utf8"), original);
    assert.equal(typeof f.service.acknowledge, "undefined");
    assert.equal(f.reads.some(([kind]) => kind === "file"), false);
    assert.deepEqual(f.writes, []);
  }
});

function ipcFixture(service) {
  const handlers = new Map(), effects = [], frame = {};
  let available = true, destroyed = false;
  const win = { isDestroyed: () => destroyed, webContents: { mainFrame: frame, send: (...args) => effects.push(["send", ...args]) } };
  const { initializePermissionIpc } = createProductionTsLoader({ env: {}, mocks: { electron: { ipcMain: { handle: (name, callback) => handlers.set(name, callback) } } } })(sourcePath("permissionsIpc.ts"));
  initializePermissionIpc(service, () => available ? win : null, async () => { effects.push(["restart"]); return { success: true }; });
  return { handlers, effects, event: { sender: win.webContents, senderFrame: frame }, win,
    setAvailable(value) { available = value; }, setDestroyed(value) { destroyed = value; } };
}

test("actual main startup boundary continues on a cached failure; IPC repeats the failure and manual checks can recover", context => {
  const source = fs.readFileSync(sourcePath("main.ts"), "utf8");
  const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true), calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(ast) === "permissions" && node.expression.name.text === "startupCheck") calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(calls.length, 1);
  const statement = calls[0].parent, block = statement.parent, boundary = block.parent;
  assert.ok(ts.isExpressionStatement(statement) && ts.isBlock(block) && ts.isTryStatement(boundary) && boundary.tryBlock === block);
  const javascript = ts.transpileModule(`${boundary.getText(ast)}; return "application-continues";`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const owner of ["captureState", "audioSnapshot"]) {
    const f = fixture(context, { media: { screen: "granted", microphone: "granted" } });
    const failure = new Error(`fixture ${owner} snapshot clone failed`), original = f.deps[owner];
    f.deps[owner] = () => { f.reads.push([owner]); throw failure; };
    assert.equal(new Function("permissions", javascript)(f.service), "application-continues");
    const reads = f.reads.length, h = ipcFixture(f.service);
    for (let replay = 0; replay < 2; replay++) {
      assert.throws(() => h.handlers.get("capture-permissions-startup")(h.event), error => error === failure);
      assert.equal(f.reads.length, reads, "a rejected startup observation is cached without OS retries");
    }
    f.deps[owner] = original;
    const manual = h.handlers.get("capture-permissions-get")(h.event);
    assert.equal(item(manual, "screen").status, "granted");
    assert.equal(item(manual, "microphone").status, "granted");
    assert.ok(f.reads.length > reads, "manual checks retain a fresh recovery path");
    const afterManual = f.reads.length;
    assert.throws(() => h.handlers.get("capture-permissions-startup")(h.event), error => error === failure);
    assert.equal(f.reads.length, afterManual, "manual recovery never silently retries the failed startup check");
    assert.equal(new f.PermissionService(f.deps).startupCheck().shouldPrompt, false, "a new launch starts a new check");
    assert.deepEqual(f.effects, []); assert.deepEqual(f.writes, []); assert.deepEqual(h.effects, []);
  }
});

test("startup and manual IPC expose their owners through the actual preload without an acknowledgement API", async context => {
  const f = fixture(context, { media: { screen: "denied", microphone: "granted" } });
  const startup = f.service.startupCheck();
  const h = ipcFixture(f.service), exposed = new Map();
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => exposed.set(name, value) },
    ipcRenderer: { invoke: (channel, input) => Promise.resolve(h.handlers.get(channel)(h.event, input)), on() {}, removeListener() {} },
  };
  createProductionTsLoader({ mocks: { electron }, env: {}, console: { log() {}, error() {} } })(sourcePath("preload.ts"));
  const api = exposed.get("electronAPI"); assert.ok(api);
  assert.equal(await api.getCapturePermissionStartupCheck(), startup);
  assert.equal(startup.shouldPrompt, true);
  const reads = f.reads.length;
  f.state.media.screen = "granted";
  assert.equal(await api.getCapturePermissionStartupCheck(), startup);
  assert.equal(f.reads.length, reads);
  const refreshed = await api.getCapturePermissions();
  assert.equal(item(refreshed, "screen").status, "granted");
  assert.equal(item(startup.snapshot, "screen").status, "denied");
  assert.equal(typeof api.acknowledgeCapturePermissionGuide, "undefined");
  assert.equal(h.handlers.has("capture-permissions-acknowledge"), false);
  assert.deepEqual(f.effects, []); assert.deepEqual(f.writes, []);
});

test("permission IPC rejects foreign senders, iframes, missing frames and stale windows before any operation", () => {
  const calls = [];
  const service = { startupCheck() { calls.push("startup"); return {}; }, snapshot() { calls.push("get"); return {}; }, request() { calls.push("request"); }, settings() { calls.push("settings"); } };
  const h = ipcFixture(service);
  for (const handler of h.handlers.values()) {
    for (const event of [{ sender: {}, senderFrame: h.event.senderFrame }, { sender: h.win.webContents, senderFrame: {} }, { sender: h.win.webContents }]) {
      assert.throws(() => handler(event, "screen"), /Untrusted permission caller/);
    }
    h.setAvailable(false); assert.throws(() => handler(h.event, "screen"), /Untrusted/); h.setAvailable(true);
    h.setDestroyed(true); assert.throws(() => handler(h.event, "screen"), /Untrusted/); h.setDestroyed(false);
  }
  assert.deepEqual(calls, []); assert.deepEqual(h.effects, []);
});

test("permission IPC accepts only named permission IDs without coercion or arbitrary settings URLs", () => {
  const calls = [];
  const service = { snapshot: () => ({}), request: id => calls.push(["request", id]), settings: id => calls.push(["settings", id]) };
  const h = ipcFixture(service);
  for (const [channel, kind] of [["capture-permissions-request", "request"], ["capture-permissions-settings", "settings"]]) {
    for (const id of ["screen", "microphone", "system-audio", "accessibility"]) h.handlers.get(channel)(h.event, id);
    assert.deepEqual(calls.splice(0), ["screen", "microphone", "system-audio", "accessibility"].map(id => [kind, id]));
    for (const id of [undefined, null, false, 1, [], {}, "camera", "SCREEN", "ms-settings:privacy-microphone", { toString() { assert.fail("must not coerce permission IDs"); } }]) {
      assert.throws(() => h.handlers.get(channel)(h.event, id), /Invalid capture permission/);
    }
  }
  h.handlers.get("capture-permissions-open")(h.event);
  assert.deepEqual(h.effects, [["send", "capture-permissions-needed"]]); assert.deepEqual(calls, []);
});

test("pending permission actions serialize requests and prevent controlled restart", async context => {
  const pending = deferred();
  const f = fixture(context, { probe: () => pending.promise });
  const h = ipcFixture(f.service);
  const probing = f.service.request("screen");
  assert.equal(f.service.snapshot().audioCheckBusy, true);
  assert.equal((await f.service.request("microphone")).success, false);
  assert.equal((await h.handlers.get("capture-permissions-restart")(h.event)).success, false);
  assert.deepEqual(f.effects, [["probe"]]); assert.deepEqual(f.writes, []); assert.deepEqual(h.effects, []);
  pending.resolve(); assert.equal((await probing).success, true);
  assert.equal(f.service.snapshot().audioCheckBusy, false);
  f.state.capture.captureNeedsCleanup = true;
  assert.equal((await h.handlers.get("capture-permissions-restart")(h.event)).success, false);
  f.state.capture.captureNeedsCleanup = false;
  assert.equal((await h.handlers.get("capture-permissions-restart")(h.event)).success, true);
  assert.deepEqual(h.effects, [["restart"]]);
});

test("auth-style guide and maximize cycles restore exact workspace bounds and reject untrusted geometry changes", () => {
  const handlers = new Map(), calls = [], frame = {};
  const area = { x: -1920, y: 24, width: 1920, height: 1056 };
  let bounds = { x: -1600, y: 80, width: 600, height: 720 };
  const win = { isDestroyed: () => false, webContents: { mainFrame: frame }, getBounds: () => ({ ...bounds }),
    setBounds(next) { bounds = { ...next }; calls.push(["bounds", next]); }, setMinimizable(value) { calls.push(["minimizable", value]); },
    setSkipTaskbar(value) { calls.push(["taskbar", value]); }, minimize() { calls.push(["minimize"]); } };
  const electron = { ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    app: { dock: { show: async () => calls.push(["dock", "show"]), hide: () => calls.push(["dock", "hide"]) } },
    screen: { getDisplayMatching: () => ({ workArea: area }) } };
  const { initializeWindowControls, isAuthWindow } = createProductionTsLoader({ env: {}, mocks: { electron } })(sourcePath("windowControls.ts"));
  initializeWindowControls(() => win);
  const event = { sender: win.webContents, senderFrame: frame };
  const change = enabled => handlers.get("set-auth-window")(event, enabled);
  change(false);
  const workspace = { x: -1870, y: 65, width: 1420, height: 860 }; bounds = { ...workspace };
  for (let cycle = 0; cycle < 2; cycle++) {
    change(true); assert.equal(isAuthWindow(), true);
    assert.equal(bounds.width, 600); assert.equal(bounds.height, 720);
    handlers.get("toggle-maximize-window")(); assert.deepEqual(bounds, area);
    change(true); assert.deepEqual(bounds, area, "an unchanged guide state must retain its maximized geometry");
    change(false); assert.equal(isAuthWindow(), false); assert.deepEqual(bounds, workspace);
  }
  const before = calls.length;
  for (const [caller, value] of [[{ sender: {}, senderFrame: frame }, true], [{ sender: win.webContents, senderFrame: {} }, true], [event, "true"]]) {
    assert.throws(() => handlers.get("set-auth-window")(caller, value), /Untrusted window caller/);
  }
  assert.equal(calls.length, before); assert.deepEqual(bounds, workspace);
  assert.deepEqual(handlers.get("minimize-window")(), { success: false });
});


test("the actual main restart callback refuses active audio and cleanup before relaunch or quit", async () => {
  const source = fs.readFileSync(sourcePath("main.ts"), "utf8");
  const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const candidates = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "initializePermissionIpc") candidates.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(candidates.length, 1);
  const startupCalls = [];
  const findStartup = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(ast) === "permissions" && node.expression.name.text === "startupCheck") startupCalls.push(node);
    ts.forEachChild(node, findStartup);
  };
  findStartup(ast); assert.equal(startupCalls.length, 1);
  assert.ok(startupCalls[0].pos < candidates[0].pos, "main caches the startup check before exposing IPC or creating the renderer");
  const callback = candidates[0].arguments[2]; assert.ok(ts.isArrowFunction(callback));
  const javascript = ts.transpileModule(`exports.restart = ${callback.getText(ast)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let capture = { captureNeedsCleanup: false, captureStatus: "recording" };
  const calls = [], exports = {};
  new Function("exports", "state", "app", javascript)(exports, { liveSession: { getSnapshot: () => ({ ...capture }) } },
    { relaunch: () => calls.push("relaunch"), quit: () => calls.push("quit") });
  for (const status of ["starting", "recording", "paused", "pausing", "resuming", "stopping"]) {
    capture.captureStatus = status;
    assert.equal((await exports.restart()).success, false);
  }
  for (const status of ["idle", "ended", "error"]) {
    capture = { captureStatus: status, captureNeedsCleanup: true };
    assert.equal((await exports.restart()).success, false);
  }
  assert.deepEqual(calls, []);
  capture = { captureStatus: "idle", captureNeedsCleanup: false };
  assert.equal((await exports.restart()).success, true);
  assert.deepEqual(calls, ["relaunch", "quit"]);
});


test("actual live overlay and window controls keep repeated maximized guides compact on the selected display", () => {
  const handlers = new Map(), frame = {};
  const displays = [
    { id: 1, workArea: { x: 0, y: 24, width: 1440, height: 876 } },
    { id: 2, workArea: { x: -1920, y: 24, width: 1920, height: 1056 } },
  ];
  let bounds = { x: 420, y: 102, width: 600, height: 720 }, visible = false;
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, isMinimized: () => false,
    webContents: { mainFrame: frame, send() {} }, getBounds: () => ({ ...bounds }),
    setBounds(next) { bounds = { ...next }; }, setMinimizable() {}, setSkipTaskbar() {}, setMovable() {}, setResizable() {}, setIgnoreMouseEvents() {},
    setVisibleOnAllWorkspaces() {}, showInactive() { visible = true; }, hide() { visible = false; }, focus() {} });
  const electron = { ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, app: { dock: { show: async () => {}, hide() {} } },
    screen: { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0], getDisplayMatching: rect => rect.x < 0 ? displays[1] : displays[0] } };
  const production = createProductionTsLoader({ env: {}, mocks: { electron } });
  const { initializeWindowControls, isAuthWindow } = production(sourcePath("windowControls.ts"));
  const { OverlayWindowController } = production(sourcePath("live/OverlayWindow.ts"));
  const { WindowVisibilityController } = production(sourcePath("WindowVisibility.ts"));
  const overlay = new OverlayWindowController(() => win);
  // Execute the actual main composition, including the geometry owner callback.
  const source = fs.readFileSync(sourcePath("main.ts"), "utf8");
  const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["applyWorkspaceWindow", "createWindowVisibility", "applyNativeShowMainWindow", "applyNativeHideMainWindow", "hideMainWindow", "showMainWindow", "revealMainWindow"];
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(functions.length, names.length);
  const registrations = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "initializeWindowControls") registrations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.equal(registrations.length, 1);
  const javascript = ts.transpileModule(`${functions.map(node => node.getText(ast)).join("\n")}\n${registrations[0].getText(ast)};\n${names.map(name => `exports.${name}=${name};`).join("\n")}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const main = {}, state = { mainWindow: win, liveWorkspace: true, windowVisibility: null, windowPosition: null, windowSize: null };
  new Function("exports", "initializeWindowControls", "getMainWindow", "overlayWindow", "isAuthWindow", "state", "WindowVisibilityController", javascript)(
    main, initializeWindowControls, () => win, overlay, isAuthWindow, state, WindowVisibilityController);
  state.windowVisibility = main.createWindowVisibility(win);
  const event = { sender: win.webContents, senderFrame: frame };
  const auth = enabled => handlers.get("set-auth-window")(event, enabled);
  auth(true); auth(false); overlay.selectDisplay(2); main.showMainWindow();
  for (let cycle = 0; cycle < 3; cycle++) {
    main.hideMainWindow(); assert.equal(visible, false);
    assert.deepEqual(state.windowSize, { width: 1920, height: 1056 }, "hide retains its historical full-screen snapshot");
    auth(true);
    assert.equal(overlay.isLive(), false);
    assert.deepEqual(bounds, { x: -1260, y: 192, width: 600, height: 720 });
    main.revealMainWindow(); assert.equal(visible, true);
    assert.deepEqual(bounds, { x: -1260, y: 192, width: 600, height: 720 }, "reveal respects the current guide layout instead of replaying the hide snapshot");
    handlers.get("toggle-maximize-window")(); assert.deepEqual(bounds, displays[1].workArea);
    auth(true); assert.deepEqual(bounds, displays[1].workArea);
    auth(false);
    assert.equal(overlay.isLive(), true); assert.equal(overlay.getDisplay().id, 2);
    assert.deepEqual(bounds, displays[1].workArea);
  }
  state.liveWorkspace = false; main.applyWorkspaceWindow();
  assert.deepEqual(bounds, { x: -1260, y: 192, width: 600, height: 720 }, "leaving Live for Programming must restore its normal layout, not the full-screen workspace");
});
