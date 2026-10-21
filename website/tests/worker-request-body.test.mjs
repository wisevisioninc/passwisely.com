import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import * as imageOptimization from "vinext/server/image-optimization";

const website = path.resolve(import.meta.dirname, "..");
const LIMIT = 16 * 1024 * 1024;
const PRIVATE_ERROR = "fixture-private-request-secret";
const encoder = new TextEncoder();

// Execute the real Worker and ingress helper; only its router is substituted.
function application(router) {
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(website, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const localRequire = name => {
      if (name === "vinext/server/app-router-entry") return { __esModule: true, default: { fetch: router } };
      if (name === "vinext/server/image-optimization") return imageOptimization;
      if (name.startsWith(".")) return load(path.relative(website, path.resolve(path.dirname(filename), name + ".ts")));
      throw new Error(`Unexpected Worker dependency ${name}`);
    };
    new Function("require", "module", "exports", code)(localRequire, module, module.exports);
    return module.exports;
  }
  const worker = load("worker/index.ts").default;
  const background = [];
  const ctx = { waitUntil(promise) { background.push(promise); }, passThroughOnException() {} };
  return { fetch: request => worker.fetch(request, {}, ctx), background };
}

function networkInput(chunks, options = {}) {
  const state = { pulls: 0, cancels: 0, ended: false };
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      state.pulls++;
      if (options.failAfter === index) throw new Error(PRIVATE_ERROR);
      if (index === chunks.length) { state.ended = true; controller.close(); return; }
      controller.enqueue(chunks[index++]);
    },
    cancel() {
      state.cancels++;
      return options.cancel?.();
    },
  }, { highWaterMark: 0 });
  const request = new Request(options.url || "https://example.invalid/api/fixture?case=body", {
    method: options.method || "POST", body: stream, duplex: "half", ...options.request,
  });
  return { request, state };
}

test("Worker completes multi-chunk native input before routing and preserves bytes and request metadata", async () => {
  const controller = new AbortController();
  const chunks = [encoder.encode('{"question":"'), new Uint8Array(0), encoder.encode("你好"), encoder.encode('"}')];
  const fixture = networkInput(chunks, { request: {
    headers: { authorization: "Bearer fixture-token", "content-type": "application/json; charset=utf-8", "x-fixture": "kept" },
    signal: controller.signal, redirect: "manual", credentials: "include", cache: "no-store",
  } });
  let forwarded, clone;
  const rejection = Response.json({ error: "fixed rejection" }, { status: 401 });
  const app = application(request => {
    assert.equal(fixture.state.ended, true);
    assert.equal(fixture.request.bodyUsed, true);
    assert.equal(fixture.request.body.locked, false);
    assert.notEqual(request, fixture.request);
    for (const field of ["url", "method", "redirect", "credentials", "cache", "integrity", "mode", "keepalive"]) {
      assert.equal(request[field], fixture.request[field], field);
    }
    assert.deepEqual([...request.headers], [...fixture.request.headers]);
    forwarded = request; clone = request.clone();
    return rejection;
  });
  assert.equal(await app.fetch(fixture.request), rejection);
  controller.abort();
  assert.equal(forwarded.signal.aborted, true);
  assert.equal(clone.signal.aborted, true);
  assert.equal(await forwarded.text(), '{"question":"你好"}');
  assert.equal(await clone.text(), '{"question":"你好"}');
  assert.equal(fixture.state.pulls, chunks.length + 1);
  assert.equal(fixture.state.cancels, 0);
  await Promise.all(app.background);
});

test("exactly 16 MiB is admitted without trusting Content-Length", async () => {
  const half = new Uint8Array(LIMIT / 2).fill(65);
  const fixture = networkInput([half, half], { request: { headers: { "content-type": "application/octet-stream" } } });
  let calls = 0;
  const app = application(async request => {
    calls++;
    assert.equal(fixture.state.ended, true);
    const bytes = new Uint8Array(await request.arrayBuffer());
    assert.equal(bytes.byteLength, LIMIT);
    assert.equal(bytes[0], 65); assert.equal(bytes.at(-1), 65);
    return new Response(null, { status: 204 });
  });
  assert.equal((await app.fetch(fixture.request)).status, 204);
  assert.equal(calls, 1);
  assert.equal(fixture.request.body.locked, false);
});

test("one byte over the limit awaits cancellation, releases the reader and never routes", async () => {
  let finishCancel, settled = false, calls = 0;
  const fixture = networkInput([new Uint8Array(LIMIT), new Uint8Array(1)], {
    cancel: () => new Promise(resolve => { finishCancel = resolve; }),
  });
  const app = application(() => { calls++; throw new Error("Router must not run"); });
  const pending = app.fetch(fixture.request).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.state.cancels, 1); assert.equal(settled, false); assert.equal(calls, 0);
  finishCancel();
  const response = await pending;
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "REQUEST_BODY_TOO_LARGE");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(fixture.request.body.locked, false); assert.equal(calls, 0);
});

