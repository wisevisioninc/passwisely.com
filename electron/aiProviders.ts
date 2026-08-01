export const AI_PROVIDER_IDS = [
  "kimi",
  "glm",
  "qwen",
  "seed",
  "openai",
  "gemini",
  "anthropic",
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const RESPONSE_LANGUAGES = ["zh-CN", "en"] as const;
export type ResponseLanguage = (typeof RESPONSE_LANGUAGES)[number];

export interface AiModelPreset {
  id: string;
  label: string;
  supportsVision: boolean;
}

export interface AiProviderDefinition {
  id: AiProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultSupportsVision: boolean;
  supportsJsonMode: boolean;
  apiKeyPlaceholder: string;
  models: AiModelPreset[];
  route: "direct" | "wise";
  defaultKeyViaWise?: boolean;
}

export interface AiRuntimeConfig {
  provider: AiProviderId;
  providerLabel: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  responseLanguage: ResponseLanguage;
  route: "direct" | "wise";
  usesWiseDefaultKey: boolean;
  wiseAccessToken?: string;
}

export const AI_PROVIDERS: AiProviderDefinition[] = [
  {
    id: "openai",
    label: "ChatGPT",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    defaultSupportsVision: true,
    supportsJsonMode: true,
    apiKeyPlaceholder: "sk-...",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini", supportsVision: true },
      { id: "gpt-4o", label: "GPT-4o", supportsVision: true },
    ],
    route: "wise",
  },
  {
    id: "kimi",
    label: "Kimi / Moonshot",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k3",
    defaultSupportsVision: true,
    supportsJsonMode: true,
    apiKeyPlaceholder: "sk-...",
    models: [
      {
        id: "kimi-k3",
        label: "Kimi K3 · 1M context",
        supportsVision: true,
      },
      {
        id: "moonshot-v1-8k",
        label: "Moonshot v1 8K",
        supportsVision: false,
      },
      {
        id: "moonshot-v1-32k",
        label: "Moonshot v1 32K",
        supportsVision: false,
      },
      {
        id: "moonshot-v1-128k",
        label: "Moonshot v1 128K",
        supportsVision: false,
      },
      { id: "kimi-k2.5", label: "Kimi K2.5", supportsVision: true },
    ],
    route: "direct",
    defaultKeyViaWise: true,
  },
  {
    id: "seed",
    label: "Seed / Volcano Engine",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-1-6-250615",
    defaultSupportsVision: false,
    supportsJsonMode: true,
    apiKeyPlaceholder: "Ark API key",
    models: [
      {
        id: "doubao-seed-1-6-250615",
        label: "Doubao Seed 1.6",
        supportsVision: false,
      },
      {
        id: "doubao-seed-1-6-vision-250815",
        label: "Doubao Seed 1.6 Vision",
        supportsVision: true,
      },
    ],
    route: "direct",
  },
  {
    id: "qwen",
    label: "Qwen / DashScope",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.5-plus",
    defaultSupportsVision: false,
    supportsJsonMode: true,
    apiKeyPlaceholder: "sk-...",
    models: [
      { id: "qwen3.5-plus", label: "Qwen 3.5 Plus", supportsVision: true },
      { id: "qwen3.5-flash", label: "Qwen 3.5 Flash", supportsVision: true },
    ],
    route: "direct",
  },
  {
    id: "glm",
    label: "GLM / Zhipu",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    defaultSupportsVision: false,
    supportsJsonMode: true,
    apiKeyPlaceholder: "Zhipu API key",
    models: [
      { id: "glm-4-plus", label: "GLM-4 Plus", supportsVision: false },
      { id: "glm-4-air", label: "GLM-4 Air", supportsVision: false },
      { id: "glm-4v-plus", label: "GLM-4V Plus", supportsVision: true },
    ],
    route: "direct",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.5-flash",
    defaultSupportsVision: true,
    supportsJsonMode: true,
    apiKeyPlaceholder: "AIza...",
    models: [
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        supportsVision: true,
      },
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        supportsVision: true,
      },
    ],
    route: "wise",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    defaultBaseUrl: "https://api.anthropic.com/v1/",
    defaultModel: "claude-opus-5",
    defaultSupportsVision: true,
    supportsJsonMode: false,
    apiKeyPlaceholder: "sk-ant-...",
    models: [
      {
        id: "claude-opus-5",
        label: "Claude Opus 5",
        supportsVision: true,
      },
      {
        id: "claude-3-7-sonnet-20250219",
        label: "Claude 3.7 Sonnet",
        supportsVision: true,
      },
    ],
    route: "wise",
  },
];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return (
    typeof value === "string" &&
    (AI_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

export function getAiProviderDefinition(
  provider: AiProviderId,
): AiProviderDefinition {
  return AI_PROVIDERS.find((item) => item.id === provider) || AI_PROVIDERS[0];
}
