import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
function production(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const javascript = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "console", javascript)(id => {
    if (id in mocks) return mocks[id];
    if (id.startsWith(".")) return production(path.relative(root, path.resolve(path.dirname(filename), `${id}.ts`)), mocks);
    return require(id);
  }, module, module.exports, { log() {}, warn() {}, error() {} });
  return module.exports;
}

function clipboardBoundary() {
  const handles = new Map(), writes = [];
  let writeError;
  const frame = {}, contents = { mainFrame: frame };
  let window = { isDestroyed: () => false, webContents: contents };
  const event = { sender: contents, senderFrame: frame };
  const { initializeLiveIpc } = production("electron/live/ipc.ts", {
    electron: {
      ipcMain: { handle(name, callback) { handles.set(name, callback); } },
      clipboard: { writeText(text) { if (writeError) throw writeError; writes.push(text); } },
    },
  });
  initializeLiveIpc({}, () => window, () => {}, () => false);
  return { handles, writes, event, frame, contents,
    setWindow(next) { window = next; }, setWriteError(error) { writeError = error; } };
}

test("the preload's narrow copy IPC reaches the native clipboard without requiring account or Chromium clipboard permissions", async () => {
  const boundary = clipboardBoundary();
  const exposed = new Map(), calls = [];
  production("electron/preload.ts", { electron: {
    contextBridge: { exposeInMainWorld(name, api) { exposed.set(name, api); } },
    ipcRenderer: {
      async invoke(channel, ...args) { calls.push({ channel, args }); return boundary.handles.get(channel)(boundary.event, ...args); },
      on() {}, removeListener() {},
    },
  } });
  const text = "## 回答😀\n\n```python\nprint('原样保留')\n```\n";
  const api = exposed.get("electronAPI");
  assert.equal(typeof api.liveCopyText, "function");
  assert.deepEqual(await api.liveCopyText(text), { success: true });
  assert.deepEqual(calls, [{ channel: "live-copy-text", args: [text] }]);
  assert.deepEqual(boundary.writes, [text]);
  assert.equal(api.clipboard, undefined, "do not expose native clipboard wholesale");
});

test("native copy rejects foreign renderers, subframes and stale windows before touching the clipboard", () => {
  const boundary = clipboardBoundary();
  const copy = boundary.handles.get("live-copy-text");
  for (const event of [
    { sender: {}, senderFrame: boundary.frame },
    { sender: boundary.contents, senderFrame: {} },
    { sender: boundary.contents, senderFrame: undefined },
  ]) assert.throws(() => copy(event, "untrusted text"), /Untrusted session caller/);
  boundary.setWindow(null);
  assert.throws(() => copy(boundary.event, "missing window"), /Untrusted session caller/);
  boundary.setWindow({ isDestroyed: () => true, webContents: boundary.contents });
  assert.throws(() => copy(boundary.event, "destroyed window"), /Untrusted session caller/);
  assert.deepEqual(boundary.writes, []);
});

test("native copy enforces the 128 KiB UTF-8 limit, preserves raw text and rejects type coercion", () => {
  const boundary = clipboardBoundary();
  const copy = text => boundary.handles.get("live-copy-text")(boundary.event, text);
  const exactlyAtLimit = "😀".repeat(32768);
  assert.equal(Buffer.byteLength(exactlyAtLimit), 128 * 1024);
  assert.deepEqual(copy(exactlyAtLimit), { success: true });
  assert.deepEqual(copy(""), { success: true });
  assert.deepEqual(boundary.writes, [exactlyAtLimit, ""]);
  for (const value of [exactlyAtLimit + "x", "中".repeat(43691), "a".repeat(128 * 1024 + 1)]) {
    assert.throws(() => copy(value), /exceeds 128 KiB/);
  }
  for (const value of [null, undefined, 42, true, [], {}, new String("boxed")]) {
    assert.throws(() => copy(value), /Invalid clipboard text/);
  }
  assert.equal(boundary.writes.length, 2);
  boundary.setWriteError(new Error("fixture native clipboard unavailable"));
  assert.throws(() => copy("retry"), /fixture native clipboard unavailable/);
  assert.equal(boundary.writes.length, 2, "failed writes must not report success");
});

function elements(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach(child => elements(child, out)); return out; }
  if (node.props) { out.push(node); elements(node.props.children, out); }
  return out;
}

test("the real copy button prefers native IPC when Web Clipboard rejects and reports native errors without falling back", async () => {
  const previousWindow = globalThis.window;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const raw = "**原始 Markdown😀**\n\n```python\nvalue = 1\n```\n";
  try {
    for (const scenario of ["native-success", "native-rejected", "native-error", "browser-success", "browser-error"]) {
      let nativeCalls = 0, browserCalls = 0, nullable = 0, copyStateIndex = 0, renderingCopy = false;
      const copyStates = [];
      const copiedTexts = [];
      const answer = { id: "copy", question: "question", text: raw, model: "fixture", status: "completed", createdAt: 1, screenshotCount: 0 };
      const snapshot = { sessionId: "fixture", revision: 1, provider: "recall-v2", captureStatus: "idle", transcripts: [], answers: [answer], transcriptTruncated: false, captureNeedsCleanup: false, platformSupported: true };
      const react = { ...React,
        useState(initial) {
          if (!renderingCopy) return [initial === null && nullable++ === 0 ? snapshot : initial, () => {}];
          const index = copyStateIndex++;
          if (!(index in copyStates)) copyStates[index] = initial;
          return [copyStates[index], value => { copyStates[index] = value; }];
        },
        useRef: initial => ({ current: initial }), useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
      };
      const native = scenario.startsWith("native-");
      globalThis.window = { electronAPI: native ? { async liveCopyText(text) {
        nativeCalls++;
        copiedTexts.push(text);
        if (scenario === "native-error") throw new Error("native failure");
        return { success: scenario !== "native-rejected" };
      } } : {} };
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { async writeText(text) {
        browserCalls++;
        copiedTexts.push(text);
        if (scenario !== "browser-success") throw new DOMException("Document is not focused.", "NotAllowedError");
      } } } });
      const { default: Component } = production("src/components/Live/LiveWorkspace.tsx", {
        react,
        "../shared/AISettings": { AISettings: () => null },
        "../shared/ResumePanel": { ResumePanel: () => null },
        "./AnswerMarkdown": { AnswerMarkdown: () => null },
        "./live.css": {},
      });
      const copy = elements(Component({ visible: true })).find(node => typeof node.type === "function" && node.type.name === "CopyText");
      assert.ok(copy);
      renderingCopy = true;
      const renderCopy = () => { copyStateIndex = 0; return copy.type(copy.props); };
      assert.equal(renderCopy().props["aria-label"], "复制回答");
      await renderCopy().props.onClick();
      assert.equal(nativeCalls, native ? 1 : 0);
      assert.equal(browserCalls, native ? 0 : 1);
      assert.deepEqual(copiedTexts, [raw]);
      assert.equal(renderCopy().props["aria-label"], ["native-success", "browser-success"].includes(scenario) ? "已复制" : "复制失败，请重试");
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
  }
});
