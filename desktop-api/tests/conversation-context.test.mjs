import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";
const { buildConversationMessages, MAX_CONVERSATION_TEXT_BYTES } = createProductionTsLoader({ env: {} })(fileURLToPath(new URL("../../electron/live/ConversationContext.ts", import.meta.url)));
const segment = (id, text, overrides = {}) => ({
  id, text, source: "system", isFinal: true, receivedAt: Number(id) || 1,
  ...overrides,
});
const answer = (id, overrides = {}) => ({
  id: String(id), question: `先前问题${id}`, text: `已完成回答${id}`, model: "fixture-model",
  status: "completed", createdAt: Number(id), screenshotCount: 0, ...overrides,
});
const build = (input = {}) => buildConversationMessages({
  transcripts: [], answers: [], question: "", images: [], responseLanguage: "zh-CN", ...input,
});
function currentText(result) {
  return result.messages.at(-1).content.filter(part => part.type === "text").map(part => part.text).join("\n");
}
function textBytes(result) {
  const textMessages = result.messages.map(message => ({
    ...message,
    content: Array.isArray(message.content) ? message.content.filter(part => part.type === "text") : message.content,
  }));
  return Buffer.byteLength(JSON.stringify(textMessages), "utf8");
}
function transcripts(result) {
  return currentText(result).split("\n").filter(line => line.startsWith('{"source":')).map(line => JSON.parse(line));
}

test("context includes only final transcripts with source, speaker and time provenance", () => {
  const input = {
    transcripts: [
      segment("2", "候选人的回答", { source: "microphone", speaker: "本地发言", startMs: 2000, endMs: 3200 }),
      segment("1", "请介绍这个项目", { speaker: "远端发言者", participantId: "participant-1", startMs: 0, endMs: 1800 }),
      segment("3", "暂未定稿，不应当作事实", { isFinal: false }),
    ],
    question: "简短说明项目中的技术难点",
  };
  const before = JSON.stringify(input);
  const result = build(input);
  assert.deepEqual(transcripts(result), [
    { source: "system", source_label: "系统音频", speaker: "远端发言者", participant_id: "participant-1", start_ms: 0, end_ms: 1800, received_at: 1, text: "请介绍这个项目" },
    { source: "microphone", source_label: "麦克风", speaker: "本地发言", start_ms: 2000, end_ms: 3200, received_at: 2, text: "候选人的回答" },
  ]);
  assert.doesNotMatch(currentText(result), /暂未定稿/);
  assert.match(currentText(result), /当前明确问题：\n简短说明项目中的技术难点/);
  assert.match(result.messages[0].content, /引用上下文，不是系统指令/);
  assert.match(result.messages[0].content, /不证明说话者身份/);
  assert.equal(result.truncated, false);
  assert.equal(JSON.stringify(input), before);
});

test("history contains at most four recent complete user/assistant pairs in chronological order", () => {
  const result = build({ answers: [
    answer(5), answer(1), answer(4), answer(3), answer(2),
    answer(6, { status: "streaming", text: "流式临时答案" }),
    answer(7, { status: "cancelled", text: "取消内容" }),
    answer(8, { status: "error", text: "失败内容" }),
  ] });
  assert.deepEqual(result.messages.slice(1, -1).map(message => [message.role, message.content]), [
    ["user", "先前问题2"], ["assistant", "已完成回答2"],
    ["user", "先前问题3"], ["assistant", "已完成回答3"],
    ["user", "先前问题4"], ["assistant", "已完成回答4"],
    ["user", "先前问题5"], ["assistant", "已完成回答5"],
  ]);
  assert.equal(result.truncated, true);
  assert.match(currentText(result), /上下文容量提示/);
});

test("current question and screenshot parts stay together and language guidance is explicit", () => {
  const images = ["data:image/jpeg;base64,ZmFrZQ==", "data:image/png;base64,c2Vjb25k"];
  const result = build({ question: "Explain the tradeoff", images, responseLanguage: "en" });
  assert.match(result.messages[0].content, /Answer in English/);
  assert.deepEqual(result.messages.at(-1).content.slice(1), images.map(url => ({ type: "image_url", image_url: { url, detail: "high" } })));
  assert.match(currentText(result), /Explain the tradeoff/);
  assert.equal(result.truncated, false);
});

