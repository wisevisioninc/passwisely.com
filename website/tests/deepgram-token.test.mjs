import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";

const [library, route, transcription] = await Promise.all([
  readFile(new URL("../lib/deepgram.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/desktop/deepgram/token/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../electron/live/transcription.ts", import.meta.url), "utf8"),
]);
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transcriptionUrl = dataUrl(transpile(transcription));
const profiles = await import(transcriptionUrl);

// Execute the real route and broker with only auth, bindings and the upstream
// transport substituted. All credentials and JWTs below are authored fixtures.
async function application(t, values = { DEEPGRAM_API_KEY: "fixture-server-secret" }) {
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
    .replace('from "@/lib/deepgram"', `from ${JSON.stringify(libUrl)}`);
  const { POST } = await import(dataUrl(code));
  return { POST, environment, setUser(value) { user = value; },
    send(body = { sessionId: randomUUID(), transcriptionProfile: "deepgram-en" }) {
      return POST(new Request("https://example.test/api/desktop/deepgram/token", { method: "POST", body: JSON.stringify(body) }));
    } };
}
const encoded = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (id = "fixture-token", exp = Math.floor(Date.now() / 1000) + 30) => `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ exp, sub: id, scopes: ["usage:write"] })}.fixture_signature`;
const upstream = (id, expires_in = 30) => Response.json({ access_token: jwt(id), expires_in });
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail("Expected asynchronous grant did not settle.");
}

test("English Deepgram is explicit, both transports share options, and ARM keeps the English Recall default", () => {
  assert.equal(profiles.DEFAULT_TRANSCRIPTION_PROFILE, "recall-en");
  for (const language of ["en", "zh"]) {
    const id = `deepgram-${language}`;
    assert.deepEqual(profiles.createDeepgramOptions(id), { model: "nova-3", language, interim_results: true, punctuate: true, endpointing: 500 });
    assert.deepEqual(profiles.createTranscriptionProvider(id), { deepgram_streaming: profiles.createDeepgramOptions(id) });
    assert.equal(profiles.getDeepgramTranscriptionProfile(id).provider, "deepgram");
  }
  assert.equal(profiles.getDeepgramTranscriptionProfile("recall-en"), null);
  assert.throws(() => profiles.createDeepgramOptions("recall-en"));
});

test("authentication precedes configuration/body parsing; strict input cannot select arbitrary upstream options", async t => {
  const app = await application(t, {});
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return upstream(); });
  app.setUser(null);
  assert.equal((await app.POST(new Request("https://example.test", { method: "POST", body: "{" }))).status, 401);
  app.setUser({ id: "account-a" });
  for (const body of [null, [], {}, { sessionId: "bad", transcriptionProfile: "deepgram-en" },
    { sessionId: randomUUID() }, { sessionId: randomUUID(), transcriptionProfile: "recall-en" },
    ...[null, true, 1, "", "__proto__", [], {}].map(transcriptionProfile => ({ sessionId: randomUUID(), transcriptionProfile })),
    ...["wsUrl", "apiUrl", "model", "apiKey", "ttl_seconds", "provider"].map(key => ({ sessionId: randomUUID(), transcriptionProfile: "deepgram-en", [key]: "injected" })),
  ]) assert.equal((await app.send(body)).status, 400);
  assert.equal((await app.POST(new Request("https://example.test", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await app.POST(new Request("https://example.test", { method: "POST" }))).status, 400);
  assert.equal(calls, 0);
});

test("declared and streamed oversized bodies are bounded before a grant request", async t => {
  const app = await application(t);
  t.mock.method(globalThis, "fetch", () => assert.fail("No grant expected"));
  for (const request of [
    new Request("https://example.test", { method: "POST", headers: { "content-length": "1025" }, body: "{}" }),
    new Request("https://example.test", { method: "POST", body: JSON.stringify({ sessionId: "x".repeat(2000) }) }),
    new Request("https://example.test", { method: "POST", body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1100)); controller.close(); } }), duplex: "half" }),
  ]) assert.equal((await app.POST(request)).status, 413);
});

test("missing/malformed server keys fail closed; Project ID alone cannot authorize a grant", async t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("No grant expected"));
  for (const values of [{}, { DEEPGRAM_API_KEY: " " }, { DEEPGRAM_API_KEY: 42 }, { DEEPGRAM_PROJECT_ID: "fixture-project" }]) {
    const app = await application(t, values);
    const response = await app.send();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "DEEPGRAM_NOT_CONFIGURED");
  }
});

