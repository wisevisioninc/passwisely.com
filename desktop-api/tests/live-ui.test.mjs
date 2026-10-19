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
import Markdown from "react-markdown";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const filename = path.join(root, "src/components/Live/LiveWorkspace.tsx");
const javascript = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;

// Run the shipped component and its exported control/ordering logic, not a
// second implementation. Only IPC, CSS and unrelated settings panels are mocked.
function production(initialSnapshot, reactOverride) {
  let snapshotInjected = false;
  const react = reactOverride ?? (initialSnapshot === undefined ? React : {
    ...React,
    useState(initial) {
      // The first nullable state is the main-process snapshot. Other state and
      // all hooks retain real React SSR semantics; this does not emulate effects.
      if (initial === null && !snapshotInjected) {
        snapshotInjected = true;
        return React.useState(initialSnapshot);
      }
      return React.useState(initial);
    },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", javascript)((id) => {
    if (id === "react") return react;
    if (id.endsWith(".css")) return {};
    if (id === "../shared/AISettings") return { AISettings: () => null };
    if (id === "../shared/ResumePanel") return { ResumePanel: () => null };
    if (id === "./AnswerMarkdown") return markdownProduction();
    return require(id);
  }, module, module.exports);
  return module.exports;
}

function markdownProduction() {
  const filename = path.join(root, "src/components/Live/AnswerMarkdown.tsx");
  const js = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(id => id === "react-markdown" ? { __esModule: true, default: Markdown } : require(id), module, module.exports);
  return module.exports;
}

function snapshot(patch = {}) {
  return {
    sessionId: "fixture-session", revision: 10, provider: "recall-v2",
    captureStatus: "idle", transcripts: [], answers: [],
    transcriptTruncated: false, captureNeedsCleanup: false,
    platformSupported: true, ...patch,
  };
}

const { isNewerLiveSnapshot, liveCaptureControls } = production();

test("global revisions reject stale reads and late events across sessions", () => {
  const a = snapshot({ sessionId: "a", revision: 10 });
  const b = snapshot({ sessionId: "b", revision: 11 });
  assert.equal(isNewerLiveSnapshot(null, snapshot({ revision: 0 })), true);
  assert.equal(isNewerLiveSnapshot(a, snapshot({ sessionId: "a", revision: 9 })), false);
  assert.equal(isNewerLiveSnapshot(a, a), false);
  assert.equal(isNewerLiveSnapshot(a, snapshot({ sessionId: "a", revision: 11 })), true);
  assert.equal(isNewerLiveSnapshot(a, b), true);
  assert.equal(isNewerLiveSnapshot(b, a), false);
  assert.equal(isNewerLiveSnapshot(b, snapshot({ sessionId: "unseen-old", revision: 2 })), false);
  assert.equal(isNewerLiveSnapshot(b, snapshot({ sessionId: "different", revision: 11 })), false);
});

test("retained capture ownership blocks a new session and keeps release available", () => {
  for (const captureStatus of ["error", "ended"]) {
    for (const busy of [false, true]) {
      const controls = liveCaptureControls(snapshot({ captureStatus, captureNeedsCleanup: true }), busy);
      assert.equal(controls.showStart, true);
      assert.equal(controls.startDisabled, true);
      assert.equal(controls.stopDisabled, false);
      assert.equal(controls.stopLabel, "释放采集");
    }
  }
  assert.equal(liveCaptureControls(snapshot({ captureStatus: "ended" }), false).startDisabled, false);
  assert.equal(liveCaptureControls(snapshot({ captureStatus: "error" }), false).startDisabled, false);
});

