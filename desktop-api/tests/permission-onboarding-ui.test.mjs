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
    platform: "darwin", architecture: "arm64",
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
function controller({ initial = snapshot(), shouldPrompt = true, api: overrides = {}, injectedApi = true } = {}) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const calls = [], openChanges = [], states = [], refs = [], dependencies = [], callbacks = [], callbackDependencies = [], cleanups = [], pendingEffects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, callbackIndex = 0, idIndex = 0;
  let currentSnapshot = initial, guideListener, unmounted = false, updatesAfterUnmount = 0;
  const api = {
    async getCapturePermissionStartupCheck() { calls.push(["startup"]); return { shouldPrompt, snapshot: currentSnapshot }; },
    async getCapturePermissions() { calls.push(["get"]); return currentSnapshot; },
    async requestCapturePermission(id) { calls.push(["request", id]); return { success: true, snapshot: currentSnapshot }; },
    async openCapturePermissionSettings(id) { calls.push(["settings", id]); return { success: true, snapshot: currentSnapshot }; },
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
    blur() { window.dispatchEvent(new Event("blur")); },
    focus() { window.dispatchEvent(new Event("focus")); },
    visibility(value) { document.visibilityState = value; document.dispatchEvent(new Event("visibilitychange")); },
    async settle() { for (let i = 0; i < 5; i++) { render(); while (pendingEffects.length) pendingEffects.shift()(); await tick(); } render(); },
    unmount,
    cleanup() { unmount(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; },
  };
}
const mutations = calls => calls.filter(([name]) => ["request", "settings", "ack", "restart", "open-guide"].includes(name));
const reads = calls => calls.filter(([name]) => name === "get" || name === "startup").length;
const freshReads = calls => calls.filter(([name]) => name === "get").length;

test("startup stays silent while checking and opens only after the native missing-permission decision", async () => {
  const pending = deferred();
  const h = controller({ api: { getCapturePermissionStartupCheck() { h.calls.push(["startup"]); return pending.promise; } } });
  try {
    await h.settle();
    assert.equal(h.render(), null); assert.equal(h.openChanges.includes(true), false);
    assert.equal(reads(h.calls), 1); assert.equal(freshReads(h.calls), 0);
    h.focus(); h.visibility("visible"); await h.settle();
    assert.equal(reads(h.calls), 1);
    pending.resolve({ shouldPrompt: true, snapshot: snapshot() }); await h.settle();
    assert.ok(h.nodes().some(node => node.props.role === "dialog"));
    h.focus(); h.visibility("visible"); await h.settle();
    assert.equal(reads(h.calls), 1, "opening/autofocusing the dialog must not trigger a second native read");
    assert.ok(h.nodes().some(node => node.type?.name === "WindowControls"));
    assert.match(text(h.render()), /需要授权/); assert.ok(h.button("稍后设置"));
    assert.deepEqual(mutations(h.calls), []);
    for (const purpose of ["屏幕截图", "麦克风", "系统音频", "辅助功能"]) assert.ok(text(h.render()).includes(purpose));
    assert.doesNotMatch(text(h.render()), /fixture screen not requested|先了解用途|已看过指南|arm64/);
  } finally { h.cleanup(); }
});

