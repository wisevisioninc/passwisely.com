import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load as parseHtml } from "cheerio";
import Markdown from "react-markdown";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const filename = path.join(root, "src/components/Live/LiveWorkspace.tsx");
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
  return createProductionTsLoader({ mocks: {
    react,
    "../shared/AISettings": { AISettings: () => null },
    "../shared/ResumePanel": { ResumePanel: () => null },
    "react-markdown": { __esModule: true, default: Markdown },
  } })(filename);
}

function markdownProduction() {
  return createProductionTsLoader({ mocks: { "react-markdown": { __esModule: true, default: Markdown } } })(path.join(root, "src/components/Live/AnswerMarkdown.tsx"));
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
    assert.equal($(".pw-live").attr("hidden") !== undefined, true, "SSR waits for native live geometry instead of using the Auth viewport");
    assert.equal($(".pw-live-segment").length, 0);
    assert.equal($(".pw-live-answer").length, 0);
    assert.equal($("textarea[aria-label='会话提问']").length, 0);
    assert.equal($(".pw-live-card").length, 0, "idle contains only the compact command bar");
    assert.equal(startCalls, 0);
    assert.equal(askCalls, 0);
  }
});

test("the production transcript projector renders three continuous final ASR rows as one complete bubble without changing raw input", () => {
  const channelId = createProductionTsLoader()(path.join(root, "electron/live/recallTranscript.ts")).createRecallTranscriptNormalizer().normalize({ event: "transcript.data", data: { source: "system", data: { participant: { id: "synthetic-remote", name: "Guest" }, words: [{ text: "fixture" }] } } }).channelId;
  const segments = [
    { id: "short-1", text: "先处理", startMs: 0, endMs: 500, receivedAt: 1000 },
    { id: "short-2", text: "空数组，", startMs: 600, endMs: 1200, receivedAt: 2000 },
    { id: "short-3", text: "再检查左右边界。", startMs: 1300, endMs: 2500, receivedAt: 3000 },
  ].map(segment => ({ ...segment, source: "system", participantId: "synthetic-remote", speaker: "Guest", channelId, captureEpoch: 0, isFinal: true }));
  const state = snapshot({ captureStatus: "ended", transcripts: segments });
  const original = JSON.stringify(state);
  const { dom: $ } = renderWorkspace(state);
  assert.equal($(".pw-live-segment").length, 1);
  assert.equal($(".pw-live-segment.source-system.final p").text(), "先处理空数组，再检查左右边界。");
  assert.equal($(".pw-live-segment.source-microphone").length, 0);
  assert.equal($(".pw-live-segment .pw-live-caret").length, 0);
  assert.equal(state.transcripts.length, 3);
  assert.equal(JSON.stringify(state), original);
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
  assert.ok(disclosure.includes("按已保存的语音设置开始新会话"));
  assert.ok(!disclosure.includes("开始英文实时转录"));
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
async function clientWorkspace(initial, overrides = {}, initialBounds = { width: 1200, height: 800 }) {
  const previous = Object.fromEntries(["window", "document", "Element", "HTMLElement"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), effects = [], layouts = [], states = [], refs = [], cleanups = [], interactions = [];
  let si = 0, ri = 0, mounting = true, receive, shortcut, queueChanged, screenshotError, visibilityChanged, geometryChanged, point = null;
  let currentGeometry = { displayId: 1, width: 1200, height: 800 };
  class ElementBoundary {
    constructor(interactive = false, field = false, dialog = false) { this.interactive = interactive; this.field = field; this.dialog = dialog; this.isConnected = true; }
    closest(selector) {
      if (selector === '[role="dialog"],[role="alertdialog"]') return this.dialog ? this : null;
      return this.interactive ? this : null;
    }
    matches() { return this.field; }
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
    async getOverlayGeometry() { return currentGeometry; },
    onOverlayGeometryChanged(fn) { geometryChanged = fn; return () => {}; },
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
    useEffect(effect) { if (mounting) effects.push(effect); }, useLayoutEffect(effect, dependencies) { if (dependencies === undefined) layouts.push(effect); }, useCallback: fn => fn,
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: initialBounds.width, innerHeight: initialBounds.height, electronAPI: api, addEventListener: add, removeEventListener: remove } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { addEventListener: add, removeEventListener: remove, elementFromPoint: () => point, activeElement: null } });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: ElementBoundary });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: ElementBoundary });
  const Component = production(undefined, react).default;
  const render = () => { si = 0; ri = 0; layouts.length = 0; const tree = Component({ visible: true }); for (const layout of layouts) layout(); return tree; };
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
    geometryChanged(next) { currentGeometry = next; geometryChanged(next); },
    resizeWindow(width, height) { window.innerWidth = width; window.innerHeight = height; for (const listener of listeners.get("resize") ?? []) listener(); },
    pointerMove(target, x = 600, y = 740) { for (const listener of listeners.get("pointermove") ?? []) listener({ target, clientX: x, clientY: y }); },
    setPoint(next) { point = next; },
    focusIn(target) { for (const listener of listeners.get("focusin") ?? []) listener({ target }); },
    focusOut(target, relatedTarget) { for (const listener of listeners.get("focusout") ?? []) listener({ target, relatedTarget }); },
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
  const h = await clientWorkspace(snapshot({ captureStatus: "ended", transcripts: [{ id: "retained", source: "system", text: "Retained transcript", isFinal: true, receivedAt: 1 }] }), { liveStartOver() { clears++; return request.promise; } });
  try {
    h.label("手动输入问题").props.onClick();
    h.textButton("Transcripts").props.onClick();
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
    assert.equal(initial.props.style.width, 600); assert.equal(initial.props.style.top, 84);
    h.label("Collapse / 收起内容").props.onClick();
    assert.equal(h.by(node => node.props.className === "pw-live-card pw-glass"), undefined);
    h.textButton("Expand").props.onClick();
    const target = new h.ElementBoundary(true);
    const drag = h.label("移动浮条");
    drag.props.onPointerDown({ button: 0, pointerId: 1, clientX: 600, clientY: 20, currentTarget: target, preventDefault() {} });
    drag.props.onPointerMove({ pointerId: 1, clientX: 660, clientY: 120 });
    assert.equal(h.by(node => node.props.className === "pw-live-toolbar pw-glass").props.style.top, 120);
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
    anchor.props.onPointerEnter(); assert.ok(h.by(node => typeof node.type === "function" && node.type.name === "LiveSettingsPopover"));
    anchor.props.onPointerLeave(); assert.equal(timers.at(-1).delay, 500);
    anchor.props.onPointerEnter(); assert.ok(cancelled.includes(timers.at(-1)));
    anchor.props.onPointerLeave(); timers.at(-1).callback();
    assert.equal(h.by(node => typeof node.type === "function" && node.type.name === "LiveSettingsPopover"), undefined);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; h.dispose(); }
});