test("a pending start can be cancelled while repeated stop remains blocked", () => {
  const starting = liveCaptureControls(snapshot({ captureStatus: "starting" }), true);
  assert.equal(starting.showStart, false);
  assert.equal(starting.stopDisabled, false);
  assert.equal(starting.stopLabel, "取消启动");
  assert.equal(liveCaptureControls(snapshot({ captureStatus: "stopping", captureNeedsCleanup: true }), true).stopDisabled, true);
  assert.equal(liveCaptureControls(snapshot({ captureStatus: "paused", captureNeedsCleanup: true }), false).stopDisabled, false);
  assert.equal(liveCaptureControls(snapshot({ platformSupported: false }), false).startDisabled, true);
  assert.equal(liveCaptureControls(null, false).stopDisabled, true);
});

function renderWorkspace(state, visible = true) {
  const previousWindow = globalThis.window;
  const previousError = console.error;
  let startCalls = 0, askCalls = 0;
  globalThis.window = { electronAPI: {
    liveStart: async () => { startCalls++; return { success: true }; },
    liveAsk: async () => { askCalls++; return { success: true }; },
  } };
  // React correctly warns that layout effects are not executed by SSR. All
  // other warnings remain visible. Client mount/IPC races need a browser test.
  console.error = (...args) => {
    if (String(args[0]).startsWith("Warning: useLayoutEffect does nothing on the server")) return;
    previousError(...args);
  };
  try {
    const Component = production(state).default;
    const html = renderToStaticMarkup(React.createElement(Component, { visible }));
    return { dom: parseHtml(html), startCalls, askCalls };
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    console.error = previousError;
  }
}

test("initial and hidden renders contain no invented transcripts or render-time capture", () => {
  for (const visible of [false, true]) {
    const { dom: $, startCalls, askCalls } = renderWorkspace(undefined, visible);
    assert.equal($(".pw-live").attr("hidden") !== undefined, !visible);
    assert.equal($(".pw-live-segment").length, 0);
    assert.equal($(".pw-live-answer").length, 0);
    assert.equal($("textarea[aria-label='会话提问']").length, 0);
    assert.equal($(".pw-live-card").length, 0, "idle contains only the compact command bar");
    assert.equal(startCalls, 0);
    assert.equal(askCalls, 0);
  }
});

test("sending requires usable context; partial ASR alone is not final context", () => {
  const segment = { id: "fixture-segment", source: "unknown", text: "一句待确认的语音", receivedAt: 1, isFinal: false };
  for (const transcripts of [[], [segment]]) {
    const { dom: $ } = renderWorkspace(snapshot({ transcripts }));
    assert.equal($("button[aria-label='Solve / 生成回答']").prop("disabled"), true);
  }
  const { dom: $ } = renderWorkspace(snapshot({ transcripts: [{ ...segment, isFinal: true }] }));
  assert.equal($("button[aria-label='Solve / 生成回答']").prop("disabled"), false);
  assert.ok($(".pw-live-segment.source-unknown").attr("aria-label").includes("来源未知"));
});

test("recording consent disclosure is present before capture and generation has its own stop", () => {
  const { dom: $ } = renderWorkspace(snapshot());
  const disclosure = $(".pw-live-start").attr("title");
  assert.ok(disclosure.includes("发送并保存"));
  assert.ok(disclosure.includes("你的 Recall 项目"));
  assert.ok(disclosure.includes("点击后开始英文实时转录"));
  const answer = { id: "fixture-answer", question: "上下文是什么？", text: "已收到的部分回答", model: "fixture-model", status: "streaming", createdAt: 1, screenshotCount: 0 };
  const { dom: active } = renderWorkspace(snapshot({ captureStatus: "recording", answers: [answer] }));
  const stopAnswer = active("button[aria-label='停止生成']");
  assert.equal(stopAnswer.length, 1);
  assert.equal(stopAnswer.prop("disabled"), false);
  assert.ok(active(".pw-live-answer-text").text().includes(answer.text));
  assert.equal(active("button[aria-label='Solve / 生成回答']").prop("disabled"), true);
});

