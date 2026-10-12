import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { createServer as httpServer } from "node:http";
import { createServer as tlsServer, request as tlsRequest } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { requestQwen, handleQwenTransport, QWEN_ORIGIN, CONNECT_TIMEOUT_MS, TOTAL_TIMEOUT_MS } from "../qwen-transport.mjs";

function mock(scenario) {
  const requests = [];
  const requestImpl = (url, options, callback) => {
    assert.equal(url, QWEN_ORIGIN);
    const req = new EventEmitter();
    req.reusedSocket = false;
    const socket = new EventEmitter();
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    req.destroy = error => {
      timers.forEach(clearTimeout);
      queueMicrotask(() => req.emit("error", error));
    };
    req.end = body => {
      requests.push({ body, options });
      queueMicrotask(() => scenario({ req, socket, later, callback, attempt: requests.length }));
    };
    return req;
  };
  return { requestImpl, requests };
}
function connected(req, socket) {
  req.emit("socket", socket);
  socket.emit("secureConnect");
}
function answer(callback, body = "{}", status = 200) {
  const res = new PassThrough(); res.headers = { "content-type": "application/json" };
  res.statusCode = status;
  callback(res);
  res.end(Buffer.from(body));
  return res;
}

test("production budgets are connect 20s and total 90s", () => {
  assert.equal(CONNECT_TIMEOUT_MS, 20_000);
  assert.equal(TOTAL_TIMEOUT_MS, 90_000);
});

test("connection deadline stops at TLS, not at headers or response completion", async () => {
  const m = mock(({ req, socket, callback, later }) => {
    connected(req, socket);
    later(() => answer(callback, '{"ok":true}'), 150);
  });
  const result = await requestQwen("{}", "Bearer fixture", { ...m, connectTimeoutMs: 40, totalTimeoutMs: 600 });
  assert.equal(result.status, 200);
  assert.equal(m.requests.length, 1);
  assert.ok(result.elapsedMs >= 140);
});

test("TCP connect without TLS completion still times out; no three full generation attempts", async () => {
  const m = mock(({ req, socket }) => { req.emit("socket", socket); socket.emit("connect"); });
  await assert.rejects(requestQwen("{}", "Bearer fixture", { ...m, connectTimeoutMs: 20, totalTimeoutMs: 500 }), { code: "QWEN_CONNECT_TIMEOUT" });
  assert.equal(m.requests.length, 3);
});

test("DNS/socket assignment is covered by the connection budget", async () => {
  const m = mock(() => {});
  await assert.rejects(requestQwen("{}", "Bearer fixture", { ...m, connectTimeoutMs: 20, maxAttempts: 1 }), { code: "QWEN_CONNECT_TIMEOUT" });
});

test("all connection attempts share one absolute total deadline", async () => {
  const m = mock(() => {});
  const start = performance.now();
  await assert.rejects(requestQwen("{}", "Bearer fixture", { ...m, connectTimeoutMs: 100, totalTimeoutMs: 150 }), { code: "QWEN_TOTAL_TIMEOUT" });
  assert.equal(m.requests.length, 2);
  assert.ok(performance.now() - start < 400);
});

test("total timeout also covers a stalled response body and does not retry", async () => {
  const m = mock(({ req, socket, callback }) => {
    connected(req, socket);
    const res = new PassThrough(); res.headers = { "content-type": "application/json" }; res.statusCode = 200; callback(res);
    res.write(Buffer.from('{"partial":'));
  });
  await assert.rejects(requestQwen("{}", "Bearer fixture", { ...m, connectTimeoutMs: 20, totalTimeoutMs: 70 }), { code: "QWEN_TOTAL_TIMEOUT" });
  assert.equal(m.requests.length, 1);
});

test("reused TLS socket does not wait for another secureConnect", async () => {
  const m = mock(({ req, socket, later, callback }) => {
    req.reusedSocket = true; req.emit("socket", socket);
    later(() => answer(callback), 80);
  });
  assert.equal((await requestQwen("{}", "Bearer fixture", { ...m, connectTimeoutMs: 20 })).status, 200);
});

