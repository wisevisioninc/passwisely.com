import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

const [library, route, transcription] = await Promise.all([
  readFile(new URL("../lib/recall.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/desktop/recall/upload-token/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../electron/live/transcription.ts", import.meta.url), "utf8"),
]);
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transcriptionUrl = dataUrl(transpile(transcription));
async function until(check) {
  for (let index = 0; index < 100; index++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail("Expected asynchronous upload preparation did not settle.");
}

// Execute the actual route and library, substituting only Cloudflare bindings and
// account authentication. No build, provider request or real credentials needed.
async function application(t, values = { RECALL_API_KEY: "fixture-server-key" }) {
  const marker = randomUUID();
  let user = { id: "account-a" };
  const environment = { ...values };
  globalThis[marker] = { environment, getApiUser: async () => user };
  t.after(() => { delete globalThis[marker]; });
  const binding = `globalThis[${JSON.stringify(marker)}]`;
  const libUrl = dataUrl(transpile(library)
    .replace('import { env } from "cloudflare:workers";', `const env = ${binding}.environment;`)
    .replace('from "../../electron/live/transcription"', `from ${JSON.stringify(transcriptionUrl)}`));
  const code = transpile(route)
    .replace('import { getApiUser } from "@/lib/auth";', `const getApiUser = (...args) => ${binding}.getApiUser(...args);`)
    .replace('from "@/lib/recall"', `from ${JSON.stringify(libUrl)}`);
  const { POST } = await import(dataUrl(code));
  return {
    POST,
    environment,
    setUser(value) { user = value; },
    send(body) { return POST(new Request("https://example.test/api/desktop/recall/upload-token", { method: "POST", body: JSON.stringify(body) })); },
  };
}
const uploadId = "731a77c0-95e8-4107-9b9b-2b38d4ba5fe8";
const upstream = (token = "fixture-upload-token") => Response.json({ id: uploadId, upload_token: token });

test("authentication precedes Recall access and malformed bodies cannot supply an origin", async (t) => {
  const app = await application(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return upstream(); });
  app.setUser(null);
  assert.equal((await app.send({ sessionId: randomUUID() })).status, 401);
  app.setUser({ id: "account-a" });
  for (const body of [null, [], {}, { sessionId: "invalid" }, { sessionId: randomUUID(), origin: "https://attacker.test" }]) {
    assert.equal((await app.send(body)).status, 400);
  }
  const response = await app.POST(new Request("https://example.test", { method: "POST", body: "{" }));
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("bounded body reader rejects undeclared oversize input before a provider request", async (t) => {
  const app = await application(t);
  t.mock.method(globalThis, "fetch", () => { throw new Error("must not fetch"); });
  const result = await app.POST(new Request("https://example.test", { method: "POST", body: JSON.stringify({ sessionId: "x".repeat(2000) }) }));
  assert.equal(result.status, 413);
});

test("missing credentials and unsupported server region fail closed with useful codes", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("must not fetch"); });
  for (const [env, code] of [
    [{}, "RECALL_NOT_CONFIGURED"],
    [{ RECALL_API_KEY: "fixture", RECALL_API_REGION: "https://attacker.test" }, "RECALL_REGION_INVALID"],
    [{ RECALL_API_KEY: "fixture", RECALL_API_REGION: "__proto__" }, "RECALL_REGION_INVALID"],
  ]) {
    const app = await application(t, env);
    const response = await app.send({ sessionId: randomUUID() });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, code);
  }
});