test("ending keeps session text visible and a new session discloses its clearing boundary", () => {
  const transcript = { id: "ended-segment", source: "system", text: "保留的转录", receivedAt: 1, isFinal: true };
  const answer = { id: "ended-answer", question: "保留的问题", text: "保留的回答", model: "fixture-model", status: "completed", createdAt: 1, screenshotCount: 0 };
  const { dom: $ } = renderWorkspace(snapshot({ captureStatus: "ended", transcripts: [transcript], answers: [answer] }));
  assert.ok($(".pw-live-segment").text().includes(transcript.text));
  assert.ok($(".pw-live-answer-text").text().includes(answer.text));
  assert.ok($(".pw-live-start").attr("title").includes("开始新会话将清空当前转录和回答"));
  assert.equal($("button[aria-label='Solve / 生成回答']").prop("disabled"), false);
});

function elements(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
const elementText = node => typeof node === "string" ? node : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(elementText).join("") : "";

test("only starting a session changes the current answer tab; pause, resume and end preserve it", async () => {
  const previousWindow = globalThis.window;
  try {
    for (const [captureStatus, label, method] of [["ended", "Start Interview", "liveStart"], ["recording", "Pause Listening / 暂停采集", "livePause"], ["paused", "Resume Listening / 继续采集", "liveResume"], ["paused", "Done", "liveStop"]]) {
      const tabs = [], panels = [];
      let nullable = 0, calls = 0;
      const react = {
        ...React, useState(initial) {
          if (initial === null) return [nullable++ === 0 ? snapshot({ captureStatus, captureNeedsCleanup: captureStatus !== "ended" }) : null, value => panels.push(value)];
          if (initial === "answers") return ["answers", value => tabs.push(value)];
          return [initial, () => {}];
        }, useRef: initial => ({ current: initial }), useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
      };
      globalThis.window = { electronAPI: { [method]: async () => { calls++; return { success: true }; } } };
      const Component = production(undefined, react).default;
      const tree = Component({ visible: true });
      const button = elements(tree).find(node => node.type === "button" && (elementText(node).trim() === label || node.props["aria-label"] === label));
      assert.ok(button, `production ${label} button exists`);
      button.props.onClick(); await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls, 1);
      assert.deepEqual(tabs, method === "liveStart" ? ["transcript"] : []);
      assert.deepEqual(panels, method === "liveStart" ? [null] : []);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("the mounted workspace forwards ordered real snapshots to navigation even while hidden", async () => {
  const previousWindow = globalThis.window;
  try {
    for (const visible of [false, true]) {
      const effects = [], forwarded = [];
      let receive;
      const react = { ...React,
        useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }),
        useEffect: effect => effects.push(effect), useLayoutEffect() {}, useCallback: fn => fn,
      };
      globalThis.window = { electronAPI: {
        onLiveSnapshot(listener) { receive = listener; return () => {}; },
        async liveGetSnapshot() { return snapshot({ revision: 1, captureStatus: "recording" }); },
        async liveSetWorkspace() {},
      } };
      const Component = production(undefined, react).default;
      Component({ visible, onSnapshot: next => forwarded.push(next) });
      const cleanup = effects[0]();
      await new Promise(resolve => setImmediate(resolve));
      receive(snapshot({ revision: 2, captureStatus: "paused" }));
      receive(snapshot({ revision: 1, captureStatus: "recording" }));
      assert.deepEqual(forwarded.map(next => next.captureStatus), ["recording", "paused"]);
      cleanup();
      receive(snapshot({ revision: 3, captureStatus: "ended" }));
      assert.equal(forwarded.length, 2);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("the actual answer renderer parses headings, emphasis, lists and code while streaming unfinished Markdown", () => {
  const text = "## 建议\n\n**先确认边界**\n\n- 第一项\n- 第二项\n\n1. 步骤一\n2. 步骤二\n\n```python\nprint('<safe>')\n```";
  const answer = { id: "markdown", question: "怎么做？", text, model: "fixture", status: "streaming", createdAt: 1, screenshotCount: 0 };
  const { dom: $ } = renderWorkspace(snapshot({ answers: [answer] }));
  assert.equal($(".pw-live-answer-text h2").text(), "建议");
  assert.equal($(".pw-live-answer-text strong").text(), "先确认边界");
  assert.equal($(".pw-live-answer-text ul li").length, 2);
  assert.equal($(".pw-live-answer-text ol li").length, 2);
  assert.equal($("pre code.language-python").text(), "print('<safe>')\n");
  assert.equal($("safe").length, 0);
  assert.equal($(".pw-live-answer-text .pw-live-caret").length, 1);
  for (const partial of ["**正在生成", "```python\nprint('unfinished')"]) {
    const { dom: partialDom } = renderWorkspace(snapshot({ answers: [{ ...answer, text: partial }] }));
    assert.ok(partialDom(".pw-live-answer-text").text().includes(partial.includes("python") ? "unfinished" : "正在生成"));
  }
});

test("Markdown cannot enable HTML, load images or open local/script/data URLs", () => {
  const { AnswerMarkdown, answerExternalUrl } = markdownProduction();
  const text = [
    '<script>alert(1)</script>', '<img src="https://example.test/tracking" onerror="alert(1)">', '<iframe src="file:///tmp/private"></iframe>',
    '![tracking](https://example.test/tracking.png)', '![local](file:///tmp/private)',
    '[script](javascript:alert%281%29)', '[file](file:///tmp/private)', '[data](data:text/html,evil)',
    '[mail](mailto:fixture@example.test)', '[relative](/secret)', '[safe](https://example.test/guide)',
  ].join("\n\n");
  const $ = parseHtml(renderToStaticMarkup(React.createElement(AnswerMarkdown, { text })));
  assert.equal($("script,img,iframe,svg,style,[onerror]").length, 0);
  assert.equal($("a").length, 1);
  assert.equal($("a").attr("href"), "https://example.test/guide");
  assert.equal($("a").attr("rel"), "noopener noreferrer");
  for (const url of ["javascript:alert(1)", "file:///tmp/private", "data:text/html,evil", "mailto:x@y.test", "/relative", "#fragment", "not a url"]) assert.equal(answerExternalUrl(url), undefined);
});

test("safe Markdown links use Electron's existing external handler and Copy keeps the unmodified raw response", async () => {
  const previousWindow = globalThis.window;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const opened = [], copied = [];
  const raw = "## 原文\n\n**加粗**\n\n```js\nconst value = 1;\n```";
  let nullable = 0;
  const answer = { id: "copy", question: "问题", text: raw, model: "fixture", status: "completed", createdAt: 1, screenshotCount: 0 };
  const react = { ...React,
    useState(initial) { return [initial === null && nullable++ === 0 ? snapshot({ answers: [answer] }) : initial, () => {}]; },
    useRef: initial => ({ current: initial }), useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
  };
  globalThis.window = { electronAPI: { openExternal(url) { opened.push(url); } } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { async writeText(text) { copied.push(text); } } } });
  try {
    const { AnswerMarkdown } = markdownProduction();
    const markdown = AnswerMarkdown({ text: "[safe](https://example.test/)" });
    const link = markdown.props.components.a({ href: "https://example.test/", children: "safe" });
    let prevented = false;
    link.props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.deepEqual(opened, ["https://example.test/"]);
    const Component = production(undefined, react).default;
    const copy = elements(Component({ visible: true })).find(node => typeof node.type === "function" && node.type.name === "CopyText");
    assert.equal(copy.props.text, raw);
    const copyButton = copy.type(copy.props);
    copyButton.props.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(copied, [raw]);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
  }
});

// Component controller tests run the production event handlers and mount
// subscriptions with IPC/DOM boundaries mocked. They do not claim native hit
// testing or pixel verification, which require the signed Mac application.
async function clientWorkspace(initial, overrides = {}) {
  const previous = Object.fromEntries(["window", "document", "Element", "HTMLElement"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), effects = [], states = [], refs = [], cleanups = [], interactions = [];
  let si = 0, ri = 0, mounting = true, receive, shortcut, queueChanged, screenshotError, visibilityChanged, point = null;
  class ElementBoundary {
    constructor(interactive = false) { this.interactive = interactive; }
    closest() { return this.interactive ? this : null; }
    matches() { return false; }
    setPointerCapture() { this.captured = true; }
    hasPointerCapture() { return !!this.captured; }
    releasePointerCapture() { this.captured = false; }
  }
  const add = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  const remove = (name, fn) => listeners.get(name)?.delete(fn);
  const api = {
    onLiveSnapshot(fn) { receive = fn; return () => {}; }, async liveGetSnapshot() { return initial; },
    async liveSetWorkspace() {}, onLiveShortcut(fn) { shortcut = fn; return () => {}; },
    async getScreenshots() { return []; }, onScreenshotTaken() { return () => {}; },
    onScreenshotQueueChanged(fn) { queueChanged = fn; return () => {}; },
    onScreenshotError(fn) { screenshotError = fn; return () => {}; },
    onOverlayVisibilityChanged(fn) { visibilityChanged = fn; return () => {}; },
    onOverlayRecenter() { return () => {}; }, async setOverlayInteractive(value) { interactions.push(value); }, async setOverlayFocus() {},
    async liveStartOver() { return { success: true }; }, async liveAsk() { return { success: true }; },
    async liveStart() { return { success: true }; }, async liveStop() { return { success: true }; },
    async livePause() { return { success: true }; }, async liveResume() { return { success: true }; },
    async liveCancelAnswer() { return { success: true }; }, async triggerScreenshot() { return { success: true }; },
    ...overrides,
  };
  const react = { ...React,
    useState(initialState) {
      const index = si++;
      if (!(index in states)) states[index] = index === 0 ? initial : initialState;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initialRef) { const index = ri++; if (!(index in refs)) refs[index] = { current: initialRef }; return refs[index]; },
    useEffect(effect) { if (mounting) effects.push(effect); }, useLayoutEffect() {}, useCallback: fn => fn,
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1200, innerHeight: 800, electronAPI: api, addEventListener: add, removeEventListener: remove } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener: add, removeEventListener: remove, elementFromPoint: () => point, activeElement: null } });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: ElementBoundary });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: ElementBoundary });
  const Component = production(undefined, react).default;
  const render = () => { si = 0; ri = 0; return Component({ visible: true }); };
  render(); mounting = false;
  for (const effect of effects) { const cleanup = effect(); if (typeof cleanup === "function") cleanups.push(cleanup); }
  await new Promise(resolve => setImmediate(resolve));
  const nodes = () => elements(render());
  const by = predicate => nodes().find(predicate);
  const label = value => by(node => node.props["aria-label"] === value);
  const textButton = value => by(node => node.type === "button" && elementText(node).trim().startsWith(value));
  return {
    render, nodes, by, label, textButton, api, interactions, ElementBoundary,
    async tick() { await new Promise(resolve => setImmediate(resolve)); },
    emit(next) { receive(next); }, shortcut(action) { shortcut(action); }, queueChanged() { queueChanged(); },
    screenshotError(message) { screenshotError(message); }, visibilityChanged(shown) { visibilityChanged(shown); },
    pointerMove(target, x = 600, y = 740) { for (const listener of listeners.get("pointermove") ?? []) listener({ target, clientX: x, clientY: y }); },
    setPoint(next) { point = next; },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}
