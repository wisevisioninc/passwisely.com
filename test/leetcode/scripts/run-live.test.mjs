import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
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
  assert.equal(parseArgs(liveArgs).context, "synthetic");
  assert.equal(parseArgs([...liveArgs, "--context", "text"]).context, "text");
  assert.throws(() => parseArgs([...liveArgs, "--context", "audio"]), /text or synthetic/);
  assert.throws(() => parseArgs(["--live", "--dry-run"]), /mutually exclusive/);
  assert.throws(() => parseArgs([...liveArgs, "--max-cases", "21"]), /1 to 20/);
  assert.throws(() => parseArgs([...liveArgs, "--max-cases", "1.5"]), /1 to 20/);
  assert.throws(() => parseArgs([...liveArgs, "--slugs", "a,a"]), /duplicate slug/);
  assert.throws(() => parseArgs([...liveArgs, "--live"]), /Duplicate option/);
});

test("default live routes select the CN service consistently without network or token reads", () => {
  const http = parseArgs(liveArgs);
  assert.equal(http.baseUrl, "https://passwisely.cn/api");
  assert.equal(http.grpcAddress, "passwisely.cn:443");
  const grpc = parseArgs(["--live", "--transport", "grpc", "--out", "/private/tmp/unused"]);
  assert.equal(grpc.baseUrl, "https://passwisely.cn/api");
  assert.equal(grpc.grpcAddress, "passwisely.cn:443");
  assert.throws(() => parseArgs(["--live", "--transport", "grpc", "--out", "/private/tmp/unused", "--base-url", "https://passwisely.com/api"]), /explicit --grpc-address/);
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
  await assert.rejects(runBenchmark("/nonexistent", { live: true, transport: "http-stream", context: "audio" }, "synthetic-token"), /text or synthetic/);
});

// These are transport replays: real production session/context/helper/OpenAI
// streaming code reaches a real loopback HTTP socket. Only the account token,
// capture and model's wire responses are synthetic. No solution is generated
// or judged, and fetch is restricted to the one owned loopback listener.
async function replayServer(t, respond) {
  const observations = [], failures = [], sockets = new Set();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/api/ai/chat/completions");
      assert.equal(request.headers.authorization, "Bearer synthetic-loopback-replay-token");
      assert.equal(request.headers["x-wise-provider"], "kimi");
      assert.equal(request.headers["x-wise-provider-key"], undefined);
      assert.match(request.headers["x-wise-request-id"], /^[0-9a-f-]{36}$/);
      let bytes = 0; const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        assert.ok(bytes <= 128 * 1024, "Replay request exceeded its bounded fixture size");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(body.model, "kimi-k3");
      assert.equal(body.stream, true);
      assert.equal(body.stream_options.include_usage, true);
      assert.ok(Array.isArray(body.messages) && body.messages.length >= 2);
      const observation = { body, requestId: request.headers["x-wise-request-id"] };
      observations.push(observation);
      await respond(response, observation, observations.length - 1);
    } catch (error) {
      failures.push(error);
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Synthetic loopback fixture refused request" } }));
    }
  });
  server.requestTimeout = 5_000; server.headersTimeout = 5_000;
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, origin, "A replay must never send synthetic authorization to an external host");
    return realFetch(input, init);
  });
  return { origin, observations, failures };
}

function sendReplaySse(response, text, { finish = "stop", done = true } = {}) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  const event = (content, finishReason = null, usage = undefined) => `data: ${JSON.stringify({
    id: "synthetic-loopback-completion", object: "chat.completion.chunk", created: 1, model: "kimi-k3",
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }], ...(usage ? { usage } : {}),
  })}\n\n`;
  const middle = Math.floor(text.length / 2);
  let wire = event(text.slice(0, middle)) + event(text.slice(middle));
  if (finish) wire += event("", finish, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  if (done) wire += "data: [DONE]\n\n";
  // Split UTF-8 bytes and SSE boundaries independently of content boundaries.
  const buffer = Buffer.from(wire);
  for (let offset = 0; offset < buffer.length; offset += 17) response.write(buffer.subarray(offset, offset + 17));
  response.end();
}

function replayOptions(origin, out, extra = []) {
  return parseArgs(["--live", "--transport", "http-stream", "--base-url", `${origin}/api`, "--out", out, ...extra]);
}

async function boundedReplay(t, options) {
  const timer = setTimeout(() => process.emit("SIGINT"), 10_000);
  try { return await runBenchmark(repoRoot, options, "synthetic-loopback-replay-token"); }
  finally { clearTimeout(timer); }
}

