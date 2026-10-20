import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
function productionLoader(mocks = {}) {
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const javascript = ts.transpileModule(readFileSync(path.join(root, relative), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} }; modules.set(relative, module.exports);
    new Function("require", "module", "exports", javascript)(id => {
      if (id in mocks) return mocks[id];
      if (id.endsWith(".css")) return {};
      if (id.startsWith(".")) {
        const base = path.resolve(root, path.dirname(relative), id);
        const extension = [".ts", ".tsx"].find(suffix => existsSync(base + suffix));
        return load(path.relative(root, base + (extension || ".ts")));
      }
      return require(id);
    }, module, module.exports);
    modules.set(relative, module.exports); return module.exports;
  }
  return load;
}
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial)), writes = [];
  return { data, writes, getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { writes.push([key, value]); data.set(key, value); } };
}
const preferences = productionLoader()("src/components/Live/livePreferences.ts");
const { LIVE_UI_PREFERENCES_KEY: key, LIVE_UI_PREFERENCES_BACKUP_KEY: backup, readKeyDisplayMode, saveKeyDisplayMode, formatShortcutKeys } = preferences;

test("key-display owner preserves unknown preferences and makes one immutable backup", () => {
  const original = JSON.stringify({ future: { enabled: true }, keyDisplayMode: "icon" });
  const storage = memoryStorage({ [key]: original, unrelated: "untouched" });
  assert.equal(readKeyDisplayMode(storage), "icon");
  assert.deepEqual(saveKeyDisplayMode("text", storage), { success: true, mode: "text" });
  assert.deepEqual(JSON.parse(storage.data.get(key)), { future: { enabled: true }, keyDisplayMode: "text" });
  assert.equal(storage.data.get(backup), original);
  saveKeyDisplayMode("icon", storage); saveKeyDisplayMode("text", storage);
  assert.equal(storage.writes.filter(([name]) => name === backup).length, 1);
  assert.equal(storage.data.get("unrelated"), "untouched");
  assert.equal(readKeyDisplayMode(storage), "text");
  assert.deepEqual(formatShortcutKeys(["⌘", "⇧", "↑", "MysteryKey"], "text"), ["Cmd", "Shift", "Up", "MysteryKey"]);
  assert.deepEqual(formatShortcutKeys(["Option", "Enter", "H"], "icon"), ["⌥", "⏎", "H"]);
});