test("ready, unknown and unsupported startup decisions stay closed until an explicit native reopen event", async () => {
  for (const initial of [
    snapshot({ items: [{ id: "screen", status: "granted", action: "none", detail: "current grant" }] }),
    snapshot({ items: [{ id: "screen", status: "unknown", action: "settings", detail: "unknown is not granted" }] }),
    snapshot({ audioSupported: false, items: [{ id: "system-audio", status: "unsupported", action: "none", detail: "unsupported is not missing" }] }),
  ]) {
    const h = controller({ initial, shouldPrompt: false, injectedApi: false });
    try {
      await h.settle(); h.focus(); h.visibility("visible"); await h.settle();
      assert.equal(h.render(), null); assert.equal(reads(h.calls), 1);
      assert.equal(h.openChanges.includes(true), false); assert.deepEqual(mutations(h.calls), []);
      h.setSnapshot(snapshot({ items: [{ id: "screen", status: "denied", action: "settings", detail: "newly denied screen" }] }));
      h.needed(); await h.settle();
      assert.equal(reads(h.calls), 2); assert.match(text(h.render()), /权限设置/);
      assert.doesNotMatch(text(h.render()), /需要授权/); assert.ok(h.button("完成"));
      assert.equal(h.nodes().find(node => node.props["data-status"])?.props["data-status"], "denied");
      assert.deepEqual(mutations(h.calls), []);
    } finally { h.cleanup(); }
  }
});

test("focus and visible returns refresh only an open guide and retain historical audio observation labels", async () => {
  const observedAt = Date.UTC(2026, 9, 31);
  const systemAudio = { id: "system-audio", status: "granted", action: "request", observedAt, detail: "cached audio observation" };
  const h = controller({ shouldPrompt: false, initial: snapshot({ items: [
    ...["screen", "microphone", "accessibility"].map(id => ({ id, status: "granted", action: "none", detail: "current OS read" })), systemAudio,
  ] }) });
  try {
    await h.settle(); h.needed(); await h.settle();
    assert.deepEqual(h.nodes().filter(node => node.props["data-status"] === "granted").map(text), ["已授权", "已授权", "已授权", "上次已授权"]);
    assert.ok(h.nodes().find(node => node.props.title?.includes(new Date(observedAt).toLocaleString())));
    assert.ok(h.button("系统音频：再次检测"));
    h.blur(); h.visibility("hidden"); await h.settle(); assert.equal(freshReads(h.calls), 1);
    h.setSnapshot(snapshot({ items: [{ id: "microphone", status: "denied", action: "settings", detail: "changed in Settings" }, systemAudio] }));
    h.focus(); await h.settle(); assert.equal(freshReads(h.calls), 1, "focus while hidden is not a return yet");
    h.visibility("visible"); h.focus(); await h.settle();
    assert.equal(freshReads(h.calls), 2, "paired visibility/focus return events share one native read");
    h.blur(); h.focus(); await h.settle(); assert.equal(freshReads(h.calls), 3, "an actual app blur/focus return refreshes once");
    assert.deepEqual(h.nodes().filter(node => node.props["data-status"] === "granted").map(text), ["上次已授权"]);
    h.button("完成").props.onClick(); await h.settle();
    h.focus(); h.visibility("visible"); await h.settle();
    assert.equal(freshReads(h.calls), 3); assert.equal(h.render(), null); assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});

test("denied and unknown facts remain unresolved and only selected row actions reach native IPC", async () => {
  const h = controller({ initial: snapshot({ items: [
    { id: "screen", status: "denied", action: "settings", detail: "screen denied" },
    { id: "microphone", status: "unknown", action: "request", detail: "microphone unknown" },
    { id: "system-audio", status: "restricted", action: "none", detail: "fixture restricted audio" },
    { id: "accessibility", status: "not-required", action: "none", detail: "not required" },
  ] }) });
  try {
    await h.settle();
    assert.deepEqual(h.nodes().filter(node => node.props["data-status"]).map(node => node.props["data-status"]), ["denied", "unknown", "restricted", "not-required"]);
    assert.match(text(h.render()), /待确认|fixture restricted audio/);
    assert.equal(h.nodes().some(node => node.type === "button" && /^系统音频：|^辅助功能：/.test(node.props["aria-label"] || "")), false);
    h.action("麦克风").props.onClick(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["request", "microphone"]]);
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
  } finally { h.cleanup(); }
});

