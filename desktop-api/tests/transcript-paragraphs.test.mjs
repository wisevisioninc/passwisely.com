import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const modules = new Map();
function production(name) {
  if (modules.has(name)) return modules.get(name);
  const filename = path.join(root, "electron/live", `${name}.ts`);
  const javascript = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", javascript)(id => id.startsWith(".") ? production(path.join(path.dirname(name), id)) : require(id), module, module.exports);
  modules.set(name, module.exports);
  return module.exports;
}
const { projectTranscriptParagraphs: project, PARAGRAPH_GAP_MS, PARAGRAPH_CHARACTERS } = production("TranscriptParagraphs");
const { createRecallTranscriptNormalizer } = production("recallTranscript");
function channelIdFor(source, participantId, speaker) {
  return createRecallTranscriptNormalizer().normalize({ event: "transcript.data", data: { source, data: {
    participant: { id: participantId, name: speaker }, words: [{ text: "synthetic channel identity" }],
  } } }).channelId;
}

const fixtures = JSON.parse(readFileSync(new URL("../../test/audio/recall-chinese/paragraphs.synthetic.json", import.meta.url), "utf8"));

for (const fixture of fixtures.cases) test(`synthetic paragraph replay: ${fixture.id}`, () => {
  const before = JSON.stringify(fixture);
  for (const [index, snapshot] of fixture.snapshots.entries()) {
    const output = project(snapshot);
    assert.deepEqual(output.map(row => row.memberIds), fixture.expectedMemberIds[index]);
    if (fixture.expectedTexts) assert.deepEqual(output.map(row => row.text), fixture.expectedTexts[index]);
    if (fixture.expectedFinal) assert.deepEqual(output.map(row => row.isFinal), fixture.expectedFinal[index]);
    // Every raw row is represented once, in original order, without rewriting IDs.
    assert.deepEqual(output.flatMap(row => row.memberIds), snapshot.map(row => row.id));
    for (const row of output) {
      const members = snapshot.filter(segment => row.memberIds.includes(segment.id));
      assert.equal(row.source, members[0].source);
      assert.equal(row.startMs, members[0].startMs);
      assert.equal(row.endMs, members.at(-1).endMs);
    }
  }
  assert.equal(JSON.stringify(fixture), before, "display projection must not mutate raw segments");
});

test("paragraph policy has inclusive time/character boundaries and never splits a raw segment", () => {
  assert.equal(PARAGRAPH_GAP_MS, 2500);
  assert.equal(PARAGRAPH_CHARACTERS, 100);
  const segment = (id, text, startMs, endMs) => ({ id, text, source: "microphone", participantId: "local", channelId: channelIdFor("microphone", "local"), captureEpoch: 0, isFinal: true, receivedAt: startMs, startMs, endMs });
  const a = segment("a", "中".repeat(99), 0, 500);
  const b = segment("b", "文", 3000, 3500);
  assert.deepEqual(project([a, b]).map(row => row.memberIds), [["a", "b"]]);
  assert.deepEqual(project([a, { ...b, startMs: 3001 }]).map(row => row.memberIds), [["a"], ["b"]]);
  assert.deepEqual(project([a, { ...b, text: "文本" }]).map(row => row.memberIds), [["a"], ["b"]]);
  const oversized = segment("long", "🙂".repeat(101), 0, 10000);
  assert.equal(project([oversized])[0].text, oversized.text);
  assert.deepEqual(project([oversized, segment("next", "后续", 10001, 11000)]).map(row => row.memberIds), [["long"], ["next"]]);
});

test("different explicit participants, source and capture epoch always form distinct paragraphs", () => {
  const a = { id: "a", text: "先看输入", source: "system", participantId: "remote-1", speaker: "Guest", channelId: channelIdFor("system", "remote-1", "Guest"), captureEpoch: 0, isFinal: true, receivedAt: 1000, startMs: 0, endMs: 500 };
  for (const overrides of [{ participantId: "remote-2" }, { participantId: undefined }, { source: "microphone" }, { captureEpoch: 1 }]) {
    const b = { ...a, id: "b", text: "再看输出", receivedAt: 2000, startMs: 600, endMs: 1500, ...overrides };
    b.channelId = channelIdFor(b.source, b.participantId, b.speaker);
    assert.deepEqual(project([a, b]).map(row => row.memberIds), [["a"], ["b"]]);
  }
});