test("malformed preferences and blocked storage fail without overwriting the source or backup", () => {
  for (const original of ["{broken", "null", "[]", "12"]) {
    const storage = memoryStorage({ [key]: original });
    assert.equal(readKeyDisplayMode(storage), "icon");
    assert.equal(saveKeyDisplayMode("text", storage).success, false);
    assert.equal(storage.data.get(key), original); assert.deepEqual(storage.writes, []);
  }
  const storage = memoryStorage({ [key]: '{"future":1}', [backup]: "keep-existing-backup" });
  saveKeyDisplayMode("text", storage);
  assert.equal(storage.data.get(backup), "keep-existing-backup");
  assert.equal(saveKeyDisplayMode("unknown", storage).success, false);
  const blocked = { getItem() { return '{"future":1}'; }, setItem() { throw new Error("quota"); } };
  assert.equal(saveKeyDisplayMode("text", blocked).success, false);
});

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
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Runs the production component's actual effects and handlers with native IPC
// and React scheduling controlled. It does not establish browser/native focus,
// macOS hit testing, provider quality or physical display movement.
function controller(overrides = {}, propOverrides = {}) {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const states = [], refs = [], pendingEffects = [], dependencies = [], cleanups = [], calls = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, idIndex = 0, focusControls = [];
  const storage = memoryStorage();
  const api = {
    async getAiSettings() { calls.push(["get-ai"]); return { responseLanguage: "en" }; },
    async saveAiSettings(input) { calls.push(["save-ai", input]); return { success: true, settings: input }; },
    async getTranscriptionSettings() { calls.push(["get-speech"]); return { profileId: "recall-en" }; },
    async saveTranscriptionSettings(input) { calls.push(["save-speech", input]); return { success: true, settings: input }; },
    async getOverlayDisplays() { calls.push(["get-displays"]); return [{ id: 1, label: "Mac", isPrimary: true, selected: true }]; },
    async selectOverlayDisplay(id) { calls.push(["select-display", id]); return null; },
    async accountOpenPortal() { calls.push(["dashboard"]); }, ...overrides,
  };
  const window = new EventTarget(); window.electronAPI = api; window.localStorage = storage;
  globalThis.window = window; globalThis.document = { activeElement: null };
  const trigger = { focus() { calls.push(["focus-trigger"]); globalThis.document.activeElement = trigger; } };
  const panel = { contains(node) { return focusControls.includes(node); }, querySelectorAll() { return focusControls; }, querySelector() { return focusControls[0] ?? null; } };
  const react = { ...React,
    useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }]; },
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useId() { return `settings-${idIndex++}`; },
    useEffect(effect, deps) { const index = effectIndex++; if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) { dependencies[index] = deps; pendingEffects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); }); } },
  };
  const { LiveSettingsPopover } = productionLoader({ react })("src/components/Live/LiveSettingsPopover.tsx");
  const action = name => () => { calls.push([name]); };
  const props = { api, currentLanguage: "python", onLanguageChange: value => calls.push(["code", value]), captureStatus: "idle", credits: 751,
    onClose: action("close"), onOpenAdvanced: action("advanced"), onOpenResume: action("resume"), onOpenProgramming: action("programming"),
    onOpenShortcuts: action("guide"), onLogout: action("logout"), onQuit: action("quit"), returnFocusRef: { current: trigger }, ...propOverrides };
  const render = () => { stateIndex = refIndex = effectIndex = idIndex = 0; const tree = LiveSettingsPopover(props); tree.ref.current = panel; return tree; };
  const nodes = () => elements(render());
  return {
    calls, api, props, storage, render, nodes, panel,
    select: label => nodes().find(node => node.type === "select" && node.props["aria-label"] === label),
    button: label => nodes().find(node => node.type === "button" && (node.props["aria-label"] === label || text(node) === label)),
    message: () => nodes().filter(node => ["alert", "status"].includes(node.props.role)).map(text).join("\n"),
    update(patch) { Object.assign(props, patch); render(); },
    focusables(count) { focusControls = Array.from({ length: count }, (_x, index) => ({ closest: () => null, focus() { globalThis.document.activeElement = this; calls.push(["focus", index]); } })); return focusControls; },
    async settle() { for (let i = 0; i < 4; i++) { render(); while (pendingEffects.length) pendingEffects.shift()(); await tick(); } render(); },
    cleanup() { for (const cleanup of cleanups) cleanup?.(); globalThis.window = previousWindow; globalThis.document = previousDocument; },
  };
}

test("popover independently loads and immediately saves only the changed response/speech field", async () => {
  const h = controller();
  try {
    await h.settle();
    assert.equal(h.render().props.role, "dialog");
    assert.equal(h.nodes().some(node => node.props.role === "menu"), false);
    assert.equal(h.select("Output Language").props.value, "en-US");
    assert.equal(h.select("Code Language").props.value, "python");
    assert.equal(h.select("Meeting Audio Language").props.value, "recall-en");
    assert.equal(h.select("Display"), undefined, "single display is omitted");
    h.select("Output Language").props.onChange({ target: { value: "zh-CN" } }); await h.settle();
    h.select("Meeting Audio Language").props.onChange({ target: { value: "deepgram-zh" } }); await h.settle();
    h.select("Code Language").props.onChange({ target: { value: "java" } });
    assert.deepEqual(h.calls.filter(([name]) => name.startsWith("save")), [["save-ai", { responseLanguage: "zh-CN" }], ["save-speech", { profileId: "deepgram-zh" }]]);
    assert.deepEqual(h.calls.at(-1), ["code", "java"]);
    assert.equal(h.select("Output Language").props.value, "zh-CN");
    assert.equal(h.select("Meeting Audio Language").props.value, "deepgram-zh");
    assert.match(h.message(), /下次新会话生效/);
    assert.equal(h.nodes().some(node => node.type === "input"), false, "no credential or invented preference fields");
  } finally { h.cleanup(); }
});

