import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function elements(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach(child => elements(child, out)); return out; }
  if (node.props) { out.push(node); elements(node.props.children, out); }
  return out;
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}
function hookScheduler() {
  const states = [], refs = [], dependencies = [], cleanups = [], effects = [], callbacks = [], callbackDependencies = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, callbackIndex = 0, idIndex = 0;
  const effect = (run, deps) => {
    const index = effectIndex++;
    if (!dependencies[index] || deps === undefined || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) {
      dependencies[index] = deps;
      effects.push(() => { cleanups[index]?.(); cleanups[index] = run(); });
    }
  };
  return {
    react: { ...React,
      useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }]; },
      useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
      useEffect: effect, useLayoutEffect: effect,
      useCallback(callback, deps) { const index = callbackIndex++; if (!callbackDependencies[index] || deps.some((value, i) => !Object.is(value, callbackDependencies[index][i]))) { callbacks[index] = callback; callbackDependencies[index] = deps; } return callbacks[index]; },
      useId: () => `app-fixture-${idIndex++}`,
    },
    render(component, props) { stateIndex = refIndex = effectIndex = callbackIndex = idIndex = 0; return component(props); },
    async settle(render) { for (let i = 0; i < 5; i++) { render(); while (effects.length) effects.shift()(); await tick(); } render(); },
    cleanup() { for (const cleanup of cleanups) cleanup?.(); },
  };
}
function browser(api) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const window = new EventTarget(), document = new EventTarget();
  const storage = new Map();
  window.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  window.electronAPI = api;
  document.visibilityState = "visible";
  globalThis.window = window; globalThis.document = document;
  return { cleanup() { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; } };
}
function appController() {
  const hooks = hookScheduler(), account = deferred(), calls = [];
  const subscribe = name => () => { calls.push([name]); return () => calls.push([`remove-${name}`]); };
  const api = {
    async setAuthWindow(value) { calls.push(["auth-window", value]); },
    accountGet() { calls.push(["account-get"]); return account.promise; },
    onCreditsUpdated: subscribe("credits"), onUnauthorized: subscribe("unauthorized"),
    onSolutionSuccess: subscribe("solution-success"), onDebugSuccess: subscribe("debug-success"),
    onSolutionError: subscribe("solution-error"), onDebugError: subscribe("debug-error"),
    onProcessingCancelled: subscribe("processing-cancelled"), onLiveSnapshot: subscribe("live-snapshot"),
  };
  const environment = browser(api);
  const PermissionOnboarding = () => null, SubscribedApp = () => null, AuthPage = () => null;
  const marker = () => null;
  const { default: App } = createProductionTsLoader({ mocks: {
    react: hooks.react,
    "./_pages/SubscribedApp": { default: SubscribedApp, __esModule: true },
    "./_pages/AuthPage": { default: AuthPage, __esModule: true },
    "./components/Permissions/PermissionOnboarding": { PermissionOnboarding },
    "./components/Live/CaptureRecovery": { CaptureRecovery: marker },
    "./components/shared/WindowControls": { WindowControls: marker },
    "./components/UpdateNotification": { UpdateNotification: marker },
    "./components/ui/toast": { Toast: marker, ToastDescription: marker, ToastProvider: marker, ToastTitle: marker, ToastViewport: marker },
    "./contexts/toast": { ToastContext: React.createContext(null) },
  } })(path.join(root, "src/App.tsx"));
  const render = () => hooks.render(App);
  const nodes = () => elements(render());
  const matching = type => nodes().filter(node => node.type === type);
  return {
    calls, account, render, nodes,
    guide: () => { const guides = matching(PermissionOnboarding); assert.equal(guides.length, 1, "one App-owned guide survives every account branch"); return guides[0]; },
    auth: () => matching(AuthPage)[0], workspace: () => matching(SubscribedApp)[0],
    content: () => nodes().find(node => node.type === "div" && node.props.className === "contents"),
    settle: () => hooks.settle(render),
    cleanup() { hooks.cleanup(); environment.cleanup(); },
  };
}

// These integration tests execute production App and Settings handlers with
// child screens stubbed. Native window geometry, TCC and actual DOM inert/focus
// behavior are outside this controller harness.
test("the real App keeps one stable permission guide beside loading, login and authenticated content", async () => {
  const h = appController();
  try {
    await h.settle();
    const callback = h.guide().props.onOpenChange;
    assert.match(text(h.content()), /Connecting to PassWisely/);
    assert.equal(h.auth(), undefined); assert.equal(h.workspace(), undefined);
    for (const open of [true, false]) {
      callback(open); await h.settle();
      assert.equal(h.guide().props.onOpenChange, callback);
      assert.equal(h.content().props["aria-hidden"], open || undefined);
      assert.equal(Object.hasOwn(h.content().props, "inert"), open);
      assert.match(text(h.content()), /Connecting to PassWisely/);
    }
    h.account.resolve({ success: false, error: "fixture account login required" }); await h.settle();
    assert.ok(h.auth()); assert.equal(h.workspace(), undefined);
    assert.equal(h.auth().props.initialError, "fixture account login required");
    assert.equal(h.guide().props.onOpenChange, callback);
    callback(true); await h.settle();
    assert.ok(h.auth()); assert.equal(h.content().props.inert, "");
    h.auth().props.onAuthenticated({ id: "fixture-user", email: "fixture@example.test", credits: 17 }); await h.settle();
    assert.ok(h.workspace()); assert.equal(h.auth(), undefined);
    assert.equal(h.guide().props.onOpenChange, callback);
    assert.equal(h.content().props.inert, "", "login completion must not dismiss the active permission dialog");
    assert.equal(h.calls.filter(([name]) => name === "account-get").length, 1);
    assert.equal(h.calls.filter(([name]) => name === "credits").length, 1);
    assert.equal(h.calls.filter(([name]) => name === "unauthorized").length, 1);
  } finally { h.cleanup(); }
});


