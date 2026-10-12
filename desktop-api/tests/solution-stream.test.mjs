import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { encodeSSE, readSSE } from "../../shared/sse.mjs";

const source = await readFile(new URL("../../electron/solutionStream.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { partialSolution, solutionFormat } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("partial JSON preserves code escapes and Unicode at every split point", () => {
  const answer = { thoughts: ["使用哈希表😀"], time_complexity: "O(n)，遍历一次", space_complexity: "O(n)，存储下标", code: 'print("\\n")\nprint("你好😀")', alternatives: ["排序后使用双指针。"] };
  const raw = JSON.stringify(answer).replace("😀", "\\ud83d\\ude00");
  for (let n = 1; n <= raw.length; n++) {
    const preview = partialSolution(raw.slice(0, n));
    for (const [key, value] of Object.entries(preview)) {
      if (Array.isArray(value)) value.forEach((text, i) => assert.ok(answer[key][i].startsWith(text), `split ${n}: ${key}`));
      else assert.ok(answer[key].startsWith(value), `split ${n}: ${key}`);
    }
  }
  assert.deepEqual(partialSolution(raw), answer);
  assert.equal(partialSolution('{"code":"print(\\"\\\\n').code, 'print("\\n');
  assert.equal(partialSolution('{"thoughts":["首段').thoughts[0], "首段");
});

test("prompt puts short Chinese explanation and complexity before complete code", () => {
  const prompt = solutionFormat("python", true);
  const keys = ['"thoughts"', '"time_complexity"', '"space_complexity"', '"code"', '"alternatives"', '"problem_statement"'];
  assert.deepEqual(keys.map(k => prompt.indexOf(k)), keys.map(k => prompt.indexOf(k)).sort((a, b) => a - b));
  assert.match(prompt, /完整 python 代码/);
  assert.match(prompt, /最多两项/);
});

test("SSE handles fragmented UTF-8, CRLF, multiline data and ignores unfinished events", async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\nevent: update\r\ndata: 中文😀\r\ndata: 下一行\r\n\r\ndata: truncated');
  const body = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const events = [];
  for await (const item of readSSE(body)) events.push(item);
  assert.deepEqual(events, [{ event: "update", data: "中文😀\n下一行" }]);
});

test("SSE yields first event before completion and aborts a stalled read", async () => {
  let input, cancelled = false;
  const body = new ReadableStream({ start(c) { input = c; }, cancel() { cancelled = true; } });
  const controller = new AbortController();
  const iterator = readSSE(body, controller.signal);
  const first = iterator.next();
  input.enqueue(encodeSSE({ text: "首段" }));
  assert.equal(JSON.parse((await first).value.data).text, "首段");
  const next = iterator.next();
  controller.abort(new Error("cancel fixture"));
  await assert.rejects(next, /cancel fixture/);
  assert.equal(cancelled, true);
});
