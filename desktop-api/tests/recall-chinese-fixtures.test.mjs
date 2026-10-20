import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = JSON.parse(readFileSync(path.join(root, "test/audio/recall-chinese/transcripts.zh-CN.json"), "utf8"));
const loadProduction = createProductionTsLoader();
const { createRecallTranscriptNormalizer } = loadProduction(path.join(root, "electron/live/recallTranscript.ts"));

test("Chinese event corpus states synthetic provenance and covers at least four utterances across both sources", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.provenance.realCaptureVerified, false);
  assert.equal(fixture.provenance.containsRealUserAudio, false);
  const finalTexts = fixture.cases.flatMap(scenario => scenario.replay.filter(step => step.expected?.isFinal).map(step => step.expected.text));
  assert.ok(finalTexts.length >= 4);
  assert.ok(finalTexts.some(text => /2026年10月20日/.test(text)));
  assert.ok(finalTexts.some(text => /128\.50元/.test(text)));
  assert.ok(finalTexts.some(text => /Python.*binary search/.test(text)));
  const sources = new Set(fixture.cases.flatMap(scenario => scenario.replay.filter(step => step.expected).map(step => step.expected.source)));
  assert.deepEqual([...sources].sort(), ["microphone", "system"]);
});

for (const scenario of fixture.cases) test(`synthetic Chinese normalizer replay: ${scenario.id}`, () => {
  const normalizer = createRecallTranscriptNormalizer();
  const latest = new Map();
  for (const step of scenario.replay) {
    const result = normalizer.normalize(step.event, step.receivedAt);
    assert.deepEqual(result, step.expected, `replay event at ${step.receivedAt}`);
    if (result) latest.set(result.id, result);
  }
  const finalTexts = [...latest.values()].filter(segment => segment.isFinal).map(segment => segment.text);
  const expected = Array.isArray(scenario.expectedFinalCharacters) ? scenario.expectedFinalCharacters : [scenario.expectedFinalCharacters];
  assert.deepEqual(finalTexts, expected);
});
