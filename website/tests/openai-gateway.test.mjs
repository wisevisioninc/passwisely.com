import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
// Node 22 production does not enable native TypeScript imports by default.
const source = await readFile(new URL("../lib/openai-gateway.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { openAiBaseUrl, openAiChatOrigin, prepareOpenAiChatBody } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("server gateway URL accepts only explicit HTTPS destinations", () => {
  assert.equal(openAiChatOrigin(), "https://api.openai.com/v1/chat/completions");
  assert.equal(openAiChatOrigin(" https://wisepa.cn/v1/ "), "https://wisepa.cn/v1/chat/completions");
  for (const value of ["http://wisepa.cn/v1", "https://wisepa.cn.evil.test/v1", "https://user:secret@wisepa.cn/v1", "http://127.0.0.1/v1", "https://wisepa.cn/v1?key=x"]) {
    assert.throws(() => openAiBaseUrl(value));
  }
});

test("GPT-5.6 accepts legacy desktop token budgets without incompatible sampling options", () => {
  const source = {model:"gpt-5.6-sol", max_tokens:2048, temperature:0.2, top_p:0.8, messages:[{role:"user",content:"Two sum"}],stream:true};
  const result = prepareOpenAiChatBody(source);
  assert.equal(result.max_completion_tokens,2048);
  assert.equal(result.reasoning_effort,"low");
  assert.equal(result.stream,true);
  assert.equal(prepareOpenAiChatBody({...source, stream:false}).stream,false);
  assert.ok(!("max_tokens" in result));
  assert.ok(!("temperature" in result));
  assert.ok(!("top_p" in result));
  assert.equal(source.temperature,0.2);
  assert.equal(prepareOpenAiChatBody({...source,max_completion_tokens:4096,reasoning_effort:"high"}).max_completion_tokens,4096);
  assert.equal(prepareOpenAiChatBody({...source,reasoning_effort:"high"}).reasoning_effort,"high");
});

test("older OpenAI models retain their sampling controls", () => {
  const result=prepareOpenAiChatBody({model:"gpt-4o",max_tokens:64,temperature:0.2});
  assert.equal(result.max_tokens,64);
  assert.equal(result.temperature,0.2);
  assert.ok(!("reasoning_effort" in result));
});

test("personal keys retain official endpoint while default and resume use configured endpoint", async () => {
  const chat=await readFile(new URL("../app/api/ai/chat/completions/route.ts",import.meta.url),"utf8");
  const resume=await readFile(new URL("../app/api/resume/agents/route.ts",import.meta.url),"utf8");
  assert.match(chat,/if \(suppliedKey\)[\s\S]*origin = AI_PROVIDER_CATALOG\[provider\]\.origin/);
  assert.match(chat,/origin = configured\.origin/);
  assert.match(resume,/fetchModelProvider\(config\.provider, config\.origin/);
});
