import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function snapshot(patch = {}) {
  return {
    platform: "darwin", architecture: "arm64", firstRun: true,
    restartRecommended: false, audioCheckBusy: false, cleanupRequired: false,
    audioSupported: true,
    items: [
      { id: "screen", status: "not-determined", action: "request", detail: "fixture screen not requested" },
      { id: "microphone", status: "not-determined", action: "request", detail: "fixture microphone not requested" },
      { id: "system-audio", status: "unknown", action: "request", detail: "fixture system audio unknown" },
      { id: "accessibility", status: "denied", action: "settings", detail: "fixture accessibility denied" },
    ],
    ...patch,
  };
}
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
class ObservedTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return super.addEventListener(type, callback, options);
  }
  removeEventListener(type, callback, options) {
    this.listeners.get(type)?.delete(callback);
    return super.removeEventListener(type, callback, options);
  }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
}

// These tests run the production TSX effects and handlers. Only React scheduling
// and the IPC boundary are controlled; no TCC request, capture, recording or
// operating-system Settings application is invoked.
function controller({ initial = snapshot(), api: overrides = {}, injectedApi = true } = {}) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const calls = [], openChanges = [], states = [], refs = [], dependencies = [], callbacks = [], callbackDependencies = [], cleanups = [], pendingEffects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, callbackIndex = 0, idIndex = 0;
  let currentSnapshot = initial, guideListener, unmounted = false, updatesAfterUnmount = 0;
  const api = {
    async getCapturePermissions() { calls.push(["get"]); return currentSnapshot; },
    async requestCapturePermission(id) { calls.push(["request", id]); return { success: true, snapshot: currentSnapshot }; },
    async openCapturePermissionSettings(id) { calls.push(["settings", id]); return { success: true, snapshot: currentSnapshot }; },
    async acknowledgeCapturePermissionGuide() { calls.push(["ack"]); currentSnapshot = { ...currentSnapshot, firstRun: false }; return { success: true, snapshot: currentSnapshot }; },
    async openCapturePermissionGuide() { calls.push(["open-guide"]); guideListener?.(); },
    async restartForCapturePermissions() { calls.push(["restart"]); return { success: true }; },
    onCapturePermissionsNeeded(listener) { calls.push(["subscribe"]); guideListener = listener; return () => { calls.push(["unsubscribe"]); guideListener = undefined; }; },
    ...overrides,
  };
  const window = new ObservedTarget();
  window.electronAPI = api;
  const document = new ObservedTarget();
  document.visibilityState = "visible";
  globalThis.window = window; globalThis.document = document;
  function effect(effect, deps) {
    const index = effectIndex++;
    if (!dependencies[index] || deps === undefined || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) {
      dependencies[index] = deps;
      pendingEffects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); });
    }
  }
  const react = {
    ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], next => {
        if (unmounted) updatesAfterUnmount++;
        states[index] = typeof next === "function" ? next(states[index]) : next;
      }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useEffect: effect, useLayoutEffect: effect,
    useCallback(callback, deps) {
      const index = callbackIndex++;
      if (!callbackDependencies[index] || deps.some((value, i) => !Object.is(value, callbackDependencies[index][i]))) {
        callbacks[index] = callback; callbackDependencies[index] = deps;
      }
      return callbacks[index];
    },
    useMemo: compute => compute(),
    useId: () => `permissions-fixture-${idIndex++}`,
  };
  const { PermissionOnboarding } = createProductionTsLoader({ mocks: { react } })(path.join(root, "src/components/Permissions/PermissionOnboarding.tsx"));
  const props = { onOpenChange: open => openChanges.push(open), ...(injectedApi ? { api } : {}) };
  function render() {
    stateIndex = refIndex = effectIndex = callbackIndex = idIndex = 0;
    return PermissionOnboarding(props);
  }
  const nodes = () => elements(render());
  function button(label) {
    const result = nodes().find(node => node.type === "button" && [node.props["aria-label"], text(node)].some(value => typeof value === "string" && (label instanceof RegExp ? label.test(value) : value === label)));
    assert.ok(result, `Expected permission button ${String(label)} in: ${text(render())}`);
    return result;
  }
  function unmount() {
    if (unmounted) return;
    unmounted = true;
    for (const cleanup of cleanups) cleanup?.();
  }
  return {
    api, calls, openChanges, window, document, render, nodes, button,
    action: purpose => button(new RegExp(`^${purpose}：`)),
    get updatesAfterUnmount() { return updatesAfterUnmount; },
    setSnapshot(next) { currentSnapshot = next; },
    needed() { assert.ok(guideListener, "production component subscribed to permission guide events"); guideListener(); },
    focus() { window.dispatchEvent(new Event("focus")); },
    visibility(value) { document.visibilityState = value; document.dispatchEvent(new Event("visibilitychange")); },
    async settle() { for (let i = 0; i < 5; i++) { render(); while (pendingEffects.length) pendingEffects.shift()(); await tick(); } render(); },
    unmount,
    cleanup() { unmount(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; },
  };
}
const mutations = calls => calls.filter(([name]) => ["request", "settings", "ack", "restart", "open-guide"].includes(name));
const reads = calls => calls.filter(([name]) => name === "get").length;


