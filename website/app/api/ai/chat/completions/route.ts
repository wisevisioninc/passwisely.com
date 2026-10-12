import { getApiUser, jsonError } from "@/lib/auth";
import { adminRpc } from "@/lib/supabase";
import { recordUsage } from "@/lib/admin-data";
import {
  AI_PROVIDER_CATALOG,
  AiProvider,
  isAiProvider,
  isSafeModelName,
} from "@/lib/ai-catalog";
import { getDefaultAiConfig } from "@/lib/ai-config";
import { fetchModelProvider } from "@/lib/model-fetch";
import { prepareOpenAiChatBody } from "@/lib/openai-gateway";

import { chatStreamResponse } from "@/lib/chat-stream";

type Json = Record<string, unknown>;

// The cheapest pack sells one credit for ¥0.059. Valuing a credit at only
// ¥0.05 leaves margin for payment fees. K3 is priced conservatively at its
// non-cached input rate (¥20/M) and output rate (¥100/M).
function kimiK3MaximumCredits(body: Json): number {
  let textBytes = 0;
  let imageCount = 0;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const rawMessage of messages) {
    const content = (rawMessage as Json)?.content;
    if (typeof content === "string") {
      textBytes += new TextEncoder().encode(content).length;
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const rawPart of content) {
      const part = rawPart as Json;
      if (part.type === "text" && typeof part.text === "string") {
        textBytes += new TextEncoder().encode(part.text).length;
      } else if (part.type === "image_url") {
        imageCount += 1;
      }
    }
  }
  // Base64 bytes are transport encoding, not prompt tokens. Count text
  // conservatively and budget 4K tokens for each high-detail screenshot.
  const inputTokensUpperBound = textBytes + imageCount * 4096;
  const outputTokensUpperBound = Math.max(
    1,
    Math.min(100_000, Number(body.max_tokens) || 4096),
  );
  return Math.max(
    1,
    Math.ceil(
      (inputTokensUpperBound * 20 + outputTokensUpperBound * 100) / 50_000,
    ),
  );
}

function toAnthropic(body: Json): Json {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = messages
    .filter((message) => (message as Json)?.role === "system")
    .map((message) => (message as Json).content)
    .join("\n");
  return {
    model: body.model,
    system: system || undefined,
    messages: messages
      .filter((message) => (message as Json)?.role !== "system")
      .map((message) => {
        const item = message as Json;
        if (!Array.isArray(item.content)) return item;
        return {
          ...item,
          content: item.content.map((part) => {
            const block = part as Json;
            if (block.type !== "image_url") return block;
            const url = (block.image_url as Json)?.url;
            const match =
              typeof url === "string"
                ? /^data:([^;]+);base64,(.+)$/.exec(url)
                : null;
            return match
              ? {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: match[1],
                    data: match[2],
                  },
                }
              : block;
          }),
        };
      }),
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature,
    stream: body.stream === true,
  };
}

function fromAnthropic(payload: Json, model: string): Json {
  const content = Array.isArray(payload.content)
    ? payload.content
        .filter((part) => (part as Json)?.type === "text")
        .map((part) => (part as Json).text)
        .join("")
    : "";
  return {
    id: payload.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: payload.stop_reason === "max_tokens" ? "length" : "stop",
      },
    ],
    usage: {
      prompt_tokens: (payload.usage as Json)?.input_tokens || 0,
      completion_tokens: (payload.usage as Json)?.output_tokens || 0,
      total_tokens:
        Number((payload.usage as Json)?.input_tokens || 0) +
        Number((payload.usage as Json)?.output_tokens || 0),
    },
  };
}