function pendingResult() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test("recording shows pause only; paused exposes resume and Done; cancellation and retained cleanup remain reachable", () => {
  const { dom: recording } = renderWorkspace(snapshot({ captureStatus: "recording", captureNeedsCleanup: true }));
  assert.equal(recording("button[title='Pause Listening']").length, 1);
  assert.equal(recording("button[title='Stop Listening']").length, 0);
  const { dom: paused } = renderWorkspace(snapshot({ captureStatus: "paused", captureNeedsCleanup: true }));
  assert.equal(paused("button[title='Resume Listening']").length, 1);
  assert.equal(paused("button[title='Stop Listening']").length, 1);
  for (const [captureStatus, text] of [["starting", "Cancel"], ["error", "Release audio"], ["ended", "Release audio"]]) {
    const { dom: $ } = renderWorkspace(snapshot({ captureStatus, captureNeedsCleanup: captureStatus !== "starting" }));
    assert.ok($(".pw-live-done").text().includes(text));
    assert.equal($(".pw-live-done").prop("disabled"), false);
  }
});

test("Start Over and its shortcut share one guarded request; late completion cannot erase or close a newer draft", async () => {
  let request = pendingResult(), clears = 0;
  const h = await clientWorkspace(snapshot({ captureStatus: "paused", captureNeedsCleanup: true }), { liveStartOver() { clears++; return request.promise; } });
  try {
    h.label("手动输入问题").props.onClick();
    h.textButton("Transcripts").props.onClick();
    h.label("Settings / 设置").props.onClick();
    h.textButton("Start Over").props.onClick();
    h.label("会话提问").props.onChange({ target: { value: "newly typed while Trash waits" } });
    request.resolve({ success: true }); await h.tick();
    assert.equal(h.label("会话提问").props.value, "newly typed while Trash waits");
    assert.equal(h.textButton("Transcripts").props["aria-pressed"], true, "clear retains the current tab");
    assert.equal(clears, 1);
    request = pendingResult(); h.shortcut("clear");
    h.emit(snapshot({ sessionId: "new-session", revision: 20, captureStatus: "recording", captureNeedsCleanup: true }));
    h.label("会话提问").props.onChange({ target: { value: "next session draft" } });
    request.resolve({ success: true }); await h.tick();
    assert.equal(clears, 2); assert.equal(h.label("会话提问").props.value, "next session draft");
  } finally { h.dispose(); }
});

