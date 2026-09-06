import { env } from "cloudflare:workers";
import {
  AI_PROVIDER_CATALOG,
  AiProvider,
  isAiProvider,
  isSafeModelName,
} from "@/lib/ai-catalog";
import { decryptAdminSecret } from "@/lib/admin-secrets";
import { adminRest } from "@/lib/supabase";

export interface DefaultAiConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  source: "supabase" | "environment";
}

type Environment = Record<string, string | undefined>;
type SettingRow = { key: string; value: string };

let cachedConfig: { expiresAt: number; value: DefaultAiConfig } | null = null;

function runtimeEnv(): Environment {
  return env as unknown as Environment;
}

function environmentFallback(): DefaultAiConfig {
  const values = runtimeEnv();
  const requestedProvider = values.AI_DEFAULT_PROVIDER?.trim();
  const provider = isAiProvider(requestedProvider) ? requestedProvider : "kimi";
  const definition = AI_PROVIDER_CATALOG[provider];
  const requestedModel = values.AI_DEFAULT_MODEL?.trim();
  const model = isSafeModelName(requestedModel)
    ? requestedModel
    : definition.defaultModel;
  return {
    provider,
    model,
    apiKey: values[definition.keyEnv]?.trim() || "",
    source: "environment",
  };
}

export function invalidateDefaultAiConfig(): void {
  cachedConfig = null;
}

export async function getDefaultAiConfig(): Promise<DefaultAiConfig> {
  if (cachedConfig && cachedConfig.expiresAt > Date.now()) {
    return cachedConfig.value;
  }

  const fallback = environmentFallback();
  try {
    const rows = await adminRest<SettingRow[]>(
      "admin_settings?key=in.(ai_default_provider,ai_default_model,ai_default_api_key)&select=key,value",
    );
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const provider = isAiProvider(settings.ai_default_provider)
      ? settings.ai_default_provider
      : fallback.provider;
    const definition = AI_PROVIDER_CATALOG[provider];
    const model = isSafeModelName(settings.ai_default_model)
      ? settings.ai_default_model
      : provider === fallback.provider
        ? fallback.model
        : definition.defaultModel;
    const storedKey = settings.ai_default_api_key?.trim();
    const apiKey = storedKey
      ? (await decryptAdminSecret(storedKey)).trim()
      : runtimeEnv()[definition.keyEnv]?.trim() || "";
    const value: DefaultAiConfig = {
      provider,
      model,
      apiKey,
      source: rows.length ? "supabase" : "environment",
    };
    cachedConfig = { expiresAt: Date.now() + 10_000, value };
    return value;
  } catch {
    return fallback;
  }
}
