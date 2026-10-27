import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";
import * as sse from "../../shared/sse.mjs";
const { encodeSSE } = sse;
const source = relative => fileURLToPath(new URL(relative, import.meta.url));
const loadOwner = createProductionTsLoader();
const { KIMI_DEFAULT_MODEL, KIMI_MODEL_IDS, prepareKimiChatBody } = loadOwner(source("../../shared/kimi.ts"));

for (const model of KIMI_MODEL_IDS) test(`${model} uses the documented K3 request contract without mutating its caller`, () => {
  const messages = [{ role: "user", content: "Synthetic question" }];
  const original = { model, messages, max_tokens: 4096, response_format: { type: "json_object" }, stream: true,
    thinking: { type: "disabled" }, temperature: 0.3, top_p: 0.8, n: 2, presence_penalty: 1, frequency_penalty: 1 };
  const prepared = prepareKimiChatBody(original);
  assert.notEqual(prepared, original); assert.equal(prepared.messages, messages);
  assert.equal(prepared.model, model); assert.equal(prepared.reasoning_effort, "low");
  assert.equal(prepared.max_tokens, 4096); assert.equal(prepared.stream, true);
  assert.deepEqual(prepared.response_format, { type: "json_object" });
  for (const key of ["thinking", "temperature", "top_p", "n", "presence_penalty", "frequency_penalty"]) assert.ok(!(key in prepared), key);
  assert.equal(original.temperature, 0.3); assert.equal(original.n, 2);
  assert.equal(prepareKimiChatBody({ ...original, reasoning_effort: "high" }).reasoning_effort, "high");
});

test("unselected Kimi models retain their own request contract", () => {
  const body = { model: "kimi-k2.5", temperature: 0.6, thinking: { type: "disabled" } };
  assert.equal(prepareKimiChatBody(body), body);
});

function app({ streaming = false } = {}) {
  const requests = [], debits = [], usage = [];
  const config = { provider: "kimi", model: KIMI_DEFAULT_MODEL, apiKey: "synthetic-key", origin: "https://api.example.invalid/v1/chat/completions" };
  const mocks = {
    "cloudflare:workers": { env: {} },
    "../../shared/sse.mjs": sse,
    "@/lib/auth": { getApiUser: async () => ({ id: "synthetic-user" }), jsonError: (message, status) => Response.json({ error: message }, { status }) },
    "@/lib/ai-config": { getDefaultAiConfig: async () => config },
    "@/lib/supabase": {
      adminRpc: async (name, data) => { if (name === "consume_credits") { debits.push(data); return [{ success: true, balance: 1000 }]; } return 1000; },
      adminRest: async (name, init) => init?.method === "POST" ? [{ ...JSON.parse(init.body), id: "synthetic-row" }] : [],
    },
    "@/lib/admin-data": { recordUsage: async value => usage.push(value) },
    "@/lib/model-fetch": { fetchModelProvider: async (provider, origin, init) => {
      const body = JSON.parse(init.body); requests.push({ provider, origin, body });
      const result = { model: body.model, choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } };
      if (!streaming) return Response.json(result);
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(encodeSSE({ model: body.model, choices: [{ delta: { reasoning_content: "Synthetic reasoning" }, finish_reason: null }] }));
        c.enqueue(encodeSSE({ model: body.model, choices: [{ delta: { content: "OK" }, finish_reason: "stop" }], usage: result.usage }));
        c.enqueue(encodeSSE("[DONE]")); c.close();
      } }), { headers: { "content-type": "text/event-stream" } });
    } },
  };
  const load = createProductionTsLoader({ mocks });
  mocks["@/lib/ai-catalog"] = load(source("../lib/ai-catalog.ts"));
  mocks["@/lib/openai-gateway"] = load(source("../lib/openai-gateway.ts"));
  mocks["@/lib/chat-stream"] = load(source("../lib/chat-stream.ts"));
  return { config, requests, debits, usage, chat: load(source("../app/api/ai/chat/completions/route.ts")).POST, resume: load(source("../app/api/resume/agents/route.ts")).POST };
}

for (const streaming of [false, true]) test(`shared ${streaming ? "streaming" : "JSON"} chat upgrades old-client input, keeps token-budget billing and records the effective model`, async () => {
  const f = app({ streaming });
  const response = await f.chat(new Request("https://site.example.invalid/api/ai/chat/completions", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "kimi-k3", messages: [{ role: "user", content: "Synthetic public test" }], temperature: 0.6, thinking: { type: "disabled" }, max_tokens: 4096, stream: streaming }) }));
  assert.equal(response.status, 200);
  const output = await response.text(); assert.match(output, /OK/); assert.match(output, /kimi-k3\.1-pro/);
  assert.equal(f.requests.length, 1); const body = f.requests[0].body;
  assert.equal(body.model, KIMI_DEFAULT_MODEL); assert.equal(body.reasoning_effort, "low");
  assert.equal(body.temperature, undefined); assert.equal(body.thinking, undefined); assert.equal(body.stream, streaming);
  assert.equal(f.debits.length, 1); assert.ok(f.debits[0].p_cost > 1, "new Pro must not fall into fixed one-credit billing");
  assert.equal(f.usage.length, 1); assert.equal(f.usage[0].model, KIMI_DEFAULT_MODEL); assert.equal(f.usage[0].credits, f.debits[0].p_cost);
});

test("personal-key Pro request is allowlisted, normalized and never charged shared credits", async () => {
  const f = app();
  const response = await f.chat(new Request("https://site.example.invalid/api/ai/chat/completions", { method: "POST", headers: { "content-type": "application/json", "x-wise-provider": "kimi", "x-wise-provider-key": "synthetic-personal-key" }, body: JSON.stringify({ model: KIMI_DEFAULT_MODEL, messages: [{ role: "user", content: "Synthetic test" }], max_tokens: 128, temperature: 0.2 }) }));
  assert.equal(response.status, 200); await response.text();
  assert.equal(f.debits.length, 0); assert.equal(f.requests[0].origin, "https://api.moonshot.cn/v1/chat/completions");
  assert.equal(f.requests[0].body.temperature, undefined); assert.equal(f.requests[0].body.reasoning_effort, "low");
});

test("resume uses the same effective Pro request policy and persists its actual model", async () => {
  const f = app();
  const response = await f.resume(new Request("https://site.example.invalid/api/resume/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: "resume_opt_agent", resumeText: "Synthetic software engineer resume with public placeholder experience." }) }));
  assert.equal(response.status, 200);
  const body = f.requests[0].body;
  assert.equal(body.model, KIMI_DEFAULT_MODEL); assert.equal(body.reasoning_effort, "low"); assert.equal(body.temperature, undefined); assert.equal(body.thinking, undefined);
  assert.equal(f.usage[0].model, KIMI_DEFAULT_MODEL);
});
