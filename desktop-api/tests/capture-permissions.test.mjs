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
    failRename: false,
  };
  const fileSystem = { ...fs,
    mkdirSync(...args) { writes.push(["mkdir", ...args]); return fs.mkdirSync(...args); },
    copyFileSync(...args) { writes.push(["backup", ...args]); return fs.copyFileSync(...args); },
    openSync(...args) { writes.push(["open", ...args]); return fs.openSync(...args); },
    writeFileSync(...args) { writes.push(["write", ...args]); return fs.writeFileSync(...args); },
    renameSync(...args) { writes.push(["rename", ...args]); if (state.failRename) throw new Error("fixture marker rename failed"); return fs.renameSync(...args); },
    unlinkSync(...args) { writes.push(["unlink", ...args]); return fs.unlinkSync(...args); },
  };
  const deps = {
    platform: options.platform || "darwin", architecture: options.architecture || "x64", stateDirectory: directory,
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
  const first = f.service.snapshot(); f.state.now = 2000; const second = f.service.snapshot();
  assert.equal(first.firstRun, true); assert.equal(second.audioCheckBusy, false);
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

test("absent accessibility trust does not claim a permission was never requested", context => {
  const f = fixture(context, { architecture: "arm64" });
  f.state.audio = { microphone: { status: "unknown" }, systemAudio: { status: "unknown" }, accessibility: { status: "denied", observedAt: 80 } };
  const retained = item(f.service.snapshot(), "accessibility");
  assert.equal(retained.status, "denied"); assert.equal(retained.observedAt, 80);
  f.state.audio.accessibility = { status: "granted", observedAt: 90 };
  assert.equal(item(f.service.snapshot(), "accessibility").status, "unknown", "current absent trust cannot reuse a historical grant");
  f.state.audio = null;
  assert.equal(item(f.service.snapshot(), "accessibility").status, "unknown");
  f.state.trusted = true;
  assert.equal(item(f.service.snapshot(), "accessibility").status, "granted");
});

test("acknowledgement records only having seen the guide, remains retryable after atomic-write failure, and is idempotent", async context => {
  const original = '{"version":2,"acknowledgedAt":50}\n';
  const f = fixture(context, { marker: original, media: { screen: "denied", microphone: "unknown" } });
  f.state.failRename = true;
  const failed = await f.service.acknowledge();
  assert.equal(failed.success, false); assert.equal(failed.snapshot.firstRun, true);
  assert.match(failed.error, /rename failed/);
  const marker = path.join(f.directory, "capture-permission-guide.json");
  assert.equal(fs.readFileSync(marker, "utf8"), original);
  const backups = fs.readdirSync(f.directory).filter(name => name.endsWith(".backup"));
  assert.equal(backups.length, 1); assert.equal(fs.readFileSync(path.join(f.directory, backups[0]), "utf8"), original);
  assert.equal(fs.readdirSync(f.directory).some(name => name.endsWith(".tmp")), false);
  f.state.failRename = false;
  const saved = await f.service.acknowledge();
  assert.equal(saved.success, true); assert.equal(saved.snapshot.firstRun, false);
  assert.equal(item(saved.snapshot, "screen").status, "denied"); assert.equal(item(saved.snapshot, "microphone").status, "unknown");
  assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")), { version: 1, acknowledgedAt: 1000 });
  const writes = f.writes.length;
  assert.equal((await f.service.acknowledge()).success, true); assert.equal(f.writes.length, writes);
  const restored = new f.PermissionService(f.deps).snapshot();
  assert.equal(restored.firstRun, false); assert.equal(item(restored, "screen").status, "denied");
  assert.deepEqual(f.effects, []);
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

test("permission IPC rejects foreign senders, iframes, missing frames and stale windows before any operation", () => {
  const calls = [];
  const service = { snapshot() { calls.push("get"); return {}; }, request() { calls.push("request"); }, settings() { calls.push("settings"); }, acknowledge() { calls.push("acknowledge"); } };
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
  const service = { snapshot: () => ({}), request: id => calls.push(["request", id]), settings: id => calls.push(["settings", id]), acknowledge() {} };
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

test("pending permission actions serialize requests and prevent guide acknowledgement or controlled restart", async context => {
  const pending = deferred();
  const f = fixture(context, { probe: () => pending.promise });
  const h = ipcFixture(f.service);
  const probing = f.service.request("screen");
  assert.equal(f.service.snapshot().audioCheckBusy, true);
  assert.equal((await f.service.request("microphone")).success, false);
  assert.equal((await f.service.acknowledge()).success, false);
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