test("all 20 historical cases replay as pure text through real production HTTP SSE, not answer-quality evaluation", { timeout: 20_000 }, async t => {
  const batch = loadFixtureBatch(repoRoot, { maxCases: 20 });
  assert.equal(batch.cases.length, 20);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pw-historical-text-replay-"));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const replies = batch.cases.map(item => `TRANSPORT_REPLAY_ONLY：${item.slug}。不是算法解答。`);
  const server = await replayServer(t, async (response, observation, index) => {
    const serialized = JSON.stringify(observation.body.messages);
    const textParts = observation.body.messages.flatMap(message => typeof message.content === "string"
      ? [message.content] : message.content.filter(part => part.type === "text").map(part => part.text));
    assert.ok(textParts.some(text => text.includes(batch.cases[index].question)), "The exact historical question must reach the production transport");
    assert.doesNotMatch(serialized, /BENCH_PARTIAL_MUST_NOT_REACH_MODEL|benchmark-final-|我们正在讨论一道算法题/);
    assert.doesNotMatch(serialized, /"source":"(?:microphone|system)"/);
    assert.match(observation.body.messages[0].content, /Python/);
    sendReplaySse(response, replies[index]);
  });
  const output = path.join(directory, "results");
  const result = await boundedReplay(t, replayOptions(server.origin, output, ["--context", "text"]));
  assert.deepEqual(server.failures, []);
  assert.equal(result.completed, 20); assert.equal(result.attempted, 20); assert.equal(result.interrupted, false);
  assert.equal(server.observations.length, 20, "Exactly one real HTTP stream per historical case; no retries");
  assert.equal(new Set(server.observations.map(item => item.requestId)).size, 20);
  const summary = JSON.parse(fs.readFileSync(path.join(output, "summary.json")));
  assert.equal(summary.contextSelection, "text"); assert.deepEqual(summary.modes, ["text"]);
  assert.equal(summary.completed, 20); assert.equal(summary.errors, 0); assert.match(summary.correctness, /Not graded/);
  for (const [index, item] of batch.cases.entries()) {
    const record = JSON.parse(fs.readFileSync(path.join(output, `${String(index + 1).padStart(2, "0")}-${item.slug}.answer.json`)));
    assert.equal(record.fullAnswer, replies[index]); assert.equal(record.status, "completed");
    assert.equal(record.fixtureHash, item.fixtureHash); assert.equal(record.context.mode, "text");
    assert.deepEqual(record.context.suppliedSegments, []); assert.equal(record.context.realAudioCapture, false);
    assert.equal(record.context.partialSegmentsExcluded, true); assert.equal(record.context.truncated, false);
    assert.equal(record.finishReason, "stop"); assert.equal(record.transportRequests.length, 1);
    assert.equal(record.transportRequests[0].transport, "http"); assert.ok(record.firstContentMs !== null);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(output, "summary.json"), "utf8"), /synthetic-loopback-replay-token/);
});

test("historical mixed contexts use the current session contract and preserve auth/length/incomplete failures without retries", { timeout: 20_000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pw-historical-failure-replay-"));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const server = await replayServer(t, async (response, observation, index) => {
    const serialized = JSON.stringify(observation.body.messages);
    assert.doesNotMatch(serialized, /BENCH_PARTIAL_MUST_NOT_REACH_MODEL/);
    if (index === 1) assert.match(serialized, /系统音频/);
    if (index === 2) { assert.match(serialized, /系统音频/); assert.match(serialized, /麦克风/); }
    if (index === 0) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "SYNTHETIC_REPLAY_AUTH_REFUSED" } }));
    } else if (index === 1) sendReplaySse(response, "SYNTHETIC_REPLAY_LENGTH_PARTIAL", { finish: "length" });
    else sendReplaySse(response, "SYNTHETIC_REPLAY_EARLY_END_PARTIAL", { finish: null, done: false });
  });
  const output = path.join(directory, "results");
  const result = await boundedReplay(t, replayOptions(server.origin, output, ["--max-cases", "3"]));
  assert.deepEqual(server.failures, []); assert.equal(server.observations.length, 3);
  assert.equal(result.attempted, 3); assert.equal(result.completed, 0); assert.equal(result.interrupted, false);
  const records = fs.readdirSync(output).filter(name => name.endsWith(".answer.json")).sort().map(name => JSON.parse(fs.readFileSync(path.join(output, name))));
  assert.ok(records.every(record => record.status === "error" && record.transportRequests.length === 1));
  assert.match(records[0].error, /SYNTHETIC_REPLAY_AUTH_REFUSED/);
  assert.match(records[1].error, /答案未完整生成/); assert.equal(records[1].finishReason, "length"); assert.equal(records[1].fullAnswer, "SYNTHETIC_REPLAY_LENGTH_PARTIAL");
  assert.match(records[2].error, /数据流提前结束/); assert.equal(records[2].fullAnswer, "SYNTHETIC_REPLAY_EARLY_END_PARTIAL");
  assert.equal(records[1].context.mode, "text+synthetic-transcript"); assert.equal(records[2].context.mode, "text+synthetic-transcript");
  assert.ok(records.slice(1).every(record => record.context.partialSegmentsExcluded));
});
