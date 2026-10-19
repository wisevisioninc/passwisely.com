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
    assert.equal($("textarea[aria-label='会话提问']").val(), "");
    assert.equal(startCalls, 0);
    assert.equal(askCalls, 0);
  }
});

test("sending requires usable context; partial ASR alone is not final context", () => {
  const segment = { id: "fixture-segment", source: "unknown", text: "一句待确认的语音", receivedAt: 1, isFinal: false };
  for (const transcripts of [[], [segment]]) {
    const { dom: $ } = renderWorkspace(snapshot({ transcripts }));
    assert.equal($("button[aria-label='发送问题']").prop("disabled"), true);
  }
  const { dom: $ } = renderWorkspace(snapshot({ transcripts: [{ ...segment, isFinal: true }] }));
  assert.equal($("button[aria-label='发送问题']").prop("disabled"), false);
  assert.ok($(".pw-live-segment-meta").text().includes("来源未知"));
});

test("recording consent disclosure is present before capture and generation has its own stop", () => {
  const { dom: $ } = renderWorkspace(snapshot());
  const disclosure = $(".pw-live-audio-notice").text();
  assert.ok(disclosure.includes("发送并保存"));
  assert.ok(disclosure.includes("你的 Recall 项目"));
  assert.ok(disclosure.includes("点击“开始会话”后才开始采集"));
  const answer = { id: "fixture-answer", question: "上下文是什么？", text: "已收到的部分回答", model: "fixture-model", status: "streaming", createdAt: 1, screenshotCount: 0 };
  const { dom: active } = renderWorkspace(snapshot({ captureStatus: "recording", answers: [answer] }));
  const stopAnswer = active(".pw-live-composer-actions button.stop");
  assert.equal(stopAnswer.length, 1);
  assert.equal(stopAnswer.prop("disabled"), false);
  assert.ok(active(".pw-live-answer-text").text().includes(answer.text));
  assert.equal(active("button[aria-label='发送问题']").length, 0);
});

test("ending keeps session text visible and a new session discloses its clearing boundary", () => {
  const transcript = { id: "ended-segment", source: "system", text: "保留的转录", receivedAt: 1, isFinal: true };
  const answer = { id: "ended-answer", question: "保留的问题", text: "保留的回答", model: "fixture-model", status: "completed", createdAt: 1, screenshotCount: 0 };
  const { dom: $ } = renderWorkspace(snapshot({ captureStatus: "ended", transcripts: [transcript], answers: [answer] }));
  assert.ok($(".pw-live-segment").text().includes(transcript.text));
  assert.ok($(".pw-live-answer-text").text().includes(answer.text));
  assert.equal($("button[title='开始新会话将清空当前转录和回答']").length, 1);
  assert.ok($(".pw-live-audio-notice").text().includes("开始新会话会清空"));
  assert.equal($("button[aria-label='发送问题']").prop("disabled"), false);
});

function elements(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
const elementText = node => typeof node === "string" ? node : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(elementText).join("") : "";

test("only starting a session changes the current answer tab; pause, resume and end preserve it", async () => {
  const previousWindow = globalThis.window;
  try {
    for (const [captureStatus, label, method] of [["ended", "新会话", "liveStart"], ["recording", "暂停", "livePause"], ["paused", "继续", "liveResume"], ["recording", "结束", "liveStop"]]) {
      const tabs = [], panels = [];
      let nullable = 0, calls = 0;
      const react = {
        ...React, useState(initial) {
          if (initial === null) return [nullable++ === 0 ? snapshot({ captureStatus, captureNeedsCleanup: captureStatus !== "ended" }) : null, value => panels.push(value)];
          if (initial === "transcript") return ["answers", value => tabs.push(value)];
          return [initial, () => {}];
        }, useRef: initial => ({ current: initial }), useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
      };
      globalThis.window = { electronAPI: { [method]: async () => { calls++; return { success: true }; } } };
      const Component = production(undefined, react).default;
      const tree = Component({ visible: true });
      const button = elements(tree).find(node => node.type === "button" && elementText(node) === label);
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
