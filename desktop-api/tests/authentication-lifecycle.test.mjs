import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load as parseHtml } from "cheerio";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
function production(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const javascript = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", javascript)(id => {
    if (id in mocks) return mocks[id];
    if (id.startsWith(".")) return production(path.relative(root, path.resolve(path.dirname(filename), `${id}.ts`)), mocks);
    return require(id);
  }, module, module.exports);
  return module.exports;
}
const { createAuthenticationLossHandler } = production("electron/live/AuthenticationLoss.ts");
const { LiveSessionService } = production("electron/live/LiveSessionService.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));

function accountFixture(onLost) {
  const files = new Map();
  const { AccountService } = production("electron/account.ts", {
    electron: { app: { getPath: () => "/fixture-only" }, safeStorage: { isEncryptionAvailable: () => false } },
    "node:fs": {
      readFileSync(name) { if (!files.has(name)) throw new Error("not found"); return files.get(name); },
      writeFileSync(name, value) { files.set(name, value); }, mkdirSync() {}, chmodSync() {},
      unlinkSync(name) { if (!files.delete(name)) throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
    },
  });
  return new AccountService(onLost);
}
function loginResponse(token) { return Response.json({ token, user: { id: "fixture-user", email: "fixture@example.test", locale: "en", credits: 1 } }); }

test("authenticated account rejection cancels capture; cleanup failure retains ownership and unauthenticated stop remains available", async () => {
  const previousFetch = globalThis.fetch;
  let failDispose = true, stopped = 0, lost = 0, cleanupFailures = [], cancelled = 0;
  const service = new LiveSessionService({
    support: { supported: true },
    createUpload: async () => ({ uploadToken: "fixture", apiUrl: "https://example.test" }),
    createCapture(callbacks) { return {
      async start() { callbacks.onState("recording"); }, async pause() {}, async resume() {},
      async stop() { stopped++; }, async dispose() { if (failDispose) throw new Error("fixture release failed"); },
    }; },
    stream: async () => assert.fail("no model invocation expected"), pendingScreenshots: () => [], images: async () => [], consumeScreenshots: async () => ({ success: true }), language: () => "en", publish() {},
  });
  const handle = createAuthenticationLossHandler({
    cancelRequests() { cancelled++; }, notifyUnauthorized() { lost++; },
    reset: () => service.reset(), cleanupFailed: message => cleanupFailures.push(message),
  });
  const account = accountFixture(() => { void handle(); });
  try {
    globalThis.fetch = async () => loginResponse("fixture-token");
    assert.equal((await account.login("fixture", "fixture")).success, true);
    await service.start();
    globalThis.fetch = async () => Response.json({ error: "expired" }, { status: 401 });
    assert.equal((await account.getAccount()).success, false);
    await handle(); // joins the reset triggered by the real account boundary
    assert.equal(account.getToken(), ""); assert.equal(lost, 1); assert.equal(cancelled, 1);
    assert.equal(stopped, 1); assert.equal(service.getSnapshot().captureNeedsCleanup, true);
    assert.deepEqual(cleanupFailures, ["fixture release failed"]);

    const handles = new Map();
    const { initializeLiveIpc } = production("electron/live/ipc.ts", { electron: { ipcMain: { handle: (name, fn) => handles.set(name, fn) } } });
    const frame = {}, contents = { mainFrame: frame }, window = { isDestroyed: () => false, webContents: contents };
    initializeLiveIpc(service, () => window, () => {}, () => false);
    const event = { sender: contents, senderFrame: frame };
    for (const channel of ["live-start", "live-resume", "live-ask"]) assert.equal((await handles.get(channel)(event, { question: "test", includeScreenshots: false })).success, false);
    assert.equal(handles.get("live-get-snapshot")(event).captureNeedsCleanup, true);
    failDispose = false;
    assert.equal((await handles.get("live-stop")(event)).success, true);
    assert.equal(service.getSnapshot().captureNeedsCleanup, false);
    assert.throws(() => handles.get("live-stop")({ sender: {}, senderFrame: frame }), /Untrusted/);
  } finally { failDispose = false; await service.dispose(); globalThis.fetch = previousFetch; }
});

test("missing tokens trigger the account lifecycle, but bad login and old-token responses do not invalidate a newer session", async () => {
  const previousFetch = globalThis.fetch;
  let losses = 0;
  const account = accountFixture(() => { losses++; });
  try {
    assert.equal((await account.getAccount()).success, false); assert.equal(losses, 1);
    globalThis.fetch = async () => loginResponse("fixture-old"); await account.login("fixture", "fixture");
    globalThis.fetch = async () => Response.json({ error: "bad password" }, { status: 401 });
    await account.login("fixture", "bad");
    assert.equal(account.getToken(), "fixture-old"); assert.equal(losses, 1);
    let releaseOld;
    globalThis.fetch = () => new Promise(resolve => { releaseOld = resolve; });
    const oldRead = account.getAccount();
    globalThis.fetch = async () => loginResponse("fixture-new"); await account.login("fixture", "fixture");
    releaseOld(Response.json({ error: "old expired token" }, { status: 401 })); await oldRead;
    assert.equal(account.getToken(), "fixture-new"); assert.equal(losses, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test("authentication loss coalesces concurrent resets and reports a thrown cleanup failure without relinquishing its recovery path", async () => {
  let rejectReset, calls = 0;
  const failures = [];
  const handle = createAuthenticationLossHandler({
    cancelRequests() {}, notifyUnauthorized() {},
    reset: () => { calls++; return new Promise((_resolve, reject) => { rejectReset = reject; }); },
    cleanupFailed: message => failures.push(message),
  });
  const first = handle(), repeated = handle(); assert.equal(first, repeated);
  await tick(); rejectReset(new Error("fixture reset failed")); await first;
  assert.equal(calls, 1); assert.deepEqual(failures, ["fixture reset failed"]);
});

const captureSnapshot = patch => ({
  sessionId: "fixture", revision: 1, provider: "recall-v2", transcripts: [], answers: [],
  captureStatus: "recording", captureNeedsCleanup: true, platformSupported: true,
  transcriptTruncated: false, ...patch,
});
const statusUi = production("src/components/Live/CaptureStatusNotice.tsx");

test("Programming navigation keeps the actual capture or pause state visible and returns to the existing session", () => {
  for (const captureStatus of ["recording", "paused", "error"]) {
    const snapshot = captureSnapshot({ captureStatus });
    let stateIndex = 0;
    const states = [];
    const mockReact = {
      ...React, useState(initial) {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef() { return { current: null }; }, useEffect() {},
    };
    const LiveWorkspace = () => null;
    const { default: Component } = production("src/_pages/SubscribedApp.tsx", {
      react: mockReact, "@tanstack/react-query": { useQueryClient: () => ({}) },
      "../contexts/toast": { useToast: () => ({ showToast() {} }) },
      "../_pages/Queue": { default: () => null, __esModule: true },
      "../_pages/Solutions": { default: () => null, __esModule: true },
      "../components/Live/LiveWorkspace": { default: LiveWorkspace, __esModule: true },
      "../components/Live/CaptureStatusNotice": statusUi,
    });
    const props = { credits: 1, currentLanguage: "python", currentQuery: "" };
    const render = () => { stateIndex = 0; return Component(props); };
    const initial = render();
    const live = React.Children.toArray(initial.props.children).find(child => child.type === LiveWorkspace);
    live.props.onSnapshot(snapshot);
    live.props.onProgramming();
    const html = renderToStaticMarkup(render());
    const $ = parseHtml(html);
    assert.equal($("button.pw-workspace-capture").length, 1);
    assert.ok($("button.pw-workspace-capture").text().includes(statusUi.captureStatusNotice(snapshot)));
    let returns = 0;
    const notice = statusUi.CaptureStatusNotice({ snapshot, onReturn() { returns++; } });
    notice.props.onClick(); assert.equal(returns, 1);
  }
  assert.equal(statusUi.CaptureStatusNotice({ snapshot: captureSnapshot({ captureStatus: "ended", captureNeedsCleanup: false }), onReturn() {} }), null);
});

test("the login recovery component exposes the real stop IPC and retains release errors for retry", async () => {
  const previousWindow = globalThis.window;
  let stops = 0, stateIndex = 0;
  const updates = [];
  const snapshot = captureSnapshot({ captureStatus: "error", error: "fixture cleanup failure" });
  const mockReact = {
    ...React, useState(initial) { const index = stateIndex++; return [index === 0 ? snapshot : initial, value => updates.push({ index, value })]; },
    useRef() { return { current: null }; }, useEffect() {},
  };
  globalThis.window = { electronAPI: { async liveStop() { stops++; return { success: false, error: "fixture retry failed" }; } } };
  try {
    const { CaptureRecovery } = production("src/components/Live/CaptureRecovery.tsx", {
      react: mockReact, "./CaptureStatusNotice": statusUi, "./LiveWorkspace": {},
    });
    const tree = CaptureRecovery();
    const $ = parseHtml(renderToStaticMarkup(tree));
    assert.ok($("aside[aria-label='音频采集恢复']").text().includes("fixture cleanup failure"));
    assert.equal($("button").prop("disabled"), false);
    const stop = React.Children.toArray(tree.props.children).find(child => child.type === "button");
    stop.props.onClick(); await tick();
    assert.equal(stops, 1);
    assert.ok(updates.some(({ index, value }) => index === 2 && value === "fixture retry failed"));
    assert.ok(updates.some(({ index, value }) => index === 1 && value === false));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("the production App retains the recovery component while the authentication page is displayed", () => {
  const CaptureRecovery = () => React.createElement("aside", { "data-recovery": true });
  const AuthPage = () => React.createElement("main", { "data-auth": true });
  const mockReact = {
    ...React, useState(initial) { const value = typeof initial === "function" ? initial() : initial; return [value === true ? false : value, () => {}]; },
    useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
  };
  const { default: App } = production("src/App.tsx", {
    react: mockReact, "./_pages/SubscribedApp": { default: () => null, __esModule: true },
    "./_pages/AuthPage": { default: AuthPage, __esModule: true }, "./components/ui/toast": {},
    "./components/UpdateNotification": {}, "./contexts/toast": {}, "./components/shared/WindowControls": {},
    "./components/Live/CaptureRecovery": { CaptureRecovery },
  });
  const $ = parseHtml(renderToStaticMarkup(App()));
  assert.equal($("[data-auth]").length, 1); assert.equal($("[data-recovery]").length, 1);
});
