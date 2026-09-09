import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../lib/model-fetch.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { fetchModelProvider } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("Qwen uses loopback connection-aware transport, with one total budget", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return new Response('{}'); });
  await fetchModelProvider("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", { method: "POST", headers: { authorization: "Bearer fixture" }, body: '{}' }, 120_000);
  assert.equal(calls[0].url, "http://127.0.0.1:3013/internal/qwen/chat/completions");
  assert.equal(calls[0].init.headers.get("x-qwen-total-timeout-ms"), "90000");
  assert.equal(calls[0].init.headers.get("authorization"), "Bearer fixture");
  assert.equal(calls.length, 1);
});

test("no website retry restarts the total budget; cancellation is retained", async t => {
  let attempts = 0;
  const abort = new AbortController(); abort.abort();
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    attempts++;
    assert.equal(init.signal.aborted, true);
    throw new Error("cancelled");
  });
  assert.equal(await fetchModelProvider("qwen", "unused", { signal: abort.signal }, 90_000), null);
  assert.equal(attempts, 1);
});

test("OpenAI/WisePA and Kimi keep their existing destinations and budget", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return new Response('{}'); });
  for (const provider of ["openai", "kimi"]) await fetchModelProvider(provider, `https://${provider}.example/v1`, {}, 120_000);
  assert.deepEqual(calls.map(c => c.url), ["https://openai.example/v1", "https://kimi.example/v1"]);
  assert.ok(calls.every(c => !c.init.headers.has("x-qwen-total-timeout-ms")));
});
