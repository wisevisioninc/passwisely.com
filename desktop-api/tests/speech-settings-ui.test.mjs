import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
function productionLoader(mocks = {}) {
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const filename = path.join(root, relative);
    const javascript = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    modules.set(relative, module.exports);
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
    modules.set(relative, module.exports);
    return module.exports;
  }
  return load;
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
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Hook-controller tests execute production component handlers and effects. They
// mock the native API and hook scheduling, not a second settings implementation.
// They do not establish native hit testing, rendering, permissions or ASR quality.
function controller(overrides = {}) {
  const previousWindow = globalThis.window;
  const states = [], refs = [], effects = [], dependencies = [], cleanups = [], calls = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, tree;
  const api = {
    async getTranscriptionSettings() { calls.push(["get"]); return { profileId: "recall-en" }; },
    async saveTranscriptionSettings(input) { calls.push(["save", input]); return { success: true, settings: input }; },
    openExternal(url) { calls.push(["open", url]); },
    ...overrides,
  };
  globalThis.window = { electronAPI: api };
  const react = { ...React,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useId: () => "speech-fixture-select",
    useEffect(effect, deps) {
      const index = effectIndex++;
      if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) {
        dependencies[index] = deps; effects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); });
      }
    },
  };
  const { SpeechSettings } = productionLoader({ react })("src/components/shared/SpeechSettings.tsx");
  const render = () => { stateIndex = refIndex = effectIndex = 0; tree = SpeechSettings(); return tree; };
  const nodes = () => elements(render());
  return {
    calls, api, render, nodes,
    select: () => nodes().find(node => node.type === "select"),
    save: () => nodes().find(node => node.type === "button" && /保存语音设置/.test(text(node))),
    message: () => nodes().filter(node => ["alert", "status"].includes(node.props.role)).map(text).join("\n"),
    async settle() { for (let i = 0; i < 4; i++) { render(); while (effects.length) effects.shift()(); await tick(); } render(); },
    cleanup() { for (const cleanup of cleanups) cleanup?.(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; },
  };
}

test("speech hook-controller keeps selection as a draft and saves independently for the next new session", async () => {
  const pending = deferred();
  const h = controller();
  h.api.saveTranscriptionSettings = input => { h.calls.push(["save", input]); return pending.promise; };
  try {
    await h.settle();
    assert.equal(h.select().props.value, "recall-en");
    assert.equal(h.save().props.disabled, true);
    h.select().props.onChange({ target: { value: "deepgram-zh" } });
    assert.deepEqual(h.calls, [["get"]]);
    assert.equal(h.select().props.value, "deepgram-zh");
    const save = h.save().props.onClick;
    save(); save(); await h.settle();
    assert.equal(h.select().props.disabled, true);
    assert.deepEqual(h.calls, [["get"], ["save", { profileId: "deepgram-zh" }]]);
    pending.resolve({ success: true, settings: { profileId: "deepgram-zh" } });
    await h.settle();
    assert.equal(h.select().props.value, "deepgram-zh");
    assert.match(h.message(), /下次新会话生效/);
    assert.match(h.message(), /当前采集和回答保持不变/);
    assert.equal(h.save().props.disabled, true);
  } finally { h.cleanup(); }
});