test("upload creation uses official region, server authorization, audio-only and partial/final ASR", async (t) => {
  const app = await application(t, { RECALL_API_KEY: "fixture-secret", RECALL_API_REGION: "eu-central-1" });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return upstream(); });
  const response = await app.send({ sessionId: randomUUID() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Authorization, Cookie");
  assert.deepEqual(await response.json(), { uploadToken: "fixture-upload-token", uploadId, apiUrl: "https://eu-central-1.recall.ai", transcriptionProfile: "recall-en" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://eu-central-1.recall.ai/api/v1/sdk_upload/");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers.authorization, "Token fixture-secret");
  const config = JSON.parse(calls[0].init.body).recording_config;
  assert.equal(config.video_mixed_mp4, null);
  assert.deepEqual(config.audio_mixed_mp3, {});
  assert.equal(config.transcript.provider.recallai_streaming.mode, "prioritize_low_latency");
  assert.equal(config.transcript.provider.recallai_streaming.language_code, "en");
  assert.equal(config.transcript.diarization.use_separate_streams_when_available, true);
  assert.deepEqual(config.realtime_endpoints, [{ type: "desktop_sdk_callback", events: ["transcript.data", "transcript.partial_data"] }]);
});

test("legacy key alias is supported while the main key takes precedence", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => { seen.push(init.headers.authorization); return upstream(); });
  for (const values of [{ RECALLAI_API_KEY: "legacy" }, { RECALL_API_KEY: "primary", RECALLAI_API_KEY: "legacy" }]) {
    const app = await application(t, values);
    assert.equal((await app.send({ sessionId: randomUUID() })).status, 200);
  }
  assert.deepEqual(seen, ["Token legacy", "Token primary"]);
});

test("redirect responses are rejected without another request or exposing credentials", async (t) => {
  const app = await application(t, { RECALL_API_KEY: "fixture-private-key" });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 302, headers: { location: "https://example.invalid/collect" } });
  });
  const response = await app.send({ sessionId: randomUUID() });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "RECALL_UPSTREAM_ERROR");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://us-west-2.recall.ai/api/v1/sdk_upload/");
  assert.equal(calls[0].init.redirect, "manual");
});

test("concurrent same-session retries share one upload and normalize UUID case", async (t) => {
  const app = await application(t);
  const sessionId = randomUUID();
  let release;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = app.send({ sessionId });
  const second = app.send({ sessionId: sessionId.toUpperCase() });
  await until(() => calls === 1);
  assert.equal(calls, 1);
  release(upstream());
  const results = await Promise.all([first, second]);
  assert.deepEqual(await results[0].json(), await results[1].json());
  assert.equal((await app.send({ sessionId })).status, 200);
  assert.equal(calls, 1);
});

test("a different signed-in account cannot obtain another account's cached upload token", async (t) => {
  const app = await application(t);
  const sessionId = randomUUID();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => upstream(`token-${++calls}`));
  const first = await (await app.send({ sessionId })).json();
  app.setUser({ id: "account-b" });
  const second = await (await app.send({ sessionId })).json();
  assert.equal(first.uploadToken, "token-1");
  assert.equal(second.uploadToken, "token-2");
  assert.equal(calls, 2);
});

test("new sessions are throttled while same-session retries remain available", async (t) => {
  const app = await application(t);
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return upstream(); });
  const sessionId = randomUUID();
  assert.equal((await app.send({ sessionId })).status, 200);
  assert.equal((await app.send({ sessionId: randomUUID() })).status, 429);
  assert.equal((await app.send({ sessionId })).status, 200);
  now += 5_000;
  assert.equal((await app.send({ sessionId: randomUUID() })).status, 200);
  assert.equal(calls, 2);
});

test("cache TTL expires without being extended by retries", async (t) => {
  const app = await application(t);
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => upstream(`token-${++calls}`));
  const sessionId = randomUUID();
  await app.send({ sessionId });
  now += 59_000;
  assert.equal((await (await app.send({ sessionId })).json()).uploadToken, "token-1");
  now += 1_000;
  assert.equal((await (await app.send({ sessionId })).json()).uploadToken, "token-2");
});

test("upstream error bodies and exception messages are redacted and failures are idempotent", async (t) => {
  for (const failure of [
    () => new Response('fixture-secret fixture-token user prompt', { status: 503 }),
    () => { throw new Error("fixture-secret fixture-token user prompt"); },
    () => Response.json({ id: uploadId, upload_token: "" }),
    () => Response.json({ id: "fixture-secret", upload_token: "fixture-token" }),
    () => new Response("x".repeat(70_000)),
  ]) {
    const app = await application(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return failure(); });
    const sessionId = randomUUID();
    for (let retry = 0; retry < 2; retry++) {
      const response = await app.send({ sessionId });
      assert.equal(response.status, 502);
      const text = await response.text();
      assert.doesNotMatch(text, /fixture-secret|fixture-token|user prompt/);
      assert.equal(JSON.parse(text).code, "RECALL_UPSTREAM_ERROR");
    }
    assert.equal(calls, 1);
  }
});