test("pending saves are single-flight; failures keep confirmed values and remain retryable", async () => {
  const pending = deferred();
  const h = controller({ saveAiSettings(input) { h.calls.push(["save-ai", input]); return pending.promise; } });
  try {
    await h.settle();
    const change = h.select("Output Language").props.onChange;
    change({ target: { value: "zh-CN" } }); change({ target: { value: "zh-CN" } }); await h.settle();
    assert.equal(h.calls.filter(([name]) => name === "save-ai").length, 1);
    assert.equal(h.select("Output Language").props.disabled, true);
    pending.resolve({ success: false, error: "fixture save rejected" }); await h.settle();
    assert.equal(h.select("Output Language").props.value, "en-US"); assert.match(h.message(), /fixture save rejected/);
    assert.equal(h.select("Output Language").props.disabled, false);
    h.api.saveAiSettings = async () => ({ success: true, settings: { responseLanguage: "en" } });
    h.select("Output Language").props.onChange({ target: { value: "zh-CN" } }); await h.settle();
    assert.match(h.message(), /不同的回答语言/); assert.equal(h.select("Output Language").props.value, "en-US");
    h.api.saveTranscriptionSettings = async () => ({ success: true, settings: { profileId: "recall-en" } });
    h.select("Meeting Audio Language").props.onChange({ target: { value: "deepgram-zh" } }); await h.settle();
    assert.match(h.message(), /不同的语音设置/); assert.equal(h.select("Meeting Audio Language").props.value, "recall-en");
  } finally { h.cleanup(); }
});

test("speech preferences are locked for all retained/transitioning audio sessions, including stale handlers", async () => {
  const h = controller();
  try {
    await h.settle(); const stale = h.select("Meeting Audio Language").props.onChange;
    for (const captureStatus of ["starting", "recording", "pausing", "paused", "resuming", "stopping"]) {
      h.update({ captureStatus }); assert.equal(h.select("Meeting Audio Language").props.disabled, true);
      stale({ target: { value: "deepgram-zh" } });
    }
    for (const captureStatus of ["error", "ended"]) {
      h.update({ captureStatus, captureNeedsCleanup: true }); assert.equal(h.select("Meeting Audio Language").props.disabled, true);
    }
    assert.equal(h.calls.some(([name]) => name === "save-speech"), false);
    assert.match(text(h.render()), /音频会话中无法更改/);
    h.update({ captureStatus: "ended", captureNeedsCleanup: false });
    assert.equal(h.select("Meeting Audio Language").props.disabled, false);
  } finally { h.cleanup(); }
});

test("display selection is confirmed by fresh inventory even when geometry is pending; failure is visible", async () => {
  let selected = 1;
  const h = controller({
    async getOverlayDisplays() { return [1, 2].map(id => ({ id, label: `Display ${id}`, isPrimary: id === 1, selected: id === selected })); },
    async selectOverlayDisplay(id) { h.calls.push(["select-display", id]); selected = id; return null; },
  });
  try {
    await h.settle(); assert.equal(h.select("Display").props.value, 1);
    h.select("Display").props.onChange({ target: { value: "2" } }); await h.settle();
    assert.equal(h.select("Display").props.value, 2); assert.match(h.message(), /Display switched/);
    h.api.selectOverlayDisplay = async () => null;
    h.select("Display").props.onChange({ target: { value: "1" } }); await h.settle();
    assert.equal(h.select("Display").props.value, 2); assert.match(h.message(), /尚未切换/);
    h.api.selectOverlayDisplay = async () => { throw new Error("fixture display rejected"); };
    h.select("Display").props.onChange({ target: { value: "1" } }); await h.settle();
    assert.match(h.message(), /fixture display rejected/);
  } finally { h.cleanup(); }
});

test("failed independent loads can reload without inventing an active language/profile", async () => {
  const h = controller({ async getAiSettings() { throw new Error("fixture load failed"); }, async getTranscriptionSettings() { return { profileId: "unknown" }; } });
  try {
    await h.settle(); assert.equal(h.select("Output Language").props.value, ""); assert.equal(h.select("Output Language").props.disabled, true);
    assert.equal(h.select("Meeting Audio Language").props.value, ""); assert.match(h.message(), /无法识别/);
    h.api.getAiSettings = async () => ({ responseLanguage: "zh-CN" }); h.api.getTranscriptionSettings = async () => ({ profileId: "deepgram-zh" });
    h.button("Reload settings").props.onClick(); await h.settle();
    assert.equal(h.select("Output Language").props.value, "zh-CN"); assert.equal(h.select("Meeting Audio Language").props.value, "deepgram-zh");
    assert.doesNotMatch(h.message(), /fixture load failed|无法识别/);
  } finally { h.cleanup(); }
});

