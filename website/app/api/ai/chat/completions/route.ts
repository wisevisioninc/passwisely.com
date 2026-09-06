import { env } from "cloudflare:workers";
import { getApiUser, jsonError } from "@/lib/auth";
import { adminRpc } from "@/lib/supabase";
import { recordUsage } from "@/lib/admin-data";

type Provider = "openai" | "anthropic" | "gemini" | "kimi";
type Json = Record<string, unknown>;

const PROVIDERS: Record<
  Provider,
  { origin: string; keyEnv: string; models: Set<string> }
> = {
  openai: {
    origin: "https://api.openai.com/v1/chat/completions",
    keyEnv: "OPENAI_API_KEY",
    models: new Set(["gpt-4o-mini", "gpt-4o"]),
  },
  anthropic: {
    origin: "https://api.anthropic.com/v1/messages",
    keyEnv: "ANTHROPIC_API_KEY",
    models: new Set([
      "claude-opus-5",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
    ]),
  },
  gemini: {
    origin:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    keyEnv: "GEMINI_API_KEY",
    models: new Set(["gemini-2.5-flash", "gemini-2.5-pro"]),
  },
  kimi: {
    origin: "https://api.moonshot.cn/v1/chat/completions",
    keyEnv: "KIMI_API_KEY",
    models: new Set(["kimi-k3"]),
  },
};

// The cheapest pack sells one credit for ¥0.059. Valuing a credit at only
// ¥0.05 leaves margin for payment fees. K3 is priced conservatively at its
// non-cached input rate (¥20/M) and output rate (¥100/M).
function kimiK3MaximumCredits(body: Json): number {
  const serializedInput = JSON.stringify(body.messages || []);
  const inputTokensUpperBound = new TextEncoder().encode(serializedInput).length;
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

function environment(): Record<string, string | undefined> {
  return env as unknown as Record<string, string | undefined>;
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
    stream: false,
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
  const provider = request.headers.get("x-wise-provider") as Provider | null;
  const definition = provider ? PROVIDERS[provider] : undefined;
  if (!provider || !definition) return jsonError("Unsupported AI provider.", 400);

  const body = (await request.json().catch(() => null)) as Json | null;
  const model = typeof body?.model === "string" ? body.model : "";
  if (!body || !definition.models.has(model)) {
    return jsonError("Unsupported model.", 400);
  }

  const suppliedKey = request.headers.get("x-wise-provider-key")?.trim() || "";
  const apiKey = suppliedKey || environment()[definition.keyEnv]?.trim() || "";
  if (!apiKey) return jsonError("The Wise model key is not configured.", 503);

  let chargedCredits = 0;
  const suppliedRequestId = request.headers.get("x-wise-request-id") || "";
  const requestId = /^[a-zA-Z0-9_-]{16,80}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  if (!suppliedKey) {
    const cost =
      provider === "kimi" && model === "kimi-k3"
        ? kimiK3MaximumCredits(body)
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

  // Kimi K3 currently accepts temperature=1 only. Desktop actions use lower
  // temperatures for other providers, so normalize K3 requests at the relay.
  const upstreamBody =
    provider === "kimi" && model === "kimi-k3"
      ? { ...body, temperature: 1 }
      : body;
  const upstream = await fetch(definition.origin, {
    method: "POST",
    headers,
    body: JSON.stringify(
      provider === "anthropic" ? toAnthropic(body) : upstreamBody,
    ),
    signal: AbortSignal.timeout(90_000),
  }).catch(() => null);
  if (!upstream) return jsonError("Model provider is unavailable.", 502);

  const payload = (await upstream.json().catch(() => ({}))) as Json;
  if (!upstream.ok) {
    const message =
      typeof (payload.error as Json)?.message === "string"
        ? String((payload.error as Json).message)
        : "Model provider request failed.";
    return jsonError(message, upstream.status >= 500 ? 502 : upstream.status);
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
}