test("upstream credential rejection and timeout have distinct safe error codes", async (t) => {
  for (const [status, code, fetcher] of [
    [503, "RECALL_CREDENTIALS_INVALID", async () => new Response("secret", { status: 401 })],
    [504, "RECALL_TIMEOUT", async () => { throw new DOMException("secret", "TimeoutError"); }],
  ]) {
    const app = await application(t);
    t.mock.method(globalThis, "fetch", fetcher);
    const response = await app.send({ sessionId: randomUUID() });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.doesNotMatch(body.error, /secret/);
  }
});

test("bounded global concurrency rejects excess work without issuing another upload", async (t) => {
  const app = await application(t);
  const pending = [];
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; return new Promise(resolve => pending.push(resolve)); });
  const requests = [];
  for (let i = 0; i < 8; i++) {
    app.setUser({ id: `account-${i}` });
    requests.push(app.send({ sessionId: randomUUID() }));
    await until(() => calls === i + 1);
  }
  app.setUser({ id: "account-excess" });
  const extra = await app.send({ sessionId: randomUUID() });
  assert.equal(extra.status, 429);
  assert.equal((await extra.json()).code, "RECALL_SESSION_CAPACITY");
  assert.equal(calls, 8);
  pending.forEach(resolve => resolve(upstream()));
  assert.ok((await Promise.all(requests)).every(response => response.status === 200));
});

test("all explicit profiles use the shared provider contract with no alternate ASR fallback", async (t) => {
  const expected = {
    "recall-en": { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } },
    "deepgram-en": { deepgram_streaming: { model: "nova-3", language: "en", interim_results: true, punctuate: true, endpointing: 500 } },
    "deepgram-zh": { deepgram_streaming: { model: "nova-3", language: "zh", interim_results: true, punctuate: true, endpointing: 500 } },
    "recall-zh": { recallai_streaming: { mode: "prioritize_accuracy", language_code: "zh" } },
  };
  for (const [profile, provider] of Object.entries(expected)) {
    const app = await application(t, { RECALL_API_KEY: "fixture-server-key", RECALL_API_REGION: "ap-northeast-1" });
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return upstream(); });
    const response = await app.send({ sessionId: randomUUID(), transcriptionProfile: profile });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).transcriptionProfile, profile);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://ap-northeast-1.recall.ai/api/v1/sdk_upload/");
    const config = JSON.parse(calls[0].init.body).recording_config;
    assert.deepEqual(config.transcript.provider, provider);
    assert.equal(config.transcript.diarization.use_separate_streams_when_available, true);
    assert.deepEqual(config.realtime_endpoints, [{ type: "desktop_sdk_callback", events: ["transcript.data", "transcript.partial_data"] }]);
    assert.equal(config.video_mixed_mp4, null);
  }
});

test("invalid profiles are rejected before configuration or fetch; request cannot inject provider options", async (t) => {
  const app = await application(t, {});
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return upstream(); });
  for (const profile of [null, true, 0, "", "zh", "recall-en ", "__proto__", [], {}, { id: "recall-en" }]) {
    const response = await app.send({ sessionId: randomUUID(), transcriptionProfile: profile });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_TRANSCRIPTION_PROFILE");
  }
  const injected = await app.send({ sessionId: randomUUID(), transcriptionProfile: "deepgram-zh", provider: { deepgram_streaming: { language: "en" } } });
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).code, "INVALID_SESSION_REQUEST");
  assert.equal(calls, 0);
});

test("a pending session owns one profile: a different profile conflicts while same-profile UUID retries share it", async (t) => {
  const app = await application(t);
  const sessionId = randomUUID();
  let release, calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = app.send({ sessionId, transcriptionProfile: "deepgram-zh" });
  await until(() => calls === 1);
  const conflict = await app.send({ sessionId, transcriptionProfile: "recall-en" });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "RECALL_SESSION_CONFIG_MISMATCH");
  const retry = app.send({ sessionId: sessionId.toUpperCase(), transcriptionProfile: "deepgram-zh" });
  release(upstream());
  const [a, b] = await Promise.all([first, retry]);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(calls, 1);
});

test("default and explicit English profiles identify the same legacy-compatible session", async (t) => {
  const app = await application(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return upstream(); });
  const sessionId = randomUUID();
  const legacy = await (await app.send({ sessionId })).json();
  const explicit = await (await app.send({ sessionId, transcriptionProfile: "recall-en" })).json();
  assert.equal(legacy.transcriptionProfile, "recall-en");
  assert.deepEqual(explicit, legacy);
  assert.equal(calls, 1);
});