export async function POST(request: Request) {
  const user = await getApiUser(request);
  if (!user) return jsonError("Authentication required.", 401);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 12 * 1024 * 1024) {
    return jsonError("AI request is too large.", 413);
  }
  const body = (await request.json().catch(() => null)) as Json | null;
  if (!body) return jsonError("Invalid AI request.", 400);
  const suppliedKey = request.headers.get("x-wise-provider-key")?.trim() || "";
  const requestedProvider = request.headers.get("x-wise-provider");
  const requestedModel = typeof body.model === "string" ? body.model : "";
  let provider: AiProvider;
  let model: string;
  let apiKey: string;
  let origin: string;
  if (suppliedKey) {
    if (!isAiProvider(requestedProvider)) {
      return jsonError("Unsupported AI provider.", 400);
    }
    const allowedModels = AI_PROVIDER_CATALOG[requestedProvider].models as readonly string[];
    if (!allowedModels.includes(requestedModel)) {
      return jsonError("Unsupported model.", 400);
    }
    provider = requestedProvider;
    model = requestedModel;
    apiKey = suppliedKey;
    origin = AI_PROVIDER_CATALOG[provider].origin;
  } else {
    const configured = await getDefaultAiConfig();
    provider = configured.provider;
    model = configured.model;
    apiKey = configured.apiKey;
    origin = configured.origin;
  }
  if (!isSafeModelName(model)) return jsonError("Unsupported model.", 400);
  if (!apiKey) return jsonError("The Wise model key is not configured.", 503);
  const streaming = body.stream === true;
  const effectiveBody: Json = { ...body, model, stream: streaming, ...(streaming ? { stream_options: { include_usage: true } } : {}) };

  let chargedCredits = 0;
  const suppliedRequestId = request.headers.get("x-wise-request-id") || "";
  const requestId = /^[a-zA-Z0-9_-]{16,80}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  if (!suppliedKey) {
    const cost =
      provider === "kimi" && model === "kimi-k3"
        ? kimiK3MaximumCredits(effectiveBody)
        : 1;
    const result = await adminRpc<
      Array<{ success: boolean; balance: number; duplicate: boolean }>
    >("consume_credits", {
      p_user_id: user.id,
      p_cost: cost,
      p_action: `ai_${provider}`,
      p_reference: `ai:${user.id}:${requestId}`,
    });
    if (!result[0]?.success) return jsonError("Not enough credits.", 402);
    chargedCredits = cost;
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (provider === "anthropic") {
    headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  // Disable K3's long reasoning phase for latency-sensitive desktop actions.
  // The current API requires temperature=0.6 when thinking is disabled.
  const upstreamBody =
    provider === "kimi" && model === "kimi-k3"
      ? { ...effectiveBody, temperature: 0.6, thinking: { type: "disabled" } }
      : provider === "qwen"
        ? { ...effectiveBody, enable_thinking: false, stream: streaming }
      : provider === "openai"
        ? prepareOpenAiChatBody(effectiveBody)
        : effectiveBody;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) controller.abort();
  const cleanup = () => request.signal.removeEventListener("abort", cancel);
  let streamingResponse = false;
  try {
  const upstream = await fetchModelProvider(provider, origin, {
    method: "POST",
    headers,
    signal: controller.signal,
    body: JSON.stringify(
      provider === "anthropic" ? toAnthropic(effectiveBody) : upstreamBody,
    ),
  }, 90_000);
  if (!upstream) return jsonError("Model provider is unavailable.", 502);

  if (streaming && upstream.ok) {
    if (!upstream.headers.get("content-type")?.includes("text/event-stream")) {
      await upstream.body?.cancel();
      return jsonError("该模型未返回流式响应。", 502);
    }
    streamingResponse = true;
    return chatStreamResponse(upstream, provider, model, controller, async (usage) => {
      await recordUsage({ userId: user.id, action: "ai_chat", provider, model,
        promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
        credits: chargedCredits, reference: `ai:${user.id}:${requestId}` });
    }, cleanup);
  }
  const payload = (await upstream.json().catch(() => ({}))) as Json;
  if (!upstream.ok) {
    const message =
      typeof (payload.error as Json)?.message === "string"
        ? String((payload.error as Json).message)
        : "Model provider request failed.";
    return jsonError(message, upstream.status === 504 ? 504 : upstream.status >= 500 ? 502 : upstream.status);
  }
  const normalized = provider === "anthropic" ? fromAnthropic(payload, model) : payload;
  const usage = (normalized.usage || {}) as Json;
  await recordUsage({
    userId: user.id,
    action: "ai_chat",
    provider,
    model,
    promptTokens: Number(usage.prompt_tokens || 0),
    completionTokens: Number(usage.completion_tokens || 0),
    credits: chargedCredits,
    reference: `ai:${user.id}:${requestId}`,
  }).catch(() => undefined);
  return Response.json(normalized);
  } finally { if (!streamingResponse) cleanup(); }
}
