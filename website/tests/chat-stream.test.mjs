import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { encodeSSE, readSSE } from "../../shared/sse.mjs";
const source = (await readFile(new URL("../lib/chat-stream.ts", import.meta.url), "utf8"))
  .replace('"../../shared/sse.mjs"', JSON.stringify(new URL("../../shared/sse.mjs", import.meta.url).href));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { chatStreamResponse } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const chunk = (content, finish_reason = null) => ({ choices: [{ delta: { content }, finish_reason }] });
function fixture(provider = "openai") {
  let input, cancelled = false;
  const upstream = new Response(new ReadableStream({ start(c) { input = c; }, cancel() { cancelled = true; } }));
  const controller = new AbortController(), usages = [];
  const response = chatStreamResponse(upstream, provider, "fixture-model", controller, async u => usages.push({ ...u }));
  return { input, controller, usages, response, cancelled: () => cancelled };
}

test("OpenAI-compatible streams arrive before EOF; usage recorded once", async () => {
  const f = fixture(), events = readSSE(f.response.body);
  f.input.enqueue(encodeSSE(chunk("首段")));
  assert.equal(JSON.parse((await events.next()).value.data).choices[0].delta.content, "首段");
  assert.equal(f.usages.length, 0);
  f.input.enqueue(encodeSSE(chunk("代码", "stop")));
  f.input.enqueue(encodeSSE({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } }));
  f.input.enqueue(encodeSSE("[DONE]"));
  f.input.close();
  const rest = []; for await (const e of events) rest.push(e);
  assert.equal(rest.at(-1).data, "[DONE]");
  assert.deepEqual(f.usages, [{ prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }]);
  assert.equal(f.response.headers.get("x-accel-buffering"), "no");
});

test("truncation and upstream errors never emit successful DONE", async () => {
  for (const ending of [null, { error: { message: "provider failed" } }]) {
    const f = fixture();
    f.input.enqueue(encodeSSE(chunk("半段代码")));
    if (ending) f.input.enqueue(encodeSSE(ending));
    f.input.close();
    const events = []; for await (const e of readSSE(f.response.body)) events.push(e);
    assert.equal(events.at(-1).event, "error");
    assert.ok(!events.some(e => e.data === "[DONE]"));
    assert.equal(f.usages.length, 0);
  }
});

test("Anthropic text, stop reason and usage normalize to the same protocol", async () => {
  const f = fixture("anthropic");
  for (const event of [
    { type: "message_start", message: { id: "fixture", usage: { input_tokens: 4 } } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "中文" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } },
    { type: "message_stop" },
  ]) f.input.enqueue(encodeSSE(event));
  f.input.close();
  const events = []; for await (const e of readSSE(f.response.body)) events.push(e);
  assert.equal(JSON.parse(events[0].data).choices[0].delta.content, "中文");
  assert.equal(JSON.parse(events[1].data).choices[0].finish_reason, "stop");
  assert.equal(events.at(-1).data, "[DONE]");
  assert.deepEqual(f.usages, [{ prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 }]);
});

test("downstream cancellation aborts the upstream reader", async () => {
  const f = fixture();
  const reader = f.response.body.getReader();
  const reading = reader.read();
  await new Promise(r => setTimeout(r, 10));
  await reader.cancel(); await reading;
  assert.equal(f.controller.signal.aborted, true);
  assert.equal(f.cancelled(), true);
  assert.equal(f.usages.length, 0);
});