test("en/zh return the fixed STT contract and temporary JWT using a server-side grant key", async t => {
  const now = 100_000;
  t.mock.method(Date, "now", () => now);
  for (const language of ["en", "zh"]) {
    const app = await application(t, { DEEPGRAM_API_KEY: "fixture-server-secret", DEEPGRAM_PROJECT_ID: "fixture-project-private" });
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return upstream(); });
    const response = await app.send({ sessionId: randomUUID(), transcriptionProfile: `deepgram-${language}` });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("vary"), "Authorization, Cookie");
    const payload = await response.json();
    assert.deepEqual(payload, { kind: "native-deepgram", accessToken: jwt(), expiresAt: now + 30_000,
      transcriptionProfile: `deepgram-${language}`, language, model: "nova-3", wsUrl: "wss://api.deepgram.com/v1/listen" });
    assert.doesNotMatch(JSON.stringify(payload), /fixture-server-secret|fixture-project-private/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.deepgram.com/v1/auth/grant");
    assert.equal(calls[0].init.redirect, "manual");
    assert.equal(calls[0].init.headers.authorization, "Token fixture-server-secret");
    assert.deepEqual(JSON.parse(calls[0].init.body), { ttl_seconds: 30 });
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  }
});

test("same-account/session/profile retries share pending/cache grants and normalize UUID case", async t => {
  const app = await application(t), sessionId = randomUUID();
  let release, calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = app.send({ sessionId, transcriptionProfile: "deepgram-en" });
  const second = app.send({ sessionId: sessionId.toUpperCase(), transcriptionProfile: "deepgram-en" });
  await until(() => calls === 1);
  assert.equal((await app.send({ sessionId, transcriptionProfile: "deepgram-zh" })).status, 409);
  release(upstream());
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal((await app.send({ sessionId, transcriptionProfile: "deepgram-en" })).status, 200);
  assert.equal(calls, 1);
});

test("cache belongs to its account; new sessions throttle while same-session retries work", async t => {
  const app = await application(t), sessionId = randomUUID();
  let now = 100_000, calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => upstream(`token-${++calls}`));
  const first = await (await app.send({ sessionId, transcriptionProfile: "deepgram-en" })).json();
  assert.equal((await app.send()).status, 429);
  assert.equal((await app.send({ sessionId, transcriptionProfile: "deepgram-en" })).status, 200);
  app.setUser({ id: "account-b" });
  const second = await (await app.send({ sessionId, transcriptionProfile: "deepgram-en" })).json();
  assert.notEqual(second.accessToken, first.accessToken);
  now += 5_000;
  assert.equal((await app.send()).status, 200);
  assert.equal(calls, 3);
});

test("the short cache never extends on retries and re-grants before token expiry", async t => {
  const app = await application(t), request = { sessionId: randomUUID(), transcriptionProfile: "deepgram-en" };
  let now = 100_000, calls = 0;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => upstream(`token-${++calls}`));
  const first = await (await app.send(request)).json();
  now += 4_999;
  assert.deepEqual(await (await app.send(request)).json(), first);
  now++;
  const second = await (await app.send(request)).json();
  assert.notEqual(second.accessToken, first.accessToken);
  assert.equal(second.expiresAt, now + 30_000);
  assert.equal(calls, 2);
});

test("key rotation invalidates completed cache and preserves the owner of a pending grant", async t => {
  const app = await application(t), request = { sessionId: randomUUID(), transcriptionProfile: "deepgram-zh" };
  const keys = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => { keys.push(init.headers.authorization); return upstream(`token-${keys.length}`); });
  const first = await (await app.send(request)).json();
  app.environment.DEEPGRAM_API_KEY = "fixture-rotated-secret";
  assert.notEqual((await (await app.send(request)).json()).accessToken, first.accessToken);
  assert.deepEqual(keys, ["Token fixture-server-secret", "Token fixture-rotated-secret"]);
  const pending = await application(t);
  let release, calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const start = pending.send(request);
  await until(() => calls === 1);
  pending.environment.DEEPGRAM_API_KEY = "fixture-rotated-secret";
  assert.equal((await pending.send(request)).status, 409);
  assert.equal(calls, 1);
  release(upstream());
  assert.equal((await start).status, 200);
});