test("opening Settings uses its returned snapshot and does not infer a grant or launch another read", async () => {
  const returned = snapshot({ restartRecommended: true, items: [{ id: "screen", status: "denied", action: "settings", detail: "still denied" }] });
  const h = controller({ initial: snapshot({ items: returned.items }), api: {
    async openCapturePermissionSettings(id) { h.calls.push(["settings", id]); return { success: true, snapshot: returned }; },
  } });
  try {
    await h.settle(); h.action("屏幕截图").props.onClick(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["settings", "screen"]]); assert.equal(reads(h.calls), 1);
    assert.match(text(h.render()), /已打开设置/); assert.ok(h.action("屏幕截图"));
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
    assert.equal(h.button(/重启/).props.disabled, false);
  } finally { h.cleanup(); }
});

test("a rejected native request clears previous facts and reports its reason once", async () => {
  const h = controller({ initial: snapshot({ items: [
    { id: "screen", status: "denied", action: "settings", detail: "known missing screen" },
    { id: "system-audio", status: "granted", action: "request", observedAt: Date.UTC(2026, 9, 31), detail: "old audio grant" },
  ] }), api: { async requestCapturePermission(id) { h.calls.push(["request", id]); throw "fixture native request rejected"; } } });
  try {
    await h.settle(); assert.ok(h.nodes().some(node => node.props["data-status"] === "granted"));
    h.action("系统音频").props.onClick(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["request", "system-audio"]]);
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
    assert.equal(h.nodes().filter(node => node.props.role === "alert").length, 1);
    assert.match(text(h.render()), /fixture native request rejected/);
  } finally { h.cleanup(); }
});

test("a pending row operation rejects duplicate and stale action handlers before React rerenders", async () => {
  const pending = deferred();
  const h = controller({ api: { requestCapturePermission(id) { h.calls.push(["request", id]); return pending.promise; } } });
  try {
    await h.settle();
    const microphone = h.action("麦克风").props.onClick, accessibility = h.action("辅助功能").props.onClick;
    microphone(); microphone(); accessibility(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["request", "microphone"]]); assert.equal(h.action("麦克风").props.disabled, true);
    pending.resolve({ success: false, snapshot: snapshot(), error: "fixture request failed" }); await h.settle();
    assert.match(text(h.render()), /fixture request failed/); assert.equal(h.action("麦克风").props.disabled, false);
  } finally { h.cleanup(); }
});

test("manual dismissal prevents a late missing-permission startup decision from reopening the guide", async () => {
  const pending = deferred();
  const h = controller({ api: { getCapturePermissionStartupCheck() { h.calls.push(["startup"]); return pending.promise; } } });
  try {
    await h.settle(); assert.equal(h.render(), null);
    h.needed(); await h.settle(); assert.match(text(h.render()), /权限设置/);
    h.button("完成").props.onClick(); await h.settle(); assert.equal(h.render(), null);
    pending.resolve({ shouldPrompt: true, snapshot: snapshot() }); await h.settle();
    h.focus(); h.visibility("visible"); await h.settle();
    assert.equal(h.render(), null); assert.equal(reads(h.calls), 2); assert.deepEqual(mutations(h.calls), []);
    h.needed(); await h.settle(); assert.equal(freshReads(h.calls), 2); assert.ok(h.button("完成"));
  } finally { h.cleanup(); }
});

test("closing during an action clears queued focus reads and its completion cannot reopen the guide", async () => {
  const pending = deferred();
  const h = controller({ api: { requestCapturePermission(id) { h.calls.push(["request", id]); return pending.promise; } } });
  try {
    await h.settle(); const stale = h.action("麦克风").props.onClick;
    stale(); h.blur(); h.focus(); h.visibility("visible"); await h.settle();
    h.button("关闭权限指南").props.onClick(); await h.settle();
    pending.resolve({ success: true, snapshot: snapshot() }); await h.settle();
    stale(); h.focus(); await h.settle();
    assert.equal(h.render(), null); assert.equal(freshReads(h.calls), 0);
    assert.deepEqual(mutations(h.calls), [["request", "microphone"]]);
  } finally { h.cleanup(); }
});