test("the settings popover chooses available space and stays within the screen after vertical movement", async () => {
  const h = await clientWorkspace(snapshot({ captureStatus: "paused", captureNeedsCleanup: true }));
  try {
    h.label("Settings / 设置").props.onClick();
    let menu = h.by(node => typeof node.type === "function" && node.type.name === "LiveSettingsPopover");
    assert.equal(menu.props.placement, "below");
    assert.ok(menu.props.maxHeight > 600);
    const target = new h.ElementBoundary(true);
    const drag = h.label("移动浮条");
    drag.props.onPointerDown({ button: 0, pointerId: 1, clientX: 600, clientY: 20, currentTarget: target, preventDefault() {} });
    drag.props.onPointerMove({ pointerId: 1, clientX: 600, clientY: 1000 });
    menu = h.by(node => typeof node.type === "function" && node.type.name === "LiveSettingsPopover");
    const bar = h.by(node => node.props.className === "pw-live-toolbar pw-glass");
    assert.equal(menu.props.placement, "above");
    assert.ok(menu.props.maxHeight + 8 <= bar.props.style.top - 20);
  } finally { h.dispose(); }
});

test("transcript title describes the view while recording state remains on the controls", async () => {
  for (const captureStatus of ["recording", "paused", "ended"]) {
    const h = await clientWorkspace(snapshot({ captureStatus, captureNeedsCleanup: captureStatus !== "ended", transcripts: [{ id: "t", source: "microphone", text: "synthetic speech", receivedAt: 1, isFinal: true }] }));
    try {
      h.textButton("Transcripts").props.onClick();
      assert.equal(elementText(h.by(node => node.props.className === "pw-live-title")), "AI Transcripts");
    } finally { h.dispose(); }
  }
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


test("the live card waits for authoritative workArea geometry, ignores Auth width and drops a stale initial read", async () => {
  const pending = pendingResult();
  const h = await clientWorkspace(snapshot({ captureStatus: "paused", captureNeedsCleanup: true }), { getOverlayGeometry: () => pending.promise }, { width: 600, height: 720 });
  try {
    assert.equal(h.by(node => node.props.className === "pw-live pw-overlay").props.hidden, true);
    h.geometryChanged({ displayId: 7, width: 1920, height: 1040 });
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.width, 960);
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.top, 84);
    assert.deepEqual(h.by(node => node.props.className === "pw-live-toolbar pw-glass").props.style, { left: 960, top: 20 });
    pending.resolve({ displayId: 7, width: 600, height: 720 }); await h.tick();
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.width, 960);
    assert.equal(h.by(node => node.props.className === "pw-live pw-overlay").props.hidden, false);
  } finally { h.dispose(); }
});