test("first-run permission onboarding reads facts and opens without requesting any permission", async () => {
  const h = controller();
  try {
    await h.settle();
    assert.equal(reads(h.calls), 1);
    assert.ok(h.nodes().some(node => node.props.role === "dialog"));
    assert.ok(h.nodes().some(node => node.type?.name === "WindowControls"), "the modal reuses native window actions independently of closing the guide");
    assert.ok(h.button("关闭权限指南"));
    assert.equal(h.openChanges.at(-1), true);
    assert.deepEqual(mutations(h.calls), []);
    for (const purpose of ["屏幕截图", "麦克风", "系统音频", "辅助功能"]) assert.ok(text(h.render()).includes(purpose));
    assert.ok(h.button("继续纯文字使用"));
  } finally { h.cleanup(); }
});


test("an acknowledged guide stays closed until its native reopen event and rereads current facts", async () => {
  const h = controller({ initial: snapshot({ firstRun: false }), injectedApi: false });
  try {
    await h.settle();
    assert.equal(h.render(), null);
    assert.equal(h.openChanges.includes(true), false);
    h.setSnapshot(snapshot({ firstRun: false, items: [{ id: "screen", status: "denied", action: "settings", detail: "fixture newly denied screen" }] }));
    h.needed(); await h.settle();
    assert.equal(reads(h.calls), 2);
    assert.equal(h.openChanges.at(-1), true);
    assert.match(text(h.render()), /fixture newly denied screen/);
    assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});


test("focus and visible returns refresh the open guide without prompting or acknowledging", async () => {
  const observedAt = Date.UTC(2026, 9, 31, 0, 0, 0);
  const systemAudio = { id: "system-audio", status: "granted", action: "request", observedAt, detail: "fixture cached audio observation" };
  const h = controller({ initial: snapshot({ items: [
    ...["screen", "microphone", "accessibility"].map(id => ({ id, status: "granted", action: "none", observedAt, detail: "fixture current OS read" })),
    systemAudio,
  ] }) });
  try {
    await h.settle();
    assert.deepEqual(h.nodes().filter(node => node.props["data-status"] === "granted").map(text), ["已授权", "已授权", "已授权", "上次检测已授权"]);
    assert.ok(text(h.render()).includes(new Date(observedAt).toLocaleString()));
    assert.match(text(h.render()), /系统权限可能改变，可再次检测/);
    assert.ok(h.button("系统音频：再次检测"));
    h.visibility("hidden"); await h.settle();
    assert.equal(reads(h.calls), 1);
    h.setSnapshot(snapshot({ items: [{ id: "microphone", status: "denied", action: "settings", detail: "fixture changed while in Settings" }, systemAudio] }));
    h.focus(); await h.settle();
    assert.equal(reads(h.calls), 2);
    assert.match(text(h.render()), /fixture changed while in Settings/);
    h.visibility("visible"); await h.settle();
    assert.equal(reads(h.calls), 3);
    assert.deepEqual(h.nodes().filter(node => node.props["data-status"] === "granted").map(text), ["上次检测已授权"]);
    assert.ok(text(h.render()).includes(new Date(observedAt).toLocaleString()));
    assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});


test("denied and unknown facts remain unresolved and only caller-selected row actions reach native IPC", async () => {
  const initial = snapshot({ items: [
    { id: "screen", status: "denied", action: "settings", detail: "fixture denied screen remains denied" },
    { id: "microphone", status: "unknown", action: "request", detail: "fixture unknown microphone remains unknown" },
    { id: "system-audio", status: "restricted", action: "none", detail: "fixture restricted audio" },
    { id: "accessibility", status: "not-required", action: "none", detail: "fixture accessibility not required" },
  ] });
  const h = controller({ initial });
  try {
    await h.settle();
    assert.match(text(h.render()), /fixture denied screen remains denied/);
    assert.match(text(h.render()), /fixture unknown microphone remains unknown/);
    assert.match(text(h.render()), /fixture restricted audio/);
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
    assert.equal(h.nodes().some(node => node.type === "button" && /^系统音频：|^辅助功能：/.test(node.props["aria-label"] || "")), false);
    h.action("麦克风").props.onClick(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["request", "microphone"]]);
    assert.match(text(h.render()), /fixture unknown microphone remains unknown/);
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
  } finally { h.cleanup(); }
});


test("opening Settings applies only its returned snapshot and does not infer a grant from success", async () => {
  const returned = snapshot({ restartRecommended: true, items: [{ id: "screen", status: "denied", action: "settings", detail: "fixture settings opened but permission denied" }] });
  const h = controller({ initial: snapshot({ items: [{ id: "screen", status: "denied", action: "settings", detail: "fixture previous screen" }] }), api: {
    async openCapturePermissionSettings(id) { h.calls.push(["settings", id]); return { success: true, snapshot: returned }; },
  } });
  try {
    await h.settle();
    h.action("屏幕截图").props.onClick(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["settings", "screen"]]);
    assert.equal(reads(h.calls), 1, "a second read must not overwrite the operation's authoritative snapshot");
    assert.match(text(h.render()), /fixture settings opened but permission denied/);
    assert.doesNotMatch(text(h.render()), /fixture previous screen/);
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
    assert.ok(h.action("屏幕截图"));
    assert.equal(h.button(/重启/).props.disabled, false);
  } finally { h.cleanup(); }
});