test("failed Chinese session keeps its configuration identity and a safe actionable hint without claiming a missing key", async (t) => {
  const app = await application(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("fixture-private-key unknown provider failure", { status: 400 }); });
  const sessionId = randomUUID();
  const first = await app.send({ sessionId, transcriptionProfile: "deepgram-zh" });
  const firstBody = await first.json();
  assert.equal(first.status, 502);
  assert.equal(firstBody.code, "RECALL_UPSTREAM_ERROR");
  assert.match(firstBody.error, /default Deepgram transcription credentials/);
  assert.match(firstBody.error, /temporary upstream failure/);
  assert.doesNotMatch(firstBody.error, /fixture-private-key|unknown provider failure|is missing|not configured/i);
  const retry = await app.send({ sessionId, transcriptionProfile: "deepgram-zh" });
  assert.deepEqual(await retry.json(), firstBody);
  const changed = await app.send({ sessionId, transcriptionProfile: "recall-zh" });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, "RECALL_SESSION_CONFIG_MISMATCH");
  assert.equal(calls, 1);
});

test("region and credential rotation cannot return a token from the earlier configuration", async (t) => {
  for (const change of [{ RECALL_API_REGION: "eu-central-1" }, { RECALL_API_KEY: "fixture-rotated-private-key" }]) {
    const app = await application(t, { RECALL_API_KEY: "fixture-original-private-key", RECALL_API_REGION: "ap-northeast-1" });
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return upstream(); });
    const sessionId = randomUUID();
    assert.equal((await app.send({ sessionId, transcriptionProfile: "deepgram-zh" })).status, 200);
    Object.assign(app.environment, change);
    const conflict = await app.send({ sessionId, transcriptionProfile: "deepgram-zh" });
    assert.equal(conflict.status, 409);
    const text = await conflict.text();
    assert.equal(JSON.parse(text).code, "RECALL_SESSION_CONFIG_MISMATCH");
    assert.doesNotMatch(text, /fixture-original-private-key|fixture-rotated-private-key/);
    assert.equal(calls, 1);
  }
});

test("credential rotation also conflicts with a pending or failed session", async (t) => {
  for (const pending of [true, false]) {
    const app = await application(t);
    let release, calls = 0;
    t.mock.method(globalThis, "fetch", () => {
      calls++;
      return pending ? new Promise(resolve => { release = resolve; }) : Promise.resolve(new Response("private response", { status: 503 }));
    });
    const sessionId = randomUUID();
    const first = app.send({ sessionId });
    await until(() => calls === 1);
    if (!pending) assert.equal((await first).status, 502);
    app.environment.RECALL_API_KEY = "fixture-different-key";
    const conflict = await app.send({ sessionId });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, "RECALL_SESSION_CONFIG_MISMATCH");
    assert.equal(calls, 1);
    if (pending) { release(upstream()); assert.equal((await first).status, 200); }
  }
});

test("Deepgram timeout stays a timeout and exposes neither provider body nor thrown messages", async (t) => {
  const app = await application(t);
  t.mock.method(globalThis, "fetch", async () => { throw new DOMException("fixture-private-key", "TimeoutError"); });
  const response = await app.send({ sessionId: randomUUID(), transcriptionProfile: "deepgram-zh" });
  assert.equal(response.status, 504);
  const body = await response.json();
  assert.equal(body.code, "RECALL_TIMEOUT");
  assert.match(body.error, /default Deepgram transcription credentials/);
  assert.doesNotMatch(JSON.stringify(body), /fixture-private-key/);
});