test("stopped-session Start Over clears the accepted draft and hides empty content; failed cleanup stays visible", async () => {
  const answer = { id: "ended", question: "question", text: "retained answer", model: "fixture", status: "completed", createdAt: 1, screenshotCount: 0 };
  let request = pendingResult();
  const h = await clientWorkspace(snapshot({ captureStatus: "ended", answers: [answer] }), { liveStartOver: () => request.promise });
  try {
    h.label("手动输入问题").props.onClick();
    h.label("会话提问").props.onChange({ target: { value: "clear this draft" } });
    h.textButton("Start Over").props.onClick();
    h.emit(snapshot({ captureStatus: "ended", revision: 11 }));
    request.resolve({ success: true }); await h.tick();
    assert.equal(h.label("会话提问").props.value, "");
    request = pendingResult(); h.shortcut("clear"); request.resolve({ success: true }); await h.tick();
    assert.equal(h.label("会话提问"), undefined);
    assert.equal(h.by(node => node.props.className === "pw-live-card pw-glass"), undefined);
    request = pendingResult(); h.shortcut("clear"); request.resolve({ success: false, error: "fixture Trash failure" }); await h.tick();
    assert.ok(elementText(h.by(node => node.props.role === "alert")).includes("fixture Trash failure"));
  } finally { h.dispose(); }
});