test("default half-width tracks the native display until resized; showing again preserves user width and a new display reinitializes it", async () => {
  const h = await clientWorkspace(snapshot({ captureStatus: "paused", captureNeedsCleanup: true }), {}, { width: 600, height: 720 });
  try {
    h.geometryChanged({ displayId: 1, width: 1920, height: 1040 });
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.width, 960);
    const target = new h.ElementBoundary(true), resize = h.label("调整内容宽度");
    resize.props.onPointerDown({ button: 0, pointerId: 1, clientX: 1440, clientY: 200, currentTarget: target, preventDefault() {} });
    resize.props.onPointerMove({ pointerId: 1, clientX: 1540, clientY: 200 });
    resize.props.onPointerUp({ pointerId: 1, clientX: 0, clientY: 0, currentTarget: target });
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.width, 1160);
    h.visibilityChanged(false); h.visibilityChanged(true); await h.tick();
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.width, 1160);
    h.resizeWindow(600, 720); await h.tick();
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.width, 1160, "DOM dimensions cannot replace native workArea");
    h.geometryChanged({ displayId: 2, width: 1920, height: 1040 });
    assert.equal(h.by(node => node.props.className === "pw-live-windows").props.style.width, 960);
    assert.equal(h.by(node => node.props.className === "pw-live-toolbar pw-glass").props.style.top, 20);
  } finally { h.dispose(); }
});

test("the restored PassWisely logo is used in both surfaces, with complete screenshot text and distinct keycaps", () => {
  const { dom: $ } = renderWorkspace(snapshot({ captureStatus: "paused", captureNeedsCleanup: true }));
  assert.equal($("img.pw-live-brand[src='./logo512.png'][width='24'][height='24']").length, 1);
  assert.equal($("img.pw-live-toolbar-brand[src='./logo512.png'][width='24'][height='24']").length, 1);
  const screenshot = $("button[aria-label='Take Screenshot / 截图']");
  assert.ok(screenshot.text().includes("Take Screenshot"));
  assert.deepEqual(screenshot.find("kbd").toArray().map(element => $(element).text()), ["⌘", "H"]);
});