test("key display changes notify the production subscription and preserve unrelated renderer preferences", async () => {
  const h = controller();
  try {
    h.storage.data.set(key, '{"future":42}'); await h.settle();
    assert.equal(h.button("Icon mode").props["aria-pressed"], true);
    h.button("Text mode").props.onClick(); await h.settle();
    assert.equal(h.button("Text mode").props["aria-pressed"], true);
    assert.deepEqual(JSON.parse(h.storage.data.get(key)), { future: 42, keyDisplayMode: "text" });
    assert.equal(h.calls.some(([name]) => name.startsWith("save")), false, "UI display mode must not save AI or ASR");
  } finally { h.cleanup(); }
});

test("dialog keyboard navigation preserves select arrows and returns focus on Escape", async () => {
  const h = controller();
  try {
    await h.settle(); const controls = h.focusables(3);
    const event = (key, target = controls[0]) => ({ key, target, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
    controls[0].focus();
    for (const [keyName, expected] of [["ArrowDown", 1], ["End", 2], ["ArrowDown", 0], ["ArrowUp", 2], ["Home", 0]]) {
      const e = event(keyName); h.render().props.onKeyDown(e); assert.equal(globalThis.document.activeElement, controls[expected]); assert.equal(e.prevented, true);
    }
    const selectArrow = event("ArrowDown", { closest: () => ({ tagName: "SELECT" }) });
    h.render().props.onKeyDown(selectArrow); assert.equal(selectArrow.prevented, undefined);
    const escape = event("Escape"); h.render().props.onKeyDown(escape);
    assert.equal(escape.prevented, true); assert.equal(h.calls.filter(([name]) => name === "close").length, 1);
    assert.equal(h.calls.at(-1)[0], "focus-trigger");
  } finally { h.cleanup(); }
});

test("changing hover entry does not return focus until the surviving dialog actually unmounts", async () => {
  const h = controller();
  try {
    const controls = h.focusables(2); await h.settle();
    h.update({ autoFocus: true }); await h.settle();
    assert.equal(globalThis.document.activeElement, controls[0]);
    h.update({ autoFocus: false }); await h.settle();
    assert.equal(globalThis.document.activeElement, controls[0], "hovering the already-open panel must not blur its select");
    assert.equal(h.calls.some(([name]) => name === "focus-trigger"), false);
  } finally { h.cleanup(); }
  assert.equal(h.calls.filter(([name]) => name === "focus-trigger").length, 1, "actual unmount returns focus once");
});

test("dashboard failure stays visible and real secondary actions call their owners", async () => {
  const h = controller({ async accountOpenPortal() { throw new Error("fixture portal rejected"); } });
  try {
    await h.settle(); h.button("Dashboard").props.onClick(); await h.settle(); assert.match(h.message(), /fixture portal rejected/);
    assert.equal(h.calls.some(([name]) => name === "close"), false);
    h.button("Resume").props.onClick(); await h.settle(); assert.ok(h.calls.some(([name]) => name === "resume"));
    h.button("Quick Guide").props.onClick(); await h.settle(); assert.ok(h.calls.some(([name]) => name === "guide"));
    assert.equal(h.nodes().some(node => node.props.role === "menuitem"), false);
  } finally { h.cleanup(); }
});


test("compact output language preserves an active answer and rejects stale handlers while generation is busy", async () => {
  const h = controller();
  try {
    await h.settle();
    const stale = h.select("Output Language").props.onChange;
    h.update({ answerBusy: true });
    assert.equal(h.select("Output Language").props.disabled, true);
    assert.match(text(h.render()), /回答生成完成后可更改回答语言/);
    stale({ target: { value: "zh-CN" } });
    h.select("Output Language").props.onChange({ target: { value: "zh-CN" } });
    await h.settle();
    assert.equal(h.calls.some(([name]) => name === "save-ai"), false, "neither current nor stale UI handlers may reconfigure an active answer");
    assert.equal(h.select("Output Language").props.value, "en-US");
    assert.equal(h.select("Meeting Audio Language").props.disabled, false, "AI generation does not couple the independent speech preference to AI settings");
    h.update({ answerBusy: false });
    assert.equal(h.select("Output Language").props.disabled, false);
    h.select("Output Language").props.onChange({ target: { value: "zh-CN" } }); await h.settle();
    assert.deepEqual(h.calls.filter(([name]) => name === "save-ai"), [["save-ai", { responseLanguage: "zh-CN" }]]);
    assert.equal(h.select("Output Language").props.value, "zh-CN");
  } finally { h.cleanup(); }
});

test("both native settings writes keep the advanced entry closed until their actual promise settles", async () => {
  for (const [label, value, method, settings] of [
    ["Output Language", "zh-CN", "saveAiSettings", { responseLanguage: "zh-CN" }],
    ["Meeting Audio Language", "deepgram-zh", "saveTranscriptionSettings", { profileId: "deepgram-zh" }],
  ]) {
    const pending = deferred();
    const h = controller({ [method]: () => pending.promise });
    const advanced = () => h.nodes().find(node => node.type === "button" && node.props.className?.includes("pw-settings-open"));
    try {
      await h.settle();
      const staleEntry = advanced().props.onClick;
      h.select(label).props.onChange({ target: { value } }); await h.settle();
      assert.equal(advanced().props.disabled, true);
      assert.equal(h.select("Output Language").props.disabled, true);
      assert.equal(h.select("Meeting Audio Language").props.disabled, true);
      staleEntry(); await h.settle();
      assert.equal(h.calls.some(([name]) => name === "advanced" || name === "close"), false);
      pending.resolve({ success: true, settings }); await h.settle();
      assert.equal(advanced().props.disabled, false);
      advanced().props.onClick(); await h.settle();
      assert.ok(h.calls.some(([name]) => name === "advanced"));
    } finally { h.cleanup(); }
  }
});

test("a reopened compact editor defers its snapshot until the workspace's earlier write settles", async () => {
  const h = controller({}, { writeBusy: true });
  try {
    await h.settle();
    assert.deepEqual(h.calls, [], "do not read an older preference snapshot during an inherited pending write");
    assert.equal(h.select("Output Language").props.disabled, true);
    h.api.getAiSettings = async () => ({ responseLanguage: "zh-CN" });
    h.api.getTranscriptionSettings = async () => ({ profileId: "deepgram-zh" });
    h.update({ writeBusy: false }); await h.settle();
    assert.equal(h.select("Output Language").props.value, "zh-CN");
    assert.equal(h.select("Meeting Audio Language").props.value, "deepgram-zh");
    assert.equal(h.select("Output Language").props.disabled, false);
  } finally { h.cleanup(); }
});


test("both compact language selects exactly match the independent SystemContainer catalog", async () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "test/languages/systemcontainer-catalog.json"), "utf8"));
  const h = controller();
  try {
    await h.settle();
    for (const [label, expected] of [["Output Language", manifest.output.entries], ["Code Language", manifest.code.entries]]) {
      const actual = elements(h.select(label)).filter(node => node.type === "option" && node.props.value).map(node => ({ id: node.props.value, label: text(node) }));
      assert.deepEqual(actual, expected.map(({ id, label }) => ({ id, label })));
    }
    assert.equal(h.select("Output Language").props.value, "en-US", "legacy English is rendered as the single catalog English option");
    assert.equal(h.calls.some(([name]) => name === "save-ai"), false, "loading a legacy ID does not rewrite native settings");
    h.select("Output Language").props.onChange({ target: { value: "ja-JP" } }); await h.settle();
    assert.deepEqual(h.calls.filter(([name]) => name === "save-ai"), [["save-ai", { responseLanguage: "ja-JP" }]]);
    h.select("Code Language").props.onChange({ target: { value: "rust" } });
    assert.deepEqual(h.calls.filter(([name]) => name === "code"), [["code", "rust"]]);
  } finally { h.cleanup(); }
});