test("a cancellation failure keeps the fixed 413 rejection and releases the reader", async () => {
  const fixture = networkInput([new Uint8Array(LIMIT + 1)], { cancel: () => Promise.reject(new Error(PRIVATE_ERROR)) });
  let calls = 0;
  const response = await application(() => { calls++; }).fetch(fixture.request);
  assert.equal(response.status, 413); assert.equal(calls, 0);
  assert.equal(fixture.state.cancels, 1); assert.equal(fixture.request.body.locked, false);
  assert.doesNotMatch(await response.text(), new RegExp(PRIVATE_ERROR));
});

test("a read failure returns fixed 400, releases the reader and never exposes its message", async () => {
  const fixture = networkInput([encoder.encode("partial")], { failAfter: 1 });
  let calls = 0;
  const response = await application(() => { calls++; }).fetch(fixture.request);
  assert.equal(response.status, 400); assert.equal(calls, 0);
  const body = await response.json();
  assert.equal(body.code, "INVALID_REQUEST_BODY");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(PRIVATE_ERROR));
  assert.equal(fixture.request.body.locked, false);
});

test("the ingress snapshot survives a producer reusing its chunk storage", async () => {
  const reused = new Uint8Array([65]);
  let index = 0;
  const source = new ReadableStream({ pull(controller) {
    if (index === 2) { controller.close(); return; }
    reused[0] = 65 + index++; controller.enqueue(reused);
  } }, { highWaterMark: 0 });
  const request = new Request("https://example.invalid/api/fixture", { method: "POST", body: source, duplex: "half" });
  const app = application(async stable => {
    assert.equal(await stable.text(), "AB");
    return Response.json({ ok: true });
  });
  assert.equal((await app.fetch(request)).status, 200);
});

test("GET, HEAD and absent POST bodies retain the original Request", async () => {
  for (const method of ["GET", "HEAD", "POST"]) {
    const request = new Request("https://example.invalid/api/fixture", { method });
    const app = application(stable => { assert.equal(stable, request); return new Response(null, { status: 204 }); });
    assert.equal((await app.fetch(request)).status, 204);
    assert.equal(request.bodyUsed, false);
  }
});

test("an empty network body is completed and forwarded as empty bytes", async () => {
  const fixture = networkInput([]);
  const app = application(async request => {
    assert.equal(fixture.state.ended, true);
    assert.equal(await request.text(), "");
    return Response.json({ ok: true });
  });
  assert.equal((await app.fetch(fixture.request)).status, 200);
  assert.equal(fixture.request.body.locked, false);
});

test("router 400, 401 and 405 responses are returned unchanged after ingress", async () => {
  for (const status of [400, 401, 405]) {
    const fixture = networkInput([encoder.encode("{}")]);
    const expected = Response.json({ error: `fixture-${status}` }, { status, headers: { "x-fixture": "retained" } });
    const app = application(() => { assert.equal(fixture.state.ended, true); return expected; });
    assert.equal(await app.fetch(fixture.request), expected);
  }
});

test("a successful SSE response remains the same unread stream", async () => {
  const fixture = networkInput([encoder.encode("{}")]);
  let responsePulls = 0;
  const response = new Response(new ReadableStream({ pull(controller) {
    responsePulls++; controller.enqueue(encoder.encode("data: fixture\n\n")); controller.close();
  } }, { highWaterMark: 0 }), { headers: { "content-type": "text/event-stream" } });
  const app = application(() => response);
  assert.equal(await app.fetch(fixture.request), response);
  assert.equal(response.bodyUsed, false); assert.equal(responsePulls, 0);
  assert.equal(await response.text(), "data: fixture\n\n");
});

test("non-byte network chunks fail closed without routing or retaining a locked reader", async () => {
  const fixture = networkInput([PRIVATE_ERROR]);
  let calls = 0;
  const response = await application(() => { calls++; }).fetch(fixture.request);
  assert.equal(response.status, 400); assert.equal(calls, 0);
  assert.equal(fixture.state.cancels, 1); assert.equal(fixture.request.body.locked, false);
  assert.doesNotMatch(await response.text(), new RegExp(PRIVATE_ERROR));
});

test("an already consumed nonempty body is rejected instead of silently becoming an empty request", async () => {
  const request = new Request("https://example.invalid/api/fixture", { method: "POST", body: "original nonempty input" });
  const reader = request.body.getReader();
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  assert.equal(Buffer.concat(chunks).toString(), "original nonempty input");
  assert.equal(request.bodyUsed, true); assert.equal(request.body.locked, false);
  let calls = 0;
  const app = application(() => { calls++; return Response.json({ ok: true }); });
  const response = await app.fetch(request);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_REQUEST_BODY");
  assert.equal(calls, 0); assert.equal(request.body.locked, false);
});


test("image optimizer rejection receives completed native input without routing or external fetch", async () => {
  const fixture = networkInput([encoder.encode("{}")], { url: "https://example.invalid/_vinext/image" });
  let calls = 0;
  const app = application(() => { calls++; throw new Error("Router must not run for images"); });
  const response = await app.fetch(fixture.request);
  assert.equal(response.status, 400);
  assert.equal(fixture.state.ended, true); assert.equal(fixture.state.pulls, 2);
  assert.equal(fixture.request.bodyUsed, true); assert.equal(fixture.request.body.locked, false);
  assert.equal(fixture.state.cancels, 0); assert.equal(calls, 0);
  assert.equal(app.background.length, 0); // Keep the existing no-metrics image path.
});