test("opening and closing the guide preserves the workspace draft and controls auth window size without account refetches", async () => {
  const h = appController();
  try {
    await h.settle();
    h.account.resolve({ success: true, user: { id: "fixture-user", email: "fixture@example.test", credits: 17 } }); await h.settle();
    const original = h.workspace();
    assert.ok(original);
    original.props.setQuery("fixture unsent workspace draft"); await h.settle();
    const callback = h.guide().props.onOpenChange;
    assert.equal(h.calls.filter(([name]) => name === "auth-window").at(-1)[1], false);
    const accountReads = h.calls.filter(([name]) => name === "account-get").length;
    const captureSubscriptions = h.calls.filter(([name]) => name === "live-snapshot").length;
    for (const open of [true, false, true, false]) {
      callback(open); await h.settle();
      const workspace = h.workspace();
      assert.equal(workspace.type, original.type); assert.equal(workspace.key, original.key);
      assert.equal(workspace.props.currentQuery, "fixture unsent workspace draft");
      assert.equal(workspace.props.credits, 17);
      assert.equal(h.guide().props.onOpenChange, callback);
      assert.equal(h.calls.filter(([name]) => name === "auth-window").at(-1)[1], open);
      assert.equal(h.content().props["aria-hidden"], open || undefined);
      assert.equal(Object.hasOwn(h.content().props, "inert"), open);
    }
    assert.equal(h.calls.filter(([name]) => name === "account-get").length, accountReads);
    assert.equal(h.calls.filter(([name]) => name === "live-snapshot").length, captureSubscriptions);
  } finally { h.cleanup(); }
});


function settingsController({ writeBusy = false, openGuide } = {}) {
  const hooks = hookScheduler(), calls = [];
  const api = {
    getPlatform: () => "darwin",
    async getAiSettings() { return { responseLanguage: "en" }; },
    async getTranscriptionSettings() { return { profileId: "recall-en" }; },
    async getOverlayDisplays() { return []; },
    async openCapturePermissionGuide() { calls.push(["guide"]); if (openGuide) await openGuide(); },
  };
  const environment = browser(api);
  const { LiveSettingsPopover } = createProductionTsLoader({ mocks: { react: hooks.react } })(path.join(root, "src/components/Live/LiveSettingsPopover.tsx"));
  const props = {
    api, writeBusy, currentLanguage: "python", captureStatus: "idle", credits: 17,
    onClose: () => calls.push(["close"]),
    onLanguageChange() {}, onOpenAdvanced() {}, onOpenResume() {}, onOpenProgramming() {}, onOpenShortcuts() {}, onLogout() {}, onQuit() {},
  };
  const render = () => hooks.render(LiveSettingsPopover, props);
  return {
    calls, props, render,
    guideButton() { const button = elements(render()).find(node => node.type === "button" && text(node).includes("截图与语音权限")); assert.ok(button); return button; },
    settle: () => hooks.settle(render),
    cleanup() { hooks.cleanup(); environment.cleanup(); },
  };
}


test("the real settings entry reopens the permission guide only after its native owner accepts", async () => {
  const pending = deferred();
  const h = settingsController({ openGuide: () => pending.promise });
  try {
    await h.settle();
    assert.deepEqual(h.calls, []);
    h.guideButton().props.onClick(); await h.settle();
    assert.deepEqual(h.calls, [["guide"]]);
    pending.resolve(); await h.settle();
    assert.deepEqual(h.calls, [["guide"], ["close"]]);
  } finally { h.cleanup(); }
});


test("the permission settings entry respects a pending workspace write and preserves native errors", async () => {
  const h = settingsController({ writeBusy: true, openGuide: async () => { throw new Error("fixture guide IPC unavailable"); } });
  try {
    await h.settle();
    const stale = h.guideButton().props.onClick;
    assert.equal(h.guideButton().props.disabled, true);
    stale(); await h.settle();
    assert.deepEqual(h.calls, []);
    h.props.writeBusy = false; await h.settle();
    assert.equal(h.guideButton().props.disabled, false);
    h.guideButton().props.onClick(); await h.settle();
    assert.deepEqual(h.calls, [["guide"]]);
    assert.match(text(h.render()), /fixture guide IPC unavailable/);
  } finally { h.cleanup(); }
});
