import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, validateBaseUrl, validateGrpcAddress, loadToken, loadFixtureBatch, buildBenchmarkQuestion, syntheticSegments, runBenchmark } from "./run-live.mjs";
import { loadProduction } from "./production-loader.mjs";

const repoRoot = process.env.PASSWISELY_BENCH_TEST_ROOT || fileURLToPath(new URL("../../../", import.meta.url));
const exampleFixture = { slug: "synthetic-example", title: "合成接口", statement: "给定整数 x，返回 x。", python: { template: "class Solution:\n    def echo(self, x: int) -> int:\n        pass" }, judge: { expected: "PRIVATE_EXPECTED_MUST_NOT_ENTER_PROMPT" } };
const liveArgs = ["--live", "--transport", "http-stream", "--out", "/private/tmp/unused-benchmark-destination"];

test("CLI fails closed without explicit live authorization and transport; help/dry-run are offline", () => {
  assert.throws(() => parseArgs([]), /explicit --live/);
  assert.throws(() => parseArgs(["--live", "--out", "/private/tmp/unused"]), /explicit --transport/);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  assert.throws(() => parseArgs(["--live", "--dry-run"]), /mutually exclusive/);
  assert.throws(() => parseArgs([...liveArgs, "--max-cases", "21"]), /1 to 20/);
  assert.throws(() => parseArgs([...liveArgs, "--max-cases", "1.5"]), /1 to 20/);
  assert.throws(() => parseArgs([...liveArgs, "--slugs", "a,a"]), /duplicate slug/);
  assert.throws(() => parseArgs([...liveArgs, "--live"]), /Duplicate option/);
});

test("transport choices cannot leak credentials over non-loopback plaintext or mix stage with remote gRPC", () => {
  assert.equal(validateBaseUrl("http://127.0.0.1:3014").href, "http://127.0.0.1:3014/api");
  assert.equal(validateBaseUrl("http://[::1]:3014/api").hostname, "[::1]");
  for (const input of ["http://passwisely.com/api", "ftp://127.0.0.1/api", "https://user:secret@passwisely.com/api", "https://passwisely.com/api?token=secret"]) assert.throws(() => validateBaseUrl(input));
  assert.throws(() => validateGrpcAddress("passwisely.com:443", true), /loopback/);
  assert.throws(() => validateGrpcAddress("127.0.0.1:65536", true), /HOST:PORT/);
  const args = ["--live", "--transport", "grpc", "--out", "/private/tmp/unused", "--base-url", "http://127.0.0.1:3014/api"];
  assert.throws(() => parseArgs(args), /explicit --grpc-address/);
  assert.throws(() => parseArgs([...args, "--grpc-address", "127.0.0.1:50051"]), /explicit --grpc-insecure/);
  assert.throws(() => parseArgs([...args, "--grpc-address", "passwisely.com:443"]), /explicit --grpc-insecure/);
  assert.equal(parseArgs([...args, "--grpc-address", "127.0.0.1:50051", "--grpc-insecure"]).grpcInsecure, true);
  assert.throws(() => parseArgs([...liveArgs, "--grpc-insecure"]), /HTTP transport does not accept/);
});

test("explicit token file rejects permissive files and symlinks; dedicated environment is the only fallback", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-live-token-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const filename = path.join(dir, "token.json");
  fs.writeFileSync(filename, JSON.stringify({ token: "synthetic-test-token" }), { mode: 0o600 });
  assert.equal(loadToken(filename, {}), "synthetic-test-token");
  fs.chmodSync(filename, 0o644);
  assert.throws(() => loadToken(filename, {}), /0600/);
  fs.chmodSync(filename, 0o600);
  const link = path.join(dir, "link.json"); fs.symlinkSync(filename, link);
  assert.throws(() => loadToken(link, {}), /non-symlink/);
  fs.writeFileSync(filename, '{"token":"DO_NOT_ECHO_THIS_TOKEN"');
  assert.throws(() => loadToken(filename, {}), error => !error.message.includes("DO_NOT_ECHO_THIS_TOKEN"));
  assert.equal(loadToken(undefined, { PASSWISELY_BENCH_TOKEN: "synthetic-env-token", OTHER_TOKEN: "ignored" }), "synthetic-env-token");
  assert.throws(() => loadToken(undefined, { OTHER_TOKEN: "ignored" }), /explicit JSON/);
});

test("fixture selection validates all requested slugs and prompt excludes judge expectations", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-live-fixture-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const cases = path.join(dir, "test", "leetcode", "cases"); fs.mkdirSync(cases, { recursive: true });
  fs.writeFileSync(path.join(cases, "synthetic-example.json"), JSON.stringify(exampleFixture));
  fs.writeFileSync(path.join(cases, "..", "manifest.json"), JSON.stringify({ problems: [{ slug: "synthetic-example" }] }));
  const batch = loadFixtureBatch(dir, { maxCases: 20 });
  assert.equal(batch.cases.length, 1);
  assert.match(batch.cases[0].fixtureHash, /^[0-9a-f]{64}$/);
  assert.throws(() => loadFixtureBatch(dir, { maxCases: 20, slugs: ["unknown"] }), /Unknown manifest slug/);
  const question = buildBenchmarkQuestion(exampleFixture);
  assert.match(question, /Python 3/);
  assert.match(question, /def echo/);
  assert.match(question, /时间复杂度和空间复杂度/);
  assert.doesNotMatch(question, /PRIVATE_EXPECTED_MUST_NOT_ENTER_PROMPT/);
});

test("real ConversationContext preserves synthetic sources and excludes all partial bait before transport", () => {
  const previous = process.cwd();
  const { buildConversationMessages, LiveSessionService, ProcessingHelper } = loadProduction(repoRoot);
  assert.equal(process.cwd(), previous);
  assert.equal(typeof LiveSessionService, "function");
  assert.equal(typeof ProcessingHelper, "function");
  for (let index = 0; index < 3; index++) {
    const transcripts = syntheticSegments(index, "synthetic-example");
    const result = buildConversationMessages({ transcripts, question: buildBenchmarkQuestion(exampleFixture), answers: [], images: [], responseLanguage: "zh-CN" });
    const serialized = JSON.stringify(result.messages);
    assert.doesNotMatch(serialized, /BENCH_PARTIAL_MUST_NOT_REACH_MODEL/);
    assert.doesNotMatch(serialized, /PRIVATE_EXPECTED_MUST_NOT_ENTER_PROMPT/);
    assert.equal(result.truncated, false);
    if (index === 1) assert.match(serialized, /系统音频/);
    if (index === 2) { assert.match(serialized, /系统音频/); assert.match(serialized, /麦克风/); }
  }
});

test("exported runner also refuses invocation without explicit authorization before loading files or network", async () => {
  await assert.rejects(runBenchmark("/nonexistent", {}, "synthetic-token"), /explicit --live/);
});
