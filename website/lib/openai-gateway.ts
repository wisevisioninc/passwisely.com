const ALLOWED_BASES = new Set([
  "https://api.openai.com/v1",
  "https://wisepa.cn/v1",
]);

// Server-owned keys may use WisePA. Personal client keys must retain the
// catalog's official endpoint and must never be forwarded to this gateway.
export function openAiBaseUrl(value: string = ""): string {
  const base = value.trim().replace(/\/+$/, "") || "https://api.openai.com/v1";
  if (!ALLOWED_BASES.has(base)) throw new Error("Unsupported OpenAI API base URL.");
  return base;
}

export function openAiChatOrigin(value: string = ""): string {
  return `${openAiBaseUrl(value)}/chat/completions`;
}

export function prepareOpenAiChatBody(body: Record<string, unknown>): Record<string, unknown> {
  const prepared: Record<string, unknown> = { ...body, stream: false };
  if (typeof body.model === "string" && /^gpt-5(?:[.-]|$)/.test(body.model)) {
    // GPT-5 reasoning models use completion-token budgets, and do not accept
    // sampling controls with all reasoning modes. Keep legacy desktop clients compatible.
    const budget = body.max_completion_tokens ?? body.max_tokens;
    if (typeof budget === "number") prepared.max_completion_tokens = budget;
    delete prepared.max_tokens;
    delete prepared.temperature;
    delete prepared.top_p;
    prepared.reasoning_effort = body.reasoning_effort ?? "low";
  }
  return prepared;
}
