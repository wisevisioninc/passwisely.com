export const AI_PROVIDER_CATALOG = {
  kimi: {
    label: "Kimi / Moonshot",
    origin: "https://api.moonshot.cn/v1/chat/completions",
    keyEnvs: ["KIMI_API_KEY"],
    defaultModel: "kimi-k3",
    models: ["kimi-k3", "kimi-k2.5"],
  },
  openai: {
    label: "OpenAI",
    origin: "https://api.openai.com/v1/chat/completions",
    keyEnvs: ["OPENAI_API_KEY"],
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  anthropic: {
    label: "Anthropic Claude",
    origin: "https://api.anthropic.com/v1/messages",
    keyEnvs: ["ANTHROPIC_API_KEY"],
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
    keyEnvs: ["GEMINI_API_KEY"],
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
  qwen: {
    label: "Qwen / 阿里云百炼",
    origin:
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    keyEnvs: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    defaultModel: "qwen3.8-flash",
    models: ["qwen3.8-flash", "qwen3.5-flash", "qwen3.5-plus"],
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