test("a pending row operation rejects duplicate and stale handlers before React rerenders", async () => {
  const pending = deferred();
  const h = controller({ api: { requestCapturePermission(id) { h.calls.push(["request", id]); return pending.promise; } } });
  try {
    await h.settle();
    const microphone = h.action("麦克风").props.onClick;
    const accessibility = h.action("辅助功能").props.onClick;
    const continueText = h.button("继续纯文字使用").props.onClick;
    microphone(); microphone(); accessibility(); continueText(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["request", "microphone"]]);
    assert.equal(h.action("麦克风").props.disabled, true);
    pending.resolve({ success: false, snapshot: snapshot(), error: "fixture permission request failed" });
    await h.settle();
    assert.match(text(h.render()), /fixture permission request failed/);
    assert.equal(h.action("麦克风").props.disabled, false);
    assert.equal(h.openChanges.at(-1), true);
  } finally { h.cleanup(); }
});


test("continuing as text acknowledges only the displayed successfully loaded guide and waits for success", async () => {
  const pending = deferred();
  const h = controller({ api: { acknowledgeCapturePermissionGuide() { h.calls.push(["ack"]); return pending.promise; } } });
  try {
    await h.settle();
    const continueText = h.button("继续纯文字使用").props.onClick;
    continueText(); continueText(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["ack"]]);
    assert.equal(h.openChanges.at(-1), true);
    pending.resolve({ success: true, snapshot: snapshot({ firstRun: false }) }); await h.settle();
    assert.deepEqual(h.openChanges.slice(-2), [true, false]);
    assert.equal(h.render(), null);
  } finally { h.cleanup(); }
});


test("an acknowledgement failure retains the guide and permits explicit close without a second acknowledgement", async () => {
  const h = controller({ api: { async acknowledgeCapturePermissionGuide() { h.calls.push(["ack"]); return { success: false, snapshot: snapshot(), error: "fixture guide preference not saved" }; } } });
  try {
    await h.settle();
    h.button("继续纯文字使用").props.onClick(); await h.settle();
    assert.equal(h.openChanges.at(-1), true);
    assert.match(text(h.render()), /fixture guide preference not saved/);
    assert.equal(h.button("继续纯文字使用").props.disabled, false, "a known snapshot permits an explicit acknowledgement retry");
    h.button("关闭权限指南").props.onClick(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["ack"]]);
    assert.deepEqual(h.openChanges.slice(-2), [true, false]);
    assert.equal(h.render(), null);
  } finally { h.cleanup(); }
});


test("a failed snapshot load offers explicit retry and temporary close without acknowledging unknown facts", async () => {
  const h = controller({ api: { async getCapturePermissions() { h.calls.push(["get"]); throw new Error("fixture permission snapshot unavailable"); } } });
  try {
    await h.settle();
    assert.match(text(h.render()), /fixture permission snapshot unavailable/);
    assert.deepEqual(mutations(h.calls), []);
    h.api.getCapturePermissions = async () => { h.calls.push(["get"]); return snapshot(); };
    h.button(/重试|重新检查|重新加载/).props.onClick(); await h.settle();
    assert.equal(reads(h.calls), 2);
    assert.match(text(h.render()), /fixture screen not requested/);
    assert.doesNotMatch(text(h.render()), /fixture permission snapshot unavailable/);
    assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }

  const close = controller({ api: { async getCapturePermissions() { close.calls.push(["get"]); throw new Error("fixture unavailable before close"); } } });
  try {
    await close.settle();
    close.button("暂时关闭").props.onClick(); await close.settle();
    assert.equal(close.render(), null);
    assert.deepEqual(mutations(close.calls), []);
  } finally { close.cleanup(); }
});