test("startup IPC failure is silent; explicit manual retry displays errors without manufacturing permission facts", async () => {
  const h = controller({ api: {
    async getCapturePermissionStartupCheck() { h.calls.push(["startup"]); throw new Error("fixture startup unavailable"); },
    async getCapturePermissions() { h.calls.push(["get"]); throw "fixture manual snapshot unavailable"; },
  } });
  try {
    await h.settle(); assert.equal(h.render(), null); assert.equal(reads(h.calls), 1);
    h.needed(); await h.settle();
    assert.match(text(h.render()), /fixture manual snapshot unavailable/);
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
    h.api.getCapturePermissions = async () => { h.calls.push(["get"]); return snapshot(); };
    h.button("重新检查").props.onClick(); await h.settle();
    assert.equal(freshReads(h.calls), 2); assert.doesNotMatch(text(h.render()), /fixture manual snapshot unavailable/);
    h.button("完成").props.onClick(); await h.settle();
    assert.equal(h.render(), null); assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});

test("cleanup ownership and busy audio checks block restart including a stale handler", async () => {
  for (const patch of [{ cleanupRequired: true }, { audioCheckBusy: true }]) {
    const h = controller({ initial: snapshot({ restartRecommended: true }) });
    try {
      await h.settle(); const staleRestart = h.button(/重启/).props.onClick;
      assert.equal(h.button(/重启/).props.disabled, false);
      h.setSnapshot(snapshot({ restartRecommended: true, ...patch })); h.blur(); h.focus(); await h.settle();
      assert.equal(h.button(/重启/).props.disabled, true); staleRestart(); h.button(/重启/).props.onClick(); await h.settle();
      if (patch.cleanupRequired) assert.match(text(h.render()), /音频尚未释放/);
      assert.deepEqual(mutations(h.calls), []);
    } finally { h.cleanup(); }
  }
});

test("retained cleanup stays visible independently of a restart recommendation", async () => {
  const h = controller({ initial: snapshot({ cleanupRequired: true, restartRecommended: false }) });
  try {
    await h.settle(); assert.match(text(h.render()), /音频尚未释放/);
    assert.equal(h.nodes().some(node => node.type === "button" && /重启/.test(text(node))), false);
    assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});

test("recommended restart stays user initiated, single flight, and preserves native failure", async () => {
  const pending = deferred();
  const h = controller({ initial: snapshot({ restartRecommended: true }), api: { restartForCapturePermissions() { h.calls.push(["restart"]); return pending.promise; } } });
  try {
    await h.settle(); assert.deepEqual(mutations(h.calls), []);
    const restart = h.button(/重启/).props.onClick; restart(); restart(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["restart"]]);
    pending.resolve({ success: false, error: "fixture restart rejected" }); await h.settle();
    assert.match(text(h.render()), /fixture restart rejected/); assert.equal(h.button(/重启/).props.disabled, false);
  } finally { h.cleanup(); }
});

test("unmount removes subscriptions and ignores an outstanding startup observation", async () => {
  const pending = deferred();
  const h = controller({ api: { getCapturePermissionStartupCheck() { h.calls.push(["startup"]); return pending.promise; } } });
  try {
    await h.settle(); assert.equal(h.window.count("blur"), 1); assert.equal(h.window.count("focus"), 1); assert.equal(h.document.count("visibilitychange"), 1);
    h.unmount(); assert.equal(h.window.count("blur"), 0); assert.equal(h.window.count("focus"), 0); assert.equal(h.document.count("visibilitychange"), 0);
    assert.equal(h.calls.filter(([name]) => name === "unsubscribe").length, 1); const changes = [...h.openChanges];
    pending.resolve({ shouldPrompt: true, snapshot: snapshot() }); await tick(); await tick(); h.focus(); await tick();
    assert.equal(reads(h.calls), 1); assert.deepEqual(h.openChanges, changes); assert.equal(h.updatesAfterUnmount, 0);
    assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});

test("failed manual refresh clears earlier grants and remains locally closable without a read marker", async () => {
  const h = controller({ shouldPrompt: false, initial: snapshot({ items: [{ id: "screen", status: "granted", action: "none", detail: "previous grant" }] }) });
  try {
    await h.settle(); h.needed(); await h.settle();
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), true);
    h.api.getCapturePermissions = async () => { h.calls.push(["get"]); throw new Error("fixture refresh failed"); };
    h.blur(); h.focus(); await h.settle();
    assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false); assert.match(text(h.render()), /fixture refresh failed/);
    h.button("完成").props.onClick(); await h.settle(); assert.equal(h.render(), null); assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});