test("speech hook-controller exposes prerequisite help without a client key field or an automatic English fallback", async () => {
  const h = controller();
  try {
    await h.settle();
    h.select().props.onChange({ target: { value: "deepgram-zh" } });
    assert.equal(h.nodes().some(node => node.type === "input"), false);
    assert.match(text(h.render()), /Deepgram Key 和 Project ID/);
    assert.match(text(h.render()), /设为默认凭据/);
    assert.match(text(h.render()), /不承诺中英自动切换/);
    const link = h.nodes().find(node => node.type === "a");
    assert.equal(link.props.href, "https://ap-northeast-1.recall.ai/dashboard/transcription");
    let prevented = false;
    link.props.onClick({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(h.calls.at(-1), ["open", link.props.href]);
    for (const failure of [
      async () => ({ success: false, error: "Deepgram 凭据未配置" }),
      async () => { throw new Error("fixture native request failed"); },
      async () => ({ success: true, settings: { profileId: "recall-en" } }),
    ]) {
      h.api.saveTranscriptionSettings = failure;
      h.save().props.onClick(); await h.settle();
      assert.equal(h.select().props.value, "deepgram-zh");
      assert.ok(h.nodes().some(node => node.props.role === "alert"));
      assert.doesNotMatch(h.message(), /已保存/);
      assert.equal(h.save().props.disabled, false);
    }
    h.select().props.onChange({ target: { value: "recall-zh" } });
    assert.match(text(h.render()), /3–10 分钟/);
    assert.match(text(h.render()), /真实采集尚未验证/);
    assert.doesNotMatch(text(h.render()), /中文.*秒级/);
  } finally { h.cleanup(); }
});

test("speech hook-controller leaves unknown or failed loads unresolved until an explicit reload", async () => {
  const h = controller({ async getTranscriptionSettings() { throw new Error("fixture load failed"); } });
  try {
    await h.settle();
    assert.equal(h.select().props.value, "");
    assert.equal(h.select().props.disabled, true);
    assert.equal(h.save().props.disabled, true);
    assert.match(h.message(), /fixture load failed/);
    h.api.getTranscriptionSettings = async () => ({ profileId: "unsupported" });
    h.nodes().find(node => node.type === "button" && text(node) === "重新加载语音设置").props.onClick();
    await h.settle();
    assert.equal(h.select().props.value, "");
    assert.match(h.message(), /无法识别已保存的语音设置/);
    h.api.getTranscriptionSettings = async () => ({ profileId: "recall-zh" });
    h.nodes().find(node => node.type === "button" && text(node) === "重新加载语音设置").props.onClick();
    await h.settle();
    assert.equal(h.select().props.value, "recall-zh");
    assert.equal(h.save().props.disabled, true);
    assert.doesNotMatch(h.message(), /失败|无法/);
  } finally { h.cleanup(); }
});

test("AI settings keep the independent speech section mounted while AI settings are loading", () => {
  const load = productionLoader();
  const { AISettings } = load("src/components/shared/AISettings.tsx");
  const { ToastContext } = load("src/contexts/toast.tsx");
  const $ = parseHtml(renderToStaticMarkup(React.createElement(ToastContext.Provider, { value: { showToast() {} } }, React.createElement(AISettings))));
  assert.match($.text(), /Loading AI settings/);
  assert.equal($("section[aria-label='语音识别设置']").length, 1);
  assert.equal($("button").filter((_i, element) => $(element).text() === "保存语音设置").length, 1);
  assert.equal($("form").length, 0, "speech save must not submit the AI provider form");
});

test("live overlay describes saved speech settings generically and displays the frozen session profile", () => {
  const previousWindow = globalThis.window;
  const previousError = console.error;
  globalThis.window = { electronAPI: {} };
  console.error = (...args) => { if (!String(args[0]).startsWith("Warning: useLayoutEffect")) previousError(...args); };
  try {
    for (const transcription of [
      { id: "deepgram-zh", label: "中文 · Deepgram 实时", language: "zh", provider: "deepgram", latency: "realtime" },
      { id: "recall-zh", label: "中文 · Recall 内置（分钟级，实验）", language: "zh", provider: "recall", latency: "delayed" },
      { id: "recall-en", label: "English · Recall 实时", language: "en", provider: "recall", latency: "realtime" },
    ]) {
      let injected = false;
      const state = { sessionId: "frozen", revision: 1, provider: "recall-v2", captureStatus: "ended", transcripts: [{ id: "final", text: "保留本次转录。", source: "microphone", isFinal: true, receivedAt: 1 }], answers: [], transcriptTruncated: false, captureNeedsCleanup: false, platformSupported: true, transcription };
      const react = { ...React, useState(initial) { if (initial === null && !injected) { injected = true; return React.useState(state); } return React.useState(initial); } };
      const { default: Component } = productionLoader({ react,
        "../shared/AISettings": { AISettings: () => null },
        "../shared/ResumePanel": { ResumePanel: () => null },
        "./AnswerMarkdown": { AnswerMarkdown: () => null },
      })("src/components/Live/LiveWorkspace.tsx");
      const $ = parseHtml(renderToStaticMarkup(React.createElement(Component, { visible: true })));
      assert.match($(".pw-live-start").attr("title"), /按已保存的语音设置开始新会话/);
      assert.doesNotMatch($(".pw-live-start").attr("title"), /开始英文/);
      const metadata = $("[aria-label='本次语音识别']").text();
      assert.ok(metadata.includes(transcription.language === "zh" ? "中文" : "English"));
      assert.ok(metadata.includes(transcription.provider === "deepgram" ? "Deepgram" : "Recall"));
      assert.ok(metadata.includes(transcription.latency === "delayed" ? "分钟级（实验）" : "实时"));
    }
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; console.error = previousError; }
});