test("transient input supports Escape and Enter while an older submission cannot clear later text", async () => {
  const request = pendingResult(), asks = [];
  const h = await clientWorkspace(snapshot(), { liveAsk(input) { asks.push(input); return request.promise; } });
  try {
    h.label("手动输入问题").props.onClick();
    h.label("会话提问").props.onChange({ target: { value: "first question" } });
    let input = h.label("会话提问");
    input.props.onKeyDown({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } });
    assert.equal(asks.length, 0);
    input.props.onKeyDown({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} });
    assert.equal(asks.length, 1); assert.equal(asks[0].question, "first question");
    h.label("手动输入问题").props.onClick();
    h.label("会话提问").props.onChange({ target: { value: "new question" } });
    request.resolve({ success: true }); await h.tick();
    assert.equal(h.label("会话提问").props.value, "new question");
    h.label("会话提问").props.onKeyDown({ key: "Escape" });
    assert.equal(h.label("会话提问"), undefined);
  } finally { h.dispose(); }
});

test("collapse, moving and resizing retain the session; lost pointer capture releases empty-surface mouse ownership", async () => {
  const h = await clientWorkspace(snapshot({ captureStatus: "paused", captureNeedsCleanup: true }));
  try {
    const initial = h.by(node => node.props.className === "pw-live-windows");
    assert.equal(initial.props.style.width, 600); assert.equal(initial.props.style.bottom, 84);
    h.label("Collapse / 收起内容").props.onClick();
    assert.equal(h.by(node => node.props.className === "pw-live-card pw-glass"), undefined);
    h.textButton("Expand").props.onClick();
    const target = new h.ElementBoundary(true);
    const drag = h.label("移动浮条");
    drag.props.onPointerDown({ button: 0, pointerId: 1, clientX: 600, clientY: 740, currentTarget: target, preventDefault() {} });
    drag.props.onPointerMove({ pointerId: 1, clientX: 660, clientY: 640 });
    assert.equal(h.by(node => node.props.className === "pw-live-toolbar pw-glass").props.style.top, 640);
    assert.equal(h.interactions.at(-1), true);
    h.setPoint(null); drag.props.onLostPointerCapture({ clientX: 0, clientY: 0 });
    assert.equal(h.interactions.at(-1), false);
    const resize = h.label("调整内容宽度");
    resize.props.onPointerDown({ button: 0, pointerId: 2, clientX: 900, clientY: 400, currentTarget: target, preventDefault() {} });
    resize.props.onPointerMove({ pointerId: 2, clientX: 1000, clientY: 400 });
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.width, 800);
    resize.props.onPointerUp({ pointerId: 2, clientX: 0, clientY: 0, currentTarget: target });
    assert.equal(h.interactions.at(-1), false);
  } finally { h.dispose(); }
});