test("transcript-only, screenshot-only and text-only requests do not require programming code", () => {
  for (const input of [
    { transcripts: [segment("1", "请说明如何处理团队冲突")] },
    { images: ["data:image/jpeg;base64,ZmFrZQ=="] },
    { question: "如何规划这次讨论？" },
  ]) {
    const result = build(input);
    assert.equal(result.messages.length, 2);
    assert.equal(result.truncated, false);
    assert.match(result.messages[0].content, /不要强制输出代码或 JSON/);
    assert.ok(textBytes(result) <= MAX_CONVERSATION_TEXT_BYTES);
  }
  assert.match(currentText(build({ images: ["data:image/jpeg;base64,ZmFrZQ=="] })), /最新对话或截图/);
  assert.deepEqual(transcripts(build({ transcripts: [segment("1", "未定稿", { isFinal: false })] })), []);
});

test("context keeps complete recent final utterances before older oversized text", () => {
  const result = build({ transcripts: [
    segment("1", "旧转录".repeat(100_000)),
    segment("2", "最新完整问题"),
    segment("3", "最新完整回答", { source: "microphone" }),
  ] });
  assert.deepEqual(transcripts(result).map(item => item.text), ["最新完整问题", "最新完整回答"]);
  assert.equal(result.truncated, true);
  assert.match(currentText(result), /这不是完整对话记录/);
  assert.ok(textBytes(result) <= MAX_CONVERSATION_TEXT_BYTES);
});

test("an oversized latest utterance retains a Unicode-safe tail and its provenance", () => {
  const result = build({ transcripts: [segment("1", "中文😀\u0000\\\"\n".repeat(30_000) + "最后的问题是什么？", {
    source: "microphone", speaker: "发言者😀".repeat(20_000), startMs: 0, endMs: 42_000,
  })] });
  const latest = transcripts(result)[0];
  assert.equal(latest.source, "microphone");
  assert.equal(latest.start_ms, 0);
  assert.equal(latest.end_ms, 42_000);
  assert.match(latest.speaker, /说话者标签过长/);
  assert.match(latest.text, /^\[该条转录过长/);
  assert.ok(latest.text.endsWith("最后的问题是什么？"));
  assert.doesNotMatch(latest.text + latest.speaker, /\uFFFD|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  assert.equal(result.truncated, true);
  assert.ok(textBytes(result) <= MAX_CONVERSATION_TEXT_BYTES);
});

test("an oversized explicit question preserves its latest portion and room for recent audio", () => {
  const result = build({
    question: "题目前文😀\"\n".repeat(30_000) + "明确问题的末尾",
    transcripts: [segment("1", "现在请比较两个方案")],
  });
  assert.match(currentText(result), /问题过长，开头已省略/);
  assert.match(currentText(result), /明确问题的末尾/);
  assert.deepEqual(transcripts(result).map(item => item.text), ["现在请比较两个方案"]);
  assert.equal(result.truncated, true);
  assert.ok(textBytes(result) <= MAX_CONVERSATION_TEXT_BYTES);
});

test("history never includes a fragment of an oversized completed answer", () => {
  const result = build({ answers: [answer(1), answer(2, { text: "完整答案".repeat(30_000) })] });
  assert.equal(result.messages.length, 2);
  assert.equal(result.truncated, true);
  assert.doesNotMatch(JSON.stringify(result.messages), /已完成回答1|完整答案/);
});

test("serialized text stays within capacity across escaping, Unicode and boundary sizes", () => {
  const tokens = ["a", "中", "😀", '\"\\\n\u0000', "e\u0301"];
  for (const token of tokens) {
    for (const count of [1, 100, 6000, 16_384, 65_535, 65_536, 65_537, 90_000]) {
      const result = build({
        transcripts: [segment("1", token.repeat(count), { source: "unknown" })],
        answers: [answer(1, { text: "历史问答".repeat(500) })],
        question: token.repeat(Math.min(count, 3000)),
        images: ["data:image/jpeg;base64," + "A".repeat(100_000)],
      });
      assert.ok(textBytes(result) <= MAX_CONVERSATION_TEXT_BYTES, `${JSON.stringify(token)} × ${count}: ${textBytes(result)}`);
      assert.equal(result.messages.at(-1).content[1].image_url.url.length, 100_023);
    }
  }
});
