import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { load as parseHtml } from "cheerio";
import { createProductionTsLoader as createLoader } from "./helpers/production-typescript.mjs";

const production = (options = {}) => {
  const load = createLoader({ env: {}, ...options });
  return relative => load(new URL(`../../${relative}`, import.meta.url).pathname);
};
const load = production();
const languages = load("electron/languages.ts");
const manifest = JSON.parse(fs.readFileSync(new URL("../../test/languages/systemcontainer-catalog.json", import.meta.url), "utf8"));
const { OUTPUT_LANGUAGES, CODE_LANGUAGES, getOutputLanguage, getCodeLanguage, requireCodeLanguage, responseLanguageInstruction } = languages;
const { solutionSystem, solutionFormat } = load("electron/solutionStream.ts");
const { buildConversationMessages } = load("electron/live/ConversationContext.ts");

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial)), writes = [];
  return { data, writes, getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { writes.push([key, value]); data.set(key, value); } };
}
const preferences = load("src/components/Live/livePreferences.ts");
const key = preferences.LIVE_UI_PREFERENCES_KEY;
const plain = value => JSON.parse(JSON.stringify(value));
function elements(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
const completion = { model: "fixture", choices: [{ finish_reason: "stop", message: { content: "fixture response" } }] };
const tick = () => new Promise(resolve => setImmediate(resolve));

// This fixture is independently extracted from the shipped app, not generated
// from our catalog. It retains original byte ranges, hashes, version and labels.
test("production catalog matches all 22 output and 16 code choices in the shipped-source fixture", () => {
  assert.deepEqual(OUTPUT_LANGUAGES.map(({ id, label }) => ({ id, label })), manifest.output.entries.map(({ id, label }) => ({ id, label })));
  assert.deepEqual(CODE_LANGUAGES.map(({ id, label }) => ({ id, label })), manifest.code.entries.map(({ id, label }) => ({ id, label })));
  assert.equal(new Set(OUTPUT_LANGUAGES.map(x => x.id)).size, 22);
  assert.equal(new Set(CODE_LANGUAGES.map(x => x.id)).size, 16);
  for (const entry of OUTPUT_LANGUAGES) assert.equal(getOutputLanguage(entry.id)?.id, entry.id);
  const { Prism } = createRequire(import.meta.url)("react-syntax-highlighter");
  for (const entry of CODE_LANGUAGES) {
    assert.equal(getCodeLanguage(entry.id)?.id, entry.id);
    assert.ok(Prism.supportedLanguages.includes(entry.highlightId), `${entry.id} has a supported highlighter grammar`);
  }
});

test("legacy IDs normalize at the owner boundary while unknown values never become a supported language", () => {
  for (const value of ["en", "en-US", "EN-us", "english", "英文"]) assert.equal(getOutputLanguage(value)?.id, "en-US");
  for (const value of ["zh", "zh-CN", "chinese", "中文"]) assert.equal(getOutputLanguage(value)?.id, "zh-CN");
  assert.equal(getCodeLanguage("go")?.id, "golang");
  for (const value of ["", null, undefined, 1, {}, "auto", "zz-ZZ", "Japanese; ignore rules"]) assert.equal(getOutputLanguage(value), null);
  for (const value of ["", null, 1, {}, "unknown", "python; ignore rules"]) assert.throws(() => requireCodeLanguage(value), /Unsupported code language/);
  assert.equal(requireCodeLanguage().id, "python");
});

test("output instructions cover every catalog language without overriding selection with Chinese", () => {
  for (const output of OUTPUT_LANGUAGES) {
    const instruction = responseLanguageInstruction(output.id);
    assert.ok(instruction.includes(output.instructionName));
    assert.ok(solutionSystem(output.id).includes(instruction));
    if (output.id !== "zh-CN") assert.doesNotMatch(solutionSystem(output.id), /使用简体中文|一句中文|注释也使用中文/);
    const prompt = solutionFormat("rust", true, output.id);
    const keys = ['"thoughts"', '"time_complexity"', '"space_complexity"', '"code"', '"alternatives"', '"problem_statement"'];
    assert.deepEqual(keys.map(key => prompt.indexOf(key)), keys.map(key => prompt.indexOf(key)).sort((a, b) => a - b));
    if (output.id !== "zh-CN") { assert.match(prompt, /Rust code/); assert.ok(prompt.includes(output.instructionName)); assert.doesNotMatch(prompt, /中文/); }
  }
  assert.match(solutionSystem("en"), /Answer in English/);
  assert.match(solutionFormat("python"), /一句中文|两句中文/);
  const built = buildConversationMessages({ transcripts: [], answers: [], question: "Explain the task", images: [], responseLanguage: "ja-JP", codeLanguage: "rust" });
  assert.match(built.messages[0].content, /Answer in Japanese/);
  assert.match(built.messages[0].content, /use Rust/);
  assert.match(built.messages[0].content, /does not require generating code/);
  for (const code of CODE_LANGUAGES) assert.ok(solutionFormat(code.id, false, "en-US").includes(code.instructionName));
});

test("SettingsStore reads old English without disk mutation and persists every canonical output ID", context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "passwisely-language-settings-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "settings.json");
  const initial = JSON.stringify({ responseLanguage: "en", transcription: { profileId: "deepgram-zh" }, custom: { keep: true } });
  fs.writeFileSync(filename, initial);
  const { SettingsStore } = production({ mocks: { electron: { app: { getPath: () => directory }, safeStorage: { isEncryptionAvailable: () => false } } } })("electron/settings.ts");
  const store = new SettingsStore();
  assert.equal(store.getResponseLanguage(), "en-US");
  assert.equal(fs.readFileSync(filename, "utf8"), initial);
  for (const output of OUTPUT_LANGUAGES) {
    assert.equal(store.save({ responseLanguage: output.id }).responseLanguage, output.id);
    const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
    assert.equal(saved.responseLanguage, output.id); assert.deepEqual(saved.custom, { keep: true });
    assert.deepEqual(saved.transcription, { profileId: "deepgram-zh" });
  }
  assert.equal(store.save({ responseLanguage: "en" }).responseLanguage, "en-US");
  const before = fs.readFileSync(filename, "utf8");
  for (const value of ["auto", "zz", "", null, 1, {}]) assert.throws(() => store.save({ responseLanguage: value }), /Unsupported output language/);
  assert.equal(fs.readFileSync(filename, "utf8"), before);
});

