import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

const [library, route] = await Promise.all([
  readFile(new URL("../lib/recall.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/desktop/recall/upload-token/route.ts", import.meta.url), "utf8"),
]);
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

// Execute the actual route and library, substituting only Cloudflare bindings and
// account authentication. No build, provider request or real credentials needed.
async function application(t, values = { RECALL_API_KEY: "fixture-server-key" }) {
  const marker = randomUUID();
  let user = { id: "account-a" };
  const environment = { ...values };
  globalThis[marker] = { environment, getApiUser: async () => user };
  t.after(() => { delete globalThis[marker]; });
  const binding = `globalThis[${JSON.stringify(marker)}]`;
  const libUrl = dataUrl(transpile(library).replace('import { env } from "cloudflare:workers";', `const env = ${binding}.environment;`));
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
  assert.deepEqual(await response.json(), { uploadToken: "fixture-upload-token", uploadId, apiUrl: "https://eu-central-1.recall.ai" });
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
  await new Promise(resolve => setImmediate(resolve));
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
    await new Promise(resolve => setImmediate(resolve));
  }
  app.setUser({ id: "account-excess" });
  const extra = await app.send({ sessionId: randomUUID() });
  assert.equal(extra.status, 429);
  assert.equal((await extra.json()).code, "RECALL_SESSION_CAPACITY");
  assert.equal(calls, 8);
  pending.forEach(resolve => resolve(upstream()));
  assert.ok((await Promise.all(requests)).every(response => response.status === 200));
});