test("the glass card and transcript/answer body pass through while explicit controls retain mouse ownership", () => {
  const answer = { id: "pass-through", question: "A question", text: "A response with [a safe link](https://example.test/guide)", status: "completed", createdAt: 1, screenshotCount: 0 };
  const { dom: $ } = renderWorkspace(snapshot({ captureStatus: "ended", answers: [answer] }));
  for (const selector of [".pw-live-card", ".pw-live-scroll", ".pw-live-answer", ".pw-live-answer-text", ".pw-live-response-view", ".pw-live-transcript-view"]) {
    assert.equal($(selector).attr("data-overlay-interactive"), undefined, `${selector} does not capture its whole background`);
  }
  for (const selector of [".pw-live-toolbar", ".pw-live-card-header", ".pw-live-resize", ".pw-live-answer-meta button", ".pw-live-answer-text a", ".pw-live-bottom-actions button"]) {
    assert.ok($(selector).length > 0, `${selector} exists in the production render`);
    for (const element of $(selector).toArray()) assert.ok($(element).is("[data-overlay-interactive]"), `${selector} is an explicit interactive region`);
  }
});

test("committed content and scroll changes refresh stationary-pointer ownership without a pointermove", async () => {
  const h = await clientWorkspace(snapshot({ captureStatus: "ended", answers: [{ id: "stationary", question: "q", text: "response", status: "completed", createdAt: 1, screenshotCount: 0 }] }));
  try {
    const control = new h.ElementBoundary(true);
    h.setPoint(control); h.pointerMove(control);
    assert.equal(h.interactions.at(-1), true);
    h.setPoint(null); h.render();
    assert.equal(h.interactions.at(-1), false, "a control removed or displaced beneath the cursor cannot retain native ownership");
    h.setPoint(control); h.render();
    assert.equal(h.interactions.at(-1), true, "a newly opened control beneath a stationary cursor is clickable");
    const scroll = h.by(node => node.props.className === "pw-live-scroll");
    h.setPoint(null);
    scroll.props.onScroll({ currentTarget: { scrollHeight: 1000, scrollTop: 100, clientHeight: 300 } });
    assert.equal(h.interactions.at(-1), false, "scrolling a control away releases ownership before another pointermove");
  } finally { h.dispose(); }
});

test("closing an editable overlay surface releases native focus even when the DOM removal emitted no focusout", async () => {
  const focuses = [];
  const h = await clientWorkspace(snapshot(), { async setOverlayFocus(value) { focuses.push(value); } });
  try {
    const field = new h.ElementBoundary(true, true);
    h.focusIn(field);
    assert.equal(focuses.at(-1), true);
    field.isConnected = false;
    h.render();
    assert.equal(focuses.at(-1), false);
    const count = focuses.length;
    h.render();
    assert.equal(focuses.length, count, "the disposed field focus lease is released once");
  } finally { h.dispose(); }
});

test("advanced settings have one editor owner across stale hover/click/keyboard entries and Back", async () => {
  const h = await clientWorkspace(snapshot());
  const popover = () => h.by(node => typeof node.type === "function" && node.type.name === "LiveSettingsPopover");
  const advanced = () => h.by(node => typeof node.type === "function" && node.type.name === "AISettings");
  try {
    const staleClick = h.label("Settings / 设置").props.onClick;
    const staleKeyboard = h.label("Settings / 设置").props.onKeyDown;
    const staleHover = h.by(node => node.props.className === "pw-live-settings-anchor").props.onPointerEnter;
    staleClick();
    const first = popover();
    assert.equal(first.props.returnFocusRef, h.label("Settings / 设置").ref);
    first.props.onOpenAdvanced();
    // Before a new render, these closures still captured panel=null/open=false.
    staleClick(); staleHover(); staleKeyboard({ key: "ArrowDown", preventDefault() {}, stopPropagation() {} });
    assert.ok(advanced()); assert.equal(popover(), undefined);
    assert.equal(h.label("Settings / 设置").props["aria-expanded"], false);
    assert.equal(h.label("Settings / 设置").props["aria-disabled"], true);
    h.textButton("Back").props.onClick();
    assert.equal(advanced(), undefined); assert.equal(popover(), undefined, "Back must not revive an older compact open intent");
    h.label("Settings / 设置").props.onClick();
    assert.ok(popover()); assert.equal(advanced(), undefined);
  } finally { h.dispose(); }
});