test("the settings hover timer owns its 500ms close delay and can be cancelled when entering its popover", async () => {
  const h = await clientWorkspace(snapshot());
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = [], cancelled = [];
  globalThis.setTimeout = (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; };
  globalThis.clearTimeout = timer => { cancelled.push(timer); };
  try {
    const anchor = h.by(node => node.props.className === "pw-live-settings-anchor");
    anchor.props.onPointerEnter(); assert.ok(h.by(node => node.props.role === "menu"));
    anchor.props.onPointerLeave(); assert.equal(timers.at(-1).delay, 500);
    anchor.props.onPointerEnter(); assert.ok(cancelled.includes(timers.at(-1)));
    anchor.props.onPointerLeave(); timers.at(-1).callback();
    assert.equal(h.by(node => node.props.role === "menu"), undefined);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; h.dispose(); }
});


test("idle screenshot errors reopen the card and native visibility resets the hit-test cache", async () => {
  const h = await clientWorkspace(snapshot());
  try {
    assert.equal(h.by(node => node.props.className === "pw-live-card pw-glass"), undefined);
    h.screenshotError("fixture screen permission failure");
    assert.ok(elementText(h.by(node => node.props.role === "alert")).includes("fixture screen permission failure"));
    const region = new h.ElementBoundary(true);
    h.setPoint(region); h.pointerMove(region);
    assert.equal(h.interactions.at(-1), true);
    h.visibilityChanged(false); assert.equal(h.interactions.at(-1), false);
    h.visibilityChanged(true); assert.equal(h.interactions.at(-1), true);
    h.setPoint(null); h.pointerMove(null);
    assert.equal(h.interactions.at(-1), false);
  } finally { h.dispose(); }
});