test("provider failures/malformed grants are safe and briefly idempotent", async t => {
  const exp = Math.floor(Date.now() / 1000) + 30;
  const malformed = [null, [], {}, { access_token: "fixture-server-secret", expires_in: 30 },
    { access_token: "not-a-jwt", expires_in: 30 }, { access_token: jwt(undefined, exp - 40), expires_in: 30 },
    { access_token: jwt(undefined, exp + 100), expires_in: 30 },
    ...[0, -1, 31, "30", null].map(expires_in => ({ access_token: jwt(), expires_in })),
    { access_token: `${encoded({})}.${encoded({ exp: "invalid" })}.signature`, expires_in: 30 }];
  for (const failure of [
    () => new Response("fixture-server-secret private upstream body", { status: 500 }),
    () => new Response(null, { status: 302, headers: { location: "https://attacker.test" } }),
    () => { throw new Error("fixture-server-secret private exception"); },
    () => new Response("x".repeat(17 * 1024)), () => new Response("{"),
    ...malformed.map(payload => () => Response.json(payload)),
  ]) {
    const app = await application(t), request = { sessionId: randomUUID(), transcriptionProfile: "deepgram-en" };
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return failure(); });
    for (let retry = 0; retry < 2; retry++) {
      const response = await app.send(request);
      assert.equal(response.status, 502);
      const text = await response.text();
      assert.equal(JSON.parse(text).code, "DEEPGRAM_UPSTREAM_ERROR");
      assert.doesNotMatch(text, /fixture-server-secret|private upstream|private exception|attacker/);
    }
    assert.equal(calls, 1);
  }
});

test("JWT expiry and request start bound expiresAt; optional expires_in uses requested TTL", async t => {
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  for (const expires_in of [undefined, 30]) {
    const app = await application(t);
    t.mock.method(globalThis, "fetch", async () => { now += 2_000; return Response.json({ access_token: jwt(undefined, 129), ...(expires_in === undefined ? {} : { expires_in }) }); });
    const response = await app.send();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).expiresAt, 129_000);
    now = 100_000;
  }
});

test("credential rejection and actual signal abort timeout have distinct safe codes", async t => {
  for (const status of [401, 403]) {
    const app = await application(t);
    t.mock.method(globalThis, "fetch", async () => new Response("fixture-server-secret", { status }));
    const response = await app.send();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "DEEPGRAM_CREDENTIALS_INVALID");
    assert.match(body.error, /Member or higher/);
    assert.doesNotMatch(body.error, /fixture-server-secret/);
  }
  const app = await application(t), controller = new AbortController();
  let requestedTimeout;
  t.mock.method(AbortSignal, "timeout", ms => { requestedTimeout = ms; return controller.signal; });
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    queueMicrotask(() => controller.abort(new DOMException("fixture-server-secret", "TimeoutError")));
  }));
  const response = await app.send();
  assert.equal(requestedTimeout, 10_000);
  assert.equal(response.status, 504);
  const body = await response.json();
  assert.equal(body.code, "DEEPGRAM_TIMEOUT");
  assert.doesNotMatch(body.error, /fixture-server-secret/);
});

test("global pending and retained-cache capacity are bounded without evicting active grants", async t => {
  const app = await application(t), releases = [], requests = [];
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; return new Promise(resolve => releases.push(resolve)); });
  for (let i = 0; i < 8; i++) {
    app.setUser({ id: `account-${i}` }); requests.push(app.send());
    await until(() => calls === i + 1);
  }
  app.setUser({ id: "account-excess" });
  const extra = await app.send();
  assert.equal(extra.status, 429);
  assert.equal((await extra.json()).code, "DEEPGRAM_SESSION_CAPACITY");
  assert.equal(calls, 8);
  releases.forEach(release => release(upstream()));
  assert.ok((await Promise.all(requests)).every(response => response.status === 200));
  const bounded = await application(t);
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => upstream());
  for (let i = 0; i < 256; i++) {
    bounded.setUser({ id: `retained-${i}` });
    assert.equal((await bounded.send()).status, 200);
  }
  bounded.setUser({ id: "retained-excess" });
  assert.equal((await bounded.send()).status, 429);
  now += 5_000;
  assert.equal((await bounded.send()).status, 200);
});

test("oversized streaming grant responses are cancelled and short-lived tokens never enter cache", async t => {
  const app = await application(t);
  let cancelled = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); },
    cancel() { cancelled++; },
  })));
  const response = await app.send();
  assert.equal(response.status, 502);
  assert.equal(cancelled, 1);
  const expiring = await application(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ access_token: jwt(undefined, Math.floor(Date.now() / 1000) + 4), expires_in: 30 }));
  const short = await expiring.send();
  assert.equal(short.status, 502);
  assert.equal((await short.json()).code, "DEEPGRAM_UPSTREAM_ERROR");
});