test("workspace owns pending output and speech writes across popover close/reopen before admitting an advanced editor", async () => {
  for (const method of ["saveAiSettings", "saveTranscriptionSettings"]) {
    const pending = pendingResult(); let saves = 0;
    const h = await clientWorkspace(snapshot(), { [method]() { saves++; return pending.promise; } });
    const popover = () => h.by(node => typeof node.type === "function" && node.type.name === "LiveSettingsPopover");
    const advanced = () => h.by(node => typeof node.type === "function" && node.type.name === "AISettings");
    try {
      h.label("Settings / 设置").props.onClick(); const first = popover();
      const writing = first.props.runSettingsWrite(() => h.api[method]({}));
      assert.equal(saves, 1); assert.equal(popover().props.writeBusy, true);
      first.props.onOpenAdvanced(); assert.equal(advanced(), undefined);
      await assert.rejects(first.props.runSettingsWrite(() => { throw new Error("second write must not be entered"); }), /已有设置/);
      first.props.onClose(); assert.equal(popover(), undefined);
      h.by(node => node.props.className === "pw-live-settings-anchor").props.onPointerEnter();
      assert.equal(popover().props.writeBusy, true, "closing the original component cannot release a native write");
      first.props.onOpenAdvanced(); popover().props.onOpenAdvanced(); assert.equal(advanced(), undefined);
      pending.resolve({ success: true }); await writing; await h.tick();
      assert.equal(popover().props.writeBusy, false);
      popover().props.onOpenAdvanced(); assert.ok(advanced()); assert.equal(popover(), undefined);
    } finally { h.dispose(); }
  }
});

test("advanced Save, Speech Save and Clear key retain the same workspace gate after Back and reject stale editor writes", async () => {
  for (const method of ["saveAiSettings", "saveTranscriptionSettings", "clearApiKey"]) {
    const pending = pendingResult(); let saves = 0;
    const h = await clientWorkspace(snapshot(), { [method]() { saves++; return pending.promise; } });
    const popover = () => h.by(node => typeof node.type === "function" && node.type.name === "LiveSettingsPopover");
    const advanced = () => h.by(node => typeof node.type === "function" && node.type.name === "AISettings");
    try {
      h.label("Settings / 设置").props.onClick(); const compactRunner = popover().props.runSettingsWrite;
      popover().props.onOpenAdvanced();
      const advancedRunner = advanced().props.runSettingsWrite;
      assert.equal(typeof advancedRunner, "function", "the production advanced panel must receive the workspace gate");
      await assert.rejects(compactRunner(() => { throw new Error("stale compact operation must not execute"); }), /已有设置/);
      const writing = advancedRunner(() => h.api[method]({}));
      assert.equal(saves, 1);
      assert.notEqual(h.textButton("Back").props.disabled, true, "leaving a pending advanced panel remains allowed");
      h.textButton("Back").props.onClick(); assert.equal(advanced(), undefined);
      h.label("Settings / 设置").props.onClick();
      assert.equal(popover().props.writeBusy, true, "the advanced component's removal cannot release its write");
      await assert.rejects(popover().props.runSettingsWrite(() => { throw new Error("overlapping write must not execute"); }), /已有设置/);
      pending.resolve({ success: true }); await writing; await h.tick();
      assert.equal(popover().props.writeBusy, false);
      await assert.rejects(advancedRunner(() => { throw new Error("stale advanced operation must not execute"); }), /已有设置/);
      assert.equal(await popover().props.runSettingsWrite(async () => "compact write allowed"), "compact write allowed");
    } finally { h.dispose(); }
  }
});