test("the observed Deepgram temporary-credential error becomes one fixed safe actionable 503 and remains cached", async (t) => {
  const app = await application(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ transcript: "Unable to get temporary credentials for deepgram_streaming. fixture-upstream-secret https://example.invalid/?key=fixture-key", detail: "fixture-private-body" }, { status: 400 });
  });
  const sessionId = randomUUID();
  const first = await app.send({ sessionId, transcriptionProfile: "deepgram-zh" });
  assert.equal(first.status, 503);
  const body = await first.json();
  assert.equal(body.code, "RECALL_DEEPGRAM_CREDENTIALS_UNAVAILABLE");
  assert.match(body.error, /same workspace and region/);
  assert.match(body.error, /Deepgram API Key and matching Project ID/);
  assert.match(body.error, /default/);
  assert.match(body.error, /Member, Admin, or Owner/);
  assert.match(body.error, /After saving, start a new audio session/);
  assert.doesNotMatch(JSON.stringify(body), /fixture-upstream-secret|fixture-key|fixture-private-body|example\.invalid/);
  const second = await app.send({ sessionId, transcriptionProfile: "deepgram-zh" });
  assert.equal(second.status, 503);
  assert.deepEqual(await second.json(), body);
  assert.equal(calls, 1);
});

test("other Deepgram 400 transcripts remain generic, without classifying or exposing provider details", async (t) => {
  for (const transcript of [
    "fixture-private-key: unrelated upstream validation error",
    "Unable to get temporary credentials for another_provider. fixture-private-key",
    "fixture-private-key Unable to get temporary credentials for deepgram_streaming.",
    { message: "Unable to get temporary credentials for deepgram_streaming. fixture-private-key" },
  ]) {
    const app = await application(t);
    t.mock.method(globalThis, "fetch", async () => Response.json({ transcript, other: "fixture-private-key" }, { status: 400 }));
    const response = await app.send({ sessionId: randomUUID(), transcriptionProfile: "deepgram-zh" });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, "RECALL_UPSTREAM_ERROR");
    assert.doesNotMatch(JSON.stringify(body), /fixture-private-key|another_provider|unrelated upstream validation error/);
  }
});

test("malformed or oversized Deepgram 400 bodies stay generic 502 and the oversized stream is cancelled", async (t) => {
  for (const malformed of ['{"transcript":"fixture-private-key"', '"fixture-private-key"', '["fixture-private-key"]']) {
    const app = await application(t);
    t.mock.method(globalThis, "fetch", async () => new Response(malformed, { status: 400 }));
    const response = await app.send({ sessionId: randomUUID(), transcriptionProfile: "deepgram-zh" });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, "RECALL_UPSTREAM_ERROR");
    assert.doesNotMatch(JSON.stringify(body), /fixture-private-key/);
  }
  const app = await application(t);
  let cancellations = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ transcript: "Unable to get temporary credentials for deepgram_streaming. " + "fixture-private-key".repeat(5000) }))); },
    cancel() { cancellations++; },
  }), { status: 400 }));
  const response = await app.send({ sessionId: randomUUID(), transcriptionProfile: "deepgram-zh" });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, "RECALL_UPSTREAM_ERROR");
  assert.doesNotMatch(JSON.stringify(body), /fixture-private-key/);
  assert.equal(cancellations, 1);
  const unreadable = await application(t);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.error(new DOMException("fixture-private-key", "TimeoutError")); },
  }), { status: 400 }));
  const failedRead = await unreadable.send({ sessionId: randomUUID(), transcriptionProfile: "deepgram-zh" });
  assert.equal(failedRead.status, 502, "a failed 400 body read must not become a classified credential error or a fetch timeout");
  const failedBody = await failedRead.json();
  assert.equal(failedBody.code, "RECALL_UPSTREAM_ERROR");
  assert.doesNotMatch(JSON.stringify(failedBody), /fixture-private-key/);
});

test("the credential prefix does not change other profiles, statuses, or Recall-auth errors", async (t) => {
  for (const [profile, status, expectedStatus, expectedCode] of [
    ["recall-en", 400, 502, "RECALL_UPSTREAM_ERROR"],
    ["recall-zh", 400, 502, "RECALL_UPSTREAM_ERROR"],
    ["deepgram-zh", 500, 502, "RECALL_UPSTREAM_ERROR"],
    ["deepgram-zh", 401, 503, "RECALL_CREDENTIALS_INVALID"],
  ]) {
    const app = await application(t);
    t.mock.method(globalThis, "fetch", async () => Response.json({ transcript: "Unable to get temporary credentials for deepgram_streaming. fixture-private-key" }, { status }));
    const response = await app.send({ sessionId: randomUUID(), transcriptionProfile: profile });
    assert.equal(response.status, expectedStatus);
    const body = await response.json();
    assert.equal(body.code, expectedCode);
    assert.doesNotMatch(JSON.stringify(body), /fixture-private-key/);
  }
});
