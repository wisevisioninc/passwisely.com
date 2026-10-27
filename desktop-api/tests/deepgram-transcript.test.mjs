import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProductionTsLoader } from "./helpers/production-typescript.mjs";

const load = createProductionTsLoader();
const { createDeepgramTranscriptNormalizer } = load(fileURLToPath(new URL("../../electron/live/DeepgramTranscript.ts", import.meta.url)));
const result = (text, patch = {}) => ({ type: "Results", start: 0, duration: 1, is_final: false,
  channel_index: [0, 1], channel: { alternatives: [{ transcript: text }] }, ...patch });

test("Deepgram interim/final/correction rows retain their mono stream source and media-range identity", () => {
  const system = createDeepgramTranscriptNormalizer("system"), mic = createDeepgramTranscriptNormalizer("microphone");
  const interim = system.normalize(result("hello"), 1000);
  const final = system.normalize(result("hello world", { is_final: true, duration: 2 }), 2000);
  assert.equal(final.id, interim.id); assert.equal(final.isFinal, true);
  assert.equal(final.source, "system"); assert.equal(final.channelId, "native-pcm:system");
  assert.equal(final.startMs, 0); assert.equal(final.endMs, 2000);
  assert.equal(system.normalize(result("stale", { duration: 2 }), 2100), null);
  assert.equal(system.normalize(result("hello world", { is_final: true, duration: 2 }), 2200), null);
  const correction = system.normalize(result("hello World", { is_final: true, duration: 2 }), 2300);
  assert.equal(correction.id, final.id);
  const local = mic.normalize(result("hello world", { is_final: true }), 2000);
  assert.notEqual(local.id, final.id); assert.equal(local.source, "microphone");
  assert.notEqual(system.normalize(result("next", { start: 2, is_final: true })).id, final.id);
});

test("a late finalized range after resume belongs to its retired partial rather than a new capture row", () => {
  const normalizer = createDeepgramTranscriptNormalizer("system");
  const old = normalizer.normalize(result("old"));
  normalizer.beginCaptureEpoch();
  const fresh = normalizer.normalize(result("fresh", { start: 1 }));
  const late = normalizer.normalize(result("old final", { is_final: true }));
  assert.equal(late.id, old.id); assert.notEqual(late.id, fresh.id);
  assert.equal(normalizer.normalize(result("fresh final", { start: 1, is_final: true })).id, fresh.id);
});

test("unknown/malformed provider facts do not become transcript or source claims", () => {
  const normalizer = createDeepgramTranscriptNormalizer("microphone");
  for (const input of [null, [], {}, result("", {}), result("ok", { start: -1 }), result("ok", { duration: Infinity }),
    result("ok", { is_final: "true" }), result("ok", { channel_index: [1, 2] }), result("ok", { channel: null }),
    result("ok", { start: Number.MAX_SAFE_INTEGER })]) assert.equal(normalizer.normalize(input), null);
  const text = normalizer.normalize(result("中".repeat(10000))).text;
  assert.equal(text, "中".repeat(10000)); assert.ok(!text.includes("\ufffd"));
  assert.equal(normalizer.normalize(result("中".repeat(30000))), null);
});
