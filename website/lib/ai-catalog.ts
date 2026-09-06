export const AI_PROVIDER_CATALOG = {
  kimi: {
    label: "Kimi / Moonshot",
    origin: "https://api.moonshot.cn/v1/chat/completions",
    keyEnv: "KIMI_API_KEY",
    defaultModel: "kimi-k3",
    models: ["kimi-k3", "kimi-k2.5"],
  },
  openai: {
    label: "OpenAI",
    origin: "https://api.openai.com/v1/chat/completions",
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  anthropic: {
    label: "Anthropic Claude",
    origin: "https://api.anthropic.com/v1/messages",
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-20250514",
    models: [
      "claude-opus-5",
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
    ],
  },
  gemini: {
    label: "Google Gemini",
    origin:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    keyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
} as const;

export type AiProvider = keyof typeof AI_PROVIDER_CATALOG;

export const AI_PROVIDER_IDS = Object.keys(
  AI_PROVIDER_CATALOG,
) as AiProvider[];

export function isAiProvider(value: unknown): value is AiProvider {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(AI_PROVIDER_CATALOG, value)
  );
}

export function isSafeModelName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    /^[a-zA-Z0-9._:/-]+$/.test(value)
  );
}