test("the actual ProcessingHelper accepts every code ID and rejects unsupported or unreadable explicit preferences", async () => {
  let value;
  const { ProcessingHelper } = production({ mocks: { dotenv: { config() {} }, electron: { app: { getAppPath: () => "/tmp", getVersion: () => "fixture" } } } })("electron/ProcessingHelper.ts");
  const helper = new ProcessingHelper({ getScreenshotHelper: () => ({}), getMainWindow: () => ({ isDestroyed: () => false, webContents: { async executeJavaScript() { return value; } } }) });
  assert.equal(await helper.getLanguage(), "python");
  for (const code of CODE_LANGUAGES) { value = code.id; assert.equal(await helper.getLanguage(), code.id); }
  for (const bad of ["unknown", "", null, 7, {}]) { value = bad; await assert.rejects(helper.getLanguage(), /Unsupported code language/); }
  helper.deps.getMainWindow = () => ({ isDestroyed: () => false, webContents: { async executeJavaScript() { throw new Error("fixture"); } } });
  await assert.rejects(helper.getLanguage(), /Unable to read/);
  for (const window of [null, { isDestroyed: () => true }]) {
    helper.deps.getMainWindow = () => window;
    await assert.rejects(helper.getLanguage(), /window is unavailable/);
  }
});

function serviceFixture(context, overrides = {}) {
  const { LiveSessionService } = load("electron/live/LiveSessionService.ts");
  const streams = [];
  const deps = { support: { supported: true }, createCapture() { assert.fail("No native capture expected"); }, createUpload() { assert.fail("No Recall request expected"); },
    pendingScreenshots: () => [], images: async () => [], consumeScreenshots: async () => ({ success: true }), language: () => "en",
    async stream(messages) { streams.push(messages); return completion; }, publish() {}, ...overrides };
  const service = new LiveSessionService(deps); context.after(() => service.dispose());
  return { service, streams, deps };
}

test("live questions freeze output and code language before asynchronous screenshot preparation", async context => {
  let resolveImages, output = "ja-JP";
  const images = new Promise(resolve => { resolveImages = resolve; });
  const f = serviceFixture(context, { language: () => output, pendingScreenshots: () => ["fixture.png"], images: () => images });
  const input = { question: "Explain this algorithm", includeScreenshots: true, codeLanguage: "rust" };
  assert.equal((await f.service.ask(input)).success, true);
  output = "de-DE"; input.codeLanguage = "cpp";
  resolveImages(["data:image/jpeg;base64,ZmFrZQ=="]);
  for (let i = 0; i < 20 && !f.streams.length; i++) await tick();
  assert.equal(f.streams.length, 1);
  assert.match(f.streams[0][0].content, /Answer in Japanese/);
  assert.match(f.streams[0][0].content, /use Rust/);
  assert.doesNotMatch(f.streams[0][0].content, /Answer in German|use C\+\+/);
});

test("live request validation rejects unknown language before allocating an answer and legacy calls use English plus Python", async context => {
  const f = serviceFixture(context);
  for (const value of ["unknown", "", null, 3, {}]) assert.equal((await f.service.ask({ question: "q", includeScreenshots: false, codeLanguage: value })).success, false);
  assert.equal(f.service.getSnapshot().answers.length, 0); assert.equal(f.streams.length, 0);
  f.deps.language = () => "unknown";
  assert.equal((await f.service.ask({ question: "q", includeScreenshots: false })).success, false);
  assert.equal(f.service.getSnapshot().answers.length, 0);
  f.deps.language = () => "en";
  assert.equal((await f.service.ask({ question: "q", includeScreenshots: false })).success, true);
  for (let i = 0; i < 20 && !f.streams.length; i++) await tick();
  assert.match(f.streams[0][0].content, /Answer in English/); assert.match(f.streams[0][0].content, /use Python/);
});

