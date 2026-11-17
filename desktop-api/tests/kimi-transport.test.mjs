import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { createServer as httpServer } from "node:http";
import { requestQwen } from "../qwen-transport.mjs";
import { handleKimiTransport, kimiAgent, requestKimi, warmKimiConnection, resetKimiWarmStateForTests, KIMI_ORIGIN, KIMI_TRANSPORT_PATH } from "../kimi-transport.mjs";
import { startHostHealthServer } from "../host-health.mjs";

function mock(scenario) {
  const requests = [];
  const requestImpl = (url, options, callback) => {
    const req = new EventEmitter();
    req.reusedSocket = false;
    const socket = new EventEmitter();
    req.destroy = error => queueMicrotask(() => req.emit("error", error));
    req.setTimeout = () => req;
    req.end = body => {
      requests.push({ url, body, options });
      queueMicrotask(() => scenario({ req, socket, callback, attempt: requests.length }));
    };
    return req;
  };
  return { requestImpl, requests };
}
function answer(callback, body = "{}", status = 200) {
  const res = new PassThrough(); res.headers = { "content-type": "application/json" }; res.statusCode = status;
  callback(res); res.end(Buffer.from(body)); return res;
}

test("Kimi requests use the fixed Moonshot origin and the shared keep-alive pool", async () => {
  const m = mock(({ req, socket, callback }) => { req.emit("socket", socket); socket.emit("secureConnect"); answer(callback, '{"ok":true}'); });
  const result = await requestKimi('{"model":"kimi-k3.1-pro"}', "Bearer fixture", m);
  assert.equal(result.status, 200);
  assert.equal(m.requests[0].url, KIMI_ORIGIN);
  assert.equal(m.requests[0].options.agent, kimiAgent);
  assert.equal(kimiAgent.keepAlive, true);
  assert.equal(m.requests[0].options.headers.authorization, "Bearer fixture");
});

test("a pooled socket the provider already closed is retried once on a new connection", async () => {
  const m = mock(({ req, socket, callback, attempt }) => {
    if (attempt === 1) {
      req.reusedSocket = true; req.emit("socket", socket);
      req.emit("error", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
      return;
    }
    req.emit("socket", socket); socket.emit("secureConnect"); answer(callback, '{"ok":true}');
  });
  const result = await requestKimi("{}", "Bearer fixture", m);
  assert.equal(result.status, 200);
  assert.equal(m.requests.length, 2);
  assert.equal(result.attempts[0].reusedSocket, true);
});

test("a reset after the provider started answering is never repeated", async () => {
  const m = mock(({ req, socket, callback }) => {
    req.reusedSocket = true; req.emit("socket", socket);
    const res = new PassThrough(); res.headers = {}; res.statusCode = 200; callback(res);
    res.destroy(Object.assign(new Error("reset"), { code: "ECONNRESET" }));
  });
  await assert.rejects(requestKimi("{}", "Bearer fixture", m), { code: "KIMI_NETWORK_ERROR" });
  assert.equal(m.requests.length, 1);
});

test("a fresh connection that resets after TLS is not repeated, and Qwen keeps its own codes", async () => {
  const m = mock(({ req, socket }) => {
    req.emit("socket", socket); socket.emit("secureConnect");
    req.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" }));
  });
  await assert.rejects(requestKimi("{}", "Bearer fixture", m), { code: "KIMI_NETWORK_ERROR" });
  assert.equal(m.requests.length, 1);
  const q = mock(({ req, socket }) => {
    req.emit("socket", socket); socket.emit("secureConnect");
    req.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" }));
  });
  await assert.rejects(requestQwen("{}", "Bearer fixture", q), { code: "QWEN_NETWORK_ERROR", message: /Qwen/ });
});

test("loopback handler forwards the prepared Kimi body unchanged and rejects other models", async t => {
  let captured;
  const server = httpServer((req, res) => handleKimiTransport(req, res, async (body, auth, options) => {
    captured = { body: JSON.parse(body), auth, options };
    return { status: 200, body: Buffer.from('{"id":"x"}'), elapsedMs: 12, attempts: [{ connectMs: 0 }] };
  }));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: "Bearer fixture", "x-wise-total-timeout-ms": "999999" };
  assert.equal((await fetch(url, { method: "POST" })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers, body: '{"model":"qwen3.8-flash","messages":[]}' })).status, 400);
  const sent = { model: "kimi-k3.1-pro", messages: [{ role: "user", content: "合成题目" }], reasoning_effort: "none", max_tokens: 4096, stream: false };
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(sent) });
  assert.equal(response.status, 200);
  assert.deepEqual(captured.body, sent);
  assert.equal(captured.auth, "Bearer fixture");
  assert.equal(captured.options.totalTimeoutMs, 90_000);
  assert.equal(response.headers.get("x-kimi-attempts"), "1");
});

test("the Kimi loopback path is served only to loopback callers by the health listener", async t => {
  const server = startHostHealthServer("127.0.0.1:0");
  await new Promise(r => server.once("listening", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}${KIMI_TRANSPORT_PATH}`, { method: "POST" });
  assert.equal(response.status, 401); // reached the Kimi handler, which requires provider authorization
});

test("pre-connect sends one credential-free probe, then waits while a socket is idle or recently opened", () => {
  resetKimiWarmStateForTests();
  const calls = [];
  const requestImpl = (url, options) => { calls.push({ url, options }); const req = new EventEmitter(); req.setTimeout = () => req; req.end = () => {}; return req; };
  const agent = { freeSockets: {} };
  assert.equal(warmKimiConnection({ agent, requestImpl, now: 1_000_000 }), true);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).host, new URL(KIMI_ORIGIN).host);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.agent, agent);
  assert.ok(!("authorization" in calls[0].options.headers));
  assert.equal(warmKimiConnection({ agent, requestImpl, now: 1_005_000 }), false); // rate limited
  assert.equal(warmKimiConnection({ agent: { freeSockets: { "api.moonshot.cn:443:": [{}] } }, requestImpl, now: 1_100_000 }), false); // already warm
  assert.equal(warmKimiConnection({ agent, requestImpl, now: 1_100_000 }), true);
  assert.equal(calls.length, 2);
});