test("stale row handlers resolve the latest native action instead of choosing from display status", async () => {
  const h = controller();
  try {
    await h.settle(); const stale = h.action("屏幕截图").props.onClick;
    h.setSnapshot(snapshot({ items: [{ id: "screen", status: "unknown", action: "settings", detail: "latest unknown" }] }));
    h.blur(); h.focus(); await h.settle(); stale(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["settings", "screen"]]);
    assert.equal(h.nodes().find(node => node.props["data-status"])?.props["data-status"], "unknown");
  } finally { h.cleanup(); }
});

test("manual Windows and unsupported audio rows retain necessary facts without unavailable native actions", async () => {
  const h = controller({ shouldPrompt: false, initial: snapshot({ platform: "win32", architecture: "x64", audioSupported: false,
    audioSupportMessage: "fixture native audio unavailable", items: [
      { id: "screen", status: "not-required", action: "none", detail: "screen no separate switch" },
      { id: "microphone", status: "unknown", action: "settings", detail: "microphone privacy Settings" },
      { id: "system-audio", status: "unsupported", action: "none", detail: "fixture unsupported audio" },
      { id: "accessibility", status: "not-required", action: "none", detail: "accessibility not required" },
    ] }) });
  try {
    await h.settle(); assert.equal(h.render(), null); h.needed(); await h.settle();
    assert.match(text(h.render()), /Windows/); assert.match(text(h.render()), /fixture native audio unavailable/); assert.match(text(h.render()), /fixture unsupported audio/);
    assert.equal(h.nodes().some(node => node.type === "button" && /^屏幕截图：|^系统音频：|^辅助功能：/.test(node.props["aria-label"] || "")), false);
    h.action("麦克风").props.onClick(); await h.settle();
    assert.deepEqual(mutations(h.calls), [["settings", "microphone"]]); assert.equal(h.nodes().some(node => node.props["data-status"] === "granted"), false);
  } finally { h.cleanup(); }
});

test("the dialog keeps Tab focus inside and Escape dismisses without storing acknowledgement", async () => {
  const h = controller();
  try {
    await h.settle(); const dialog = h.nodes().find(node => node.props.role === "dialog");
    assert.equal(dialog.props["aria-modal"], "true"); assert.ok(dialog.props["aria-labelledby"]); assert.ok(dialog.props["aria-describedby"]);
    const first = { focus() { h.document.activeElement = first; } }, last = { focus() { h.document.activeElement = last; } };
    const root = { querySelectorAll: () => [first, last], contains: value => value === first || value === last };
    dialog.ref.current = root;
    const key = (value, shiftKey = false) => { let prevented = false, stopped = false; dialog.props.onKeyDown({ key: value, shiftKey, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }); return { prevented, stopped }; };
    h.document.activeElement = last; assert.equal(key("Tab").prevented, true); assert.equal(h.document.activeElement, first);
    h.document.activeElement = first; assert.equal(key("Tab", true).prevented, true); assert.equal(h.document.activeElement, last);
    assert.deepEqual(key("Escape"), { prevented: true, stopped: true }); await h.settle();
    assert.equal(h.render(), null); assert.deepEqual(mutations(h.calls), []);
  } finally { h.cleanup(); }
});