test("cleanup ownership and a busy audio check block restart including a handler captured before refresh", async () => {
  for (const patch of [{ cleanupRequired: true }, { audioCheckBusy: true }]) {
    const h = controller({ initial: snapshot({ restartRecommended: true }) });
    try {
      await h.settle();
      const staleRestart = h.button(/重启/).props.onClick;
      assert.equal(h.button(/重启/).props.disabled, false);
      h.setSnapshot(snapshot({ restartRecommended: true, ...patch }));
      h.focus(); await h.settle();
      assert.equal(h.button(/重启/).props.disabled, true);
      staleRestart(); h.button(/重启/).props.onClick(); await h.settle();
      assert.deepEqual(mutations(h.calls), []);
    } finally { h.cleanup(); }
  }
});


test("a recommended restart is user initiated, single flight, and preserves native failure for retry", async () => {
  const pending = deferred();
  const h = controller({ initial: snapshot({ restartRecommended: true }), api: { restartForCapturePermissions() { h.calls.push(["restart"]); return pending.promise; } } });
  try {
    await h.settle();
    assert.deepEqual(mutations(h.calls), []);
    const restart = h.button(/重启/).props.onClick;
    restart(); restart(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["restart"]]);
    pending.resolve({ success: false, error: "fixture restart rejected" }); await h.settle();
    assert.match(text(h.render()), /fixture restart rejected/);
    assert.equal(h.button(/重启/).props.disabled, false);
  } finally { h.cleanup(); }
});


test("unmount removes native and browser subscriptions and ignores an outstanding snapshot", async () => {
  const pending = deferred();
  const h = controller({ api: { getCapturePermissions() { h.calls.push(["get"]); return pending.promise; } } });
  try {
    await h.settle();
    assert.equal(h.window.count("focus"), 1);
    assert.equal(h.document.count("visibilitychange"), 1);
    h.unmount();
    assert.equal(h.window.count("focus"), 0);
    assert.equal(h.document.count("visibilitychange"), 0);
    assert.equal(h.calls.filter(([name]) => name === "unsubscribe").length, 1);
    const changes = [...h.openChanges];
    pending.resolve(snapshot()); await tick(); await tick();
    h.focus(); h.visibility("visible"); await tick();
    assert.equal(reads(h.calls), 1);
    assert.deepEqual(h.openChanges, changes);
    assert.equal(h.updatesAfterUnmount, 0);
    assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});



test("a failed refresh clears an earlier grant and rejects a stale continue handler until retry succeeds", async () => {
  const h = controller({ initial: snapshot({ items: [{ id: "screen", status: "granted", action: "none", detail: "fixture previous grant" }] }) });
  try {
    await h.settle();
    const staleContinue = h.button("继续纯文字使用").props.onClick;
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), true);
    h.api.getCapturePermissions = async () => { h.calls.push(["get"]); throw new Error("fixture refresh failed"); };
    h.focus(); await h.settle();
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
    assert.doesNotMatch(text(h.render()), /fixture previous grant/);
    assert.match(text(h.render()), /fixture refresh failed/);
    staleContinue(); await h.settle();
    assert.deepEqual(mutations(h.calls), []);
    assert.ok(h.button("暂时关闭"));
  } finally { h.cleanup(); }
});


test("stale row handlers resolve the latest native action instead of inferring it from status", async () => {
  const h = controller();
  try {
    await h.settle();
    const staleScreenRequest = h.action("屏幕截图").props.onClick;
    h.setSnapshot(snapshot({ items: [{ id: "screen", status: "unknown", action: "settings", detail: "fixture latest screen needs settings" }] }));
    h.focus(); await h.settle();
    staleScreenRequest(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["settings", "screen"]]);
    assert.match(text(h.render()), /fixture latest screen needs settings/);
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
  } finally { h.cleanup(); }
});


test("Windows and unsupported audio facts remain visible without advertising unavailable native actions", async () => {
  const h = controller({ initial: snapshot({
    platform: "win32", architecture: "x64", audioSupported: false,
    audioSupportMessage: "fixture native audio is unavailable on this platform",
    items: [
      { id: "screen", status: "not-required", action: "none", detail: "fixture screen has no separate permission switch" },
      { id: "microphone", status: "unknown", action: "settings", detail: "fixture microphone privacy requires Settings" },
      { id: "system-audio", status: "unsupported", action: "none", detail: "fixture unsupported system audio" },
      { id: "accessibility", status: "not-required", action: "none", detail: "fixture accessibility is not required" },
    ],
  }) });
  try {
    await h.settle();
    assert.match(text(h.render()), /Windows/);
    assert.match(text(h.render()), /fixture native audio is unavailable on this platform/);
    assert.match(text(h.render()), /fixture unsupported system audio/);
    assert.equal(h.nodes().some(node => node.type === "button" && /^屏幕截图：|^系统音频：|^辅助功能：/.test(node.props["aria-label"] || "")), false);
    h.action("麦克风").props.onClick(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["settings", "microphone"]]);
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
  } finally { h.cleanup(); }
});