test("display-name truncation cannot merge distinct owner channels without participant IDs", () => {
  const normalizer = createRecallTranscriptNormalizer();
  const prefix = "same-prefix-".repeat(12);
  const event = (name, start) => ({ event: "transcript.data", data: { source: "system", data: { participant: { name }, words: [{ text: "fragment", start_timestamp: { relative: start }, end_timestamp: { relative: start + 0.4 } }] } } });
  const a = normalizer.normalize(event(prefix + "ALICE", 0), 1000);
  const b = normalizer.normalize(event(prefix + "BOB", 0.5), 2000);
  assert.equal(a.speaker, b.speaker);
  assert.notEqual(a.channelId, b.channelId);
  assert.deepEqual(project([a, b]).map(row => row.memberIds), [[a.id], [b.id]]);
});

test("shortened participant encoding cannot merge an unrelated literal participant ID", () => {
  const normalizer = createRecallTranscriptNormalizer();
  const event = (id, start) => ({ event: "transcript.data", data: { source: "system", data: { participant: { id, name: "Guest" }, words: [{ text: "fragment", start_timestamp: { relative: start }, end_timestamp: { relative: start + 0.4 } }] } } });
  const a = normalizer.normalize(event("x".repeat(201), 0), 1000);
  const b = normalizer.normalize(event(a.participantId, 0.5), 2000);
  assert.equal(a.participantId, b.participantId);
  assert.notEqual(a.channelId, b.channelId);
  assert.deepEqual(project([a, b]).map(row => row.memberIds), [[a.id], [b.id]]);
});

test("legacy rows without owner channel IDs remain separate despite matching display fields", () => {
  const a = { id: "legacy-a", text: "first", source: "system", participantId: "same", speaker: "Guest", captureEpoch: 0, isFinal: true, receivedAt: 1000, startMs: 0, endMs: 400 };
  const b = { ...a, id: "legacy-b", text: "second", receivedAt: 2000, startMs: 500, endMs: 900 };
  assert.deepEqual(project([a, b]).map(row => row.memberIds), [[a.id], [b.id]]);
  assert.deepEqual(project([{ ...a, channelId: channelIdFor(a.source, a.participantId, a.speaker) }, b]).map(row => row.memberIds), [[a.id], [b.id]]);
});

test("unattributed unknown-source events cannot manufacture a known common channel", () => {
  const normalizer = createRecallTranscriptNormalizer();
  const event = start => ({ event: "transcript.data", data: { data: { words: [{ text: "unknown", start_timestamp: { relative: start }, end_timestamp: { relative: start + 0.4 } }] } } });
  const a = normalizer.normalize(event(0), 1000), b = normalizer.normalize(event(0.5), 2000);
  assert.equal(a.channelId, undefined); assert.equal(b.channelId, undefined);
  assert.deepEqual(project([a, b]).map(row => row.memberIds), [[a.id], [b.id]]);
});

test("the owner identity remains authoritative when one participant display name changes", () => {
  const normalizer = createRecallTranscriptNormalizer();
  const event = (name, start) => ({ event: "transcript.data", data: { source: "system", data: { participant: { id: 4, name }, words: [{ text: "fragment", start_timestamp: { relative: start }, end_timestamp: { relative: start + 0.4 } }] } } });
  const a = normalizer.normalize(event("Before", 0), 1000), b = normalizer.normalize(event("After", 0.5), 2000);
  assert.notEqual(a.speaker, b.speaker); assert.equal(a.channelId, b.channelId);
  assert.deepEqual(project([a, b]).map(row => row.memberIds), [[a.id, b.id]]);
});