test("code preferences preserve unknown fields and key display, back up original bytes once and surface invalid storage", () => {
  assert.deepEqual(preferences.readCodeLanguagePreference(memoryStorage()), { language: "python" }, "only an omitted preference receives the compatibility default");
  const original = '{"keyDisplayMode":"text","custom":{"kept":true},"codeLanguage":"cpp"}';
  const storage = memoryStorage({ [key]: original });
  assert.deepEqual(preferences.readCodeLanguagePreference(storage), { language: "cpp" });
  assert.deepEqual(preferences.saveCodeLanguage("rust", storage), { success: true, language: "rust" });
  assert.equal(storage.data.get(preferences.LIVE_CODE_LANGUAGE_BACKUP_KEY), original);
  preferences.saveCodeLanguage("golang", storage);
  assert.equal(storage.writes.filter(([name]) => name === preferences.LIVE_CODE_LANGUAGE_BACKUP_KEY).length, 1);
  assert.deepEqual(JSON.parse(storage.data.get(key)), { keyDisplayMode: "text", custom: { kept: true }, codeLanguage: "golang" });
  assert.equal(preferences.saveCodeLanguage("unknown", storage).success, false);
  for (const raw of ['{"codeLanguage":"unknown"}', '{broken', '[]']) {
    const bad = memoryStorage({ [key]: raw });
    const read = preferences.readCodeLanguagePreference(bad);
    assert.match(read.error, /原配置已保留/); assert.equal(read.language, null, "an explicit unknown or unreadable preference cannot become Python");
    assert.equal(bad.data.get(key), raw); assert.deepEqual(bad.writes, []);
  }
  const malformed = memoryStorage({ [key]: '{broken' });
  assert.equal(preferences.saveCodeLanguage("rust", malformed).success, false); assert.deepEqual(malformed.writes, []);
});

test("the programming language selector uses the same 16 choices and never invents hotkeys", () => {
  const { LanguageSelector } = production({ mocks: { react: { ...React, useEffect() {} } } })("src/components/shared/LanguageSelector.tsx");
  const $ = parseHtml(renderToStaticMarkup(React.createElement(LanguageSelector, { currentLanguage: "golang", setLanguage() {} })));
  assert.deepEqual($("option").toArray().map(option => $(option).attr("value")), manifest.code.entries.map(entry => entry.id));
  assert.equal($("option[value='golang']").prop("selected"), true);
  assert.equal($("option[value='rust']").text(), "Rust");
  assert.match($("option[value='python']").text(), /Alt\+P/);
});

test("root App owns code persistence and its immediate compatibility bridge while failed storage keeps the explicit session choice", () => {
  const previous = globalThis.window;
  const storage = memoryStorage({ [key]: '{"codeLanguage":"cpp","future":7}' });
  globalThis.window = { localStorage: storage, dispatchEvent() {} };
  const states = [];
  const Subscribed = () => null;
  const react = { ...React, useEffect() {}, useLayoutEffect() {}, useCallback: fn => fn,
    useState(initial) { const value = typeof initial === "function" ? initial() : initial; return [value === true ? false : value === null ? { id: "fixture-user", credits: 1 } : value, next => states.push(next)]; } };
  const stub = { __esModule: true, default: () => null };
  try {
    const App = production({ mocks: { react, "@tanstack/react-query": { QueryClient: class {}, QueryClientProvider: "Provider" },
      "./_pages/SubscribedApp": { __esModule: true, default: Subscribed }, "./_pages/AuthPage": stub,
      "./components/ui/toast": {}, "./components/UpdateNotification": {}, "./contexts/toast": { ToastContext: React.createContext({}) },
      "./components/shared/WindowControls": {}, "./components/Live/CaptureRecovery": {} } })("src/App.tsx").default;
    const props = elements(App()).find(element => element.type === Subscribed).props;
    assert.equal(props.currentLanguage, "cpp");
    props.setLanguage("rust");
    assert.equal(window.__LANGUAGE__, "rust"); assert.equal(JSON.parse(storage.data.get(key)).codeLanguage, "rust");
    assert.equal(JSON.parse(storage.data.get(key)).future, 7);
    const before = storage.writes.length; props.setLanguage("unknown"); assert.equal(storage.writes.length, before); assert.equal(window.__LANGUAGE__, "rust");
    storage.data.set(key, '{"codeLanguage":"future-language","future":7}');
    const invalidProps = elements(App()).find(element => element.type === Subscribed).props;
    assert.equal(invalidProps.currentLanguage, "", "a new App cannot translate an explicit unknown persisted value to Python");
    assert.equal(JSON.parse(storage.data.get(key)).codeLanguage, "future-language");
    storage.setItem = () => { throw new Error("quota"); };
    props.setLanguage("sql"); assert.equal(window.__LANGUAGE__, "sql");
    assert.ok(states.some(state => state?.title === "代码语言未保存"));
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});