test("caller cancellation aborts active requests and suppresses retries", async () => {
  const controller = new AbortController();
  const m = mock(({ req, socket, later }) => { connected(req, socket); later(() => controller.abort(), 10); });
  await assert.rejects(requestQwen("{}", "Bearer fixture", { ...m, signal: controller.signal }), { code: "QWEN_CANCELLED" });
  assert.equal(m.requests.length, 1);
  await assert.rejects(requestQwen("{}", "Bearer fixture", { ...m, signal: controller.signal }), { code: "QWEN_CANCELLED" });
  assert.equal(m.requests.length, 1);
});

test("post-connect reset is not retried; HTTP errors remain intact", async () => {
  const m = mock(({ req, socket }) => { connected(req, socket); req.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" })); });
  await assert.rejects(requestQwen("{}", "Bearer fixture", m), { code: "QWEN_NETWORK_ERROR" });
  assert.equal(m.requests.length, 1);
  const denied = mock(({ req, socket, callback }) => { connected(req, socket); answer(callback, '{"error":"denied"}', 401); });
  assert.equal((await requestQwen("{}", "Bearer fixture", denied)).status, 401);
  assert.equal(denied.requests.length, 1);
});

test("loopback handler validates input, clamps budget, forces thinking off", async t => {
  let captured;
  const server = httpServer((req, res) => handleQwenTransport(req, res, async (body, auth, options) => {
    captured = { body: JSON.parse(body), auth, options };
    return { status: 200, body: Buffer.from('{}'), elapsedMs: 12, attempts: [{ connectMs: 2 }] };
  }));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(url, { method: "POST" })).status, 401);
  const headers = { authorization: "Bearer fixture", "x-qwen-total-timeout-ms": "999999" };
  assert.equal((await fetch(url, { method: "POST", headers, body: '{"model":"openai"}' })).status, 400);
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ model: "qwen3.8-flash", messages: [], stream: false, enable_thinking: true }) });
  assert.equal(response.status, 200);
  assert.equal(captured.options.totalTimeoutMs, 90_000);
  assert.equal(captured.body.enable_thinking, false);
  assert.equal(captured.body.stream, false);
  assert.equal(response.headers.get("x-qwen-attempts"), "1");
});

test("real TLS: default 20s connect limit permits a response after 21s", { timeout: 30_000 }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "passwisely-qwen-tls-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "ignore" });
  const cert = await readFile(path.join(dir, "cert.pem"));
  const server = tlsServer({ key: await readFile(path.join(dir, "key.pem")), cert }, (req, res) => {
    req.resume();
    const timer = setTimeout(() => { res.writeHead(200); res.end('{"delayed":true}'); }, 21_000);
    res.once("close", () => clearTimeout(timer));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const requestImpl = (_url, options, callback) => tlsRequest({ ...options, hostname: "127.0.0.1", port: server.address().port, servername: "localhost", ca: cert, agent: false }, callback);
  const result = await requestQwen("{}", "Bearer fixture", { requestImpl });
  assert.equal(result.status, 200);
  assert.equal(result.attempts.length, 1);
  assert.ok(result.elapsedMs >= 21_000);
  assert.ok(result.attempts[0].connectMs < 20_000);
});

test("Qwen loopback forwards chunks immediately and aborts on client disconnect", { timeout: 4000 }, async t => {
  let captured, finish;
  const disconnected = new Promise(r => { finish = r; });
  const server = httpServer((req, res) => handleQwenTransport(req, res, async (body, _auth, options) => {
    captured = JSON.parse(body);
    options.onHeaders(200, { "content-type": "text/event-stream" });
    await options.onChunk(Buffer.from('data: first\n\n'));
    await new Promise(r => options.signal.addEventListener("abort", r, { once: true }));
    finish(); throw new Error("cancelled");
  }));
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: "POST", signal: controller.signal, headers: { authorization: "Bearer fixture" }, body: JSON.stringify({ model: "qwen3.8-flash", messages: [], stream: true }) });
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  assert.equal(captured.stream, true);
  assert.equal(captured.enable_thinking, false);
  controller.abort(); await disconnected;
});