test("dialog button clicks keep native keyboard ownership for Escape; hover stays passive and removal releases it", async () => {
  const focuses = [];
  const h = await clientWorkspace(snapshot(), { async setOverlayFocus(value) { focuses.push(value); } });
  try {
    h.by(node => node.props.className === "pw-live-settings-anchor").props.onPointerEnter();
    assert.equal(focuses.some(Boolean), false, "hovering a settings icon must not steal the foreground app's keyboard");
    const button = new h.ElementBoundary(true, false, true);
    let focusCalls = 0;
    button.focus = () => { focusCalls++; document.activeElement = button; h.focusIn(button); };
    h.render().props.onClickCapture({ target: button }); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(focusCalls, 1, "a direct dialog-button click deliberately focuses that control on macOS");
    assert.equal(focuses.at(-1), true, "the post-click policy must keep Escape reachable from a mode button");
    button.isConnected = false; document.activeElement = null;
    h.render(); assert.equal(focuses.at(-1), false, "removing the dialog returns its native keyboard lease");
    const before = focuses.length; h.render(); assert.equal(focuses.length, before);
    assert.equal(h.interactions.at(-1), false, "keyboard focus does not claim pass-through card/body mouse input");
  } finally { h.dispose(); }
});


test("an owned native select keeps an unknown focus transfer but releases on known exit, removal and hide", async () => {
  const focuses = [];
  const h = await clientWorkspace(snapshot(), { async setOverlayFocus(value) { focuses.push(value); } });
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    const select = new h.ElementBoundary(true, true, true); select.tagName = "SELECT";
    const outside = new h.ElementBoundary(false); outside.tagName = "BODY";
    document.activeElement = select; h.focusIn(select); assert.equal(focuses.at(-1), true);
    document.activeElement = outside;
    const before = focuses.length;
    h.focusOut(select, null); await tick();
    assert.equal(focuses.length, before, "a native popup's unknown DOM destination must send neither focus nor blur");
    h.label("Settings / 设置").props.onClick();
    const anchor = h.by(node => node.props.className === "pw-live-settings-anchor");
    anchor.ref.current = { contains: node => node === select };
    const originalSetTimeout = globalThis.setTimeout; let dismiss;
    try {
      globalThis.setTimeout = (callback, delay, ...args) => delay === 500 ? (dismiss = callback, {}) : originalSetTimeout(callback, delay, ...args);
      anchor.props.onPointerLeave();
    } finally { globalThis.setTimeout = originalSetTimeout; }
    dismiss();
    assert.ok(h.by(node => node.type?.name === "LiveSettingsPopover"), "the hover timer must consume the retained keyboard owner instead of dismissing its native popup");
    select.isConnected = false; h.render();
    assert.equal(focuses.at(-1), false, "the retained lease must still be owned and released if its select is removed");
    const select2 = new h.ElementBoundary(true, true, true); select2.tagName = "SELECT";
    document.activeElement = select2; h.focusIn(select2);
    document.activeElement = outside; h.focusOut(select2, outside); await tick();
    assert.equal(focuses.at(-1), false, "a known DOM transfer outside the overlay still releases focus");
    document.activeElement = select2; h.focusIn(select2);
    document.activeElement = outside; h.focusOut(select2, null); await tick();
    assert.equal(focuses.at(-1), true);
    h.visibilityChanged(false); assert.equal(focuses.at(-1), false, "an explicit native hide releases even a connected select");
    const hiddenCount = focuses.length;
    select2.isConnected = false; h.render(); await tick();
    assert.equal(focuses.length, hiddenCount, "hide clears the lease and pending focus work rather than leaving a stale owner");
  } finally { h.dispose(); }
});
