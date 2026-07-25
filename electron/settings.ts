import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

import {
  AI_PROVIDERS,
  AiModelPreset,
  AiProviderId,
  AiRuntimeConfig,
  ResponseLanguage,
  getAiProviderDefinition,
  isAiProviderId,
} from "./aiProviders";

interface StoredProviderSettings {
  encryptedApiKey?: string;
  plainApiKey?: string;
  model?: string;
  baseUrl?: string;
  supportsVision?: boolean;
}

interface StoredSettings {
  activeProvider?: AiProviderId;
  responseLanguage?: ResponseLanguage;
  providers?: Partial<Record<AiProviderId, StoredProviderSettings>>;
  // Legacy OpenAI-only fields, migrated when settings are next saved.
  encryptedApiKey?: string;
  plainApiKey?: string;
  model?: string;
}

export interface PublicProviderSettings {
  id: AiProviderId;
  label: string;
  hasApiKey: boolean;
  model: string;
  baseUrl: string;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  apiKeyPlaceholder: string;
  models: AiModelPreset[];
}

export interface PublicSettings {
  provider: AiProviderId;
  responseLanguage: ResponseLanguage;
  hasApiKey: boolean;
  model: string;
  baseUrl: string;
  supportsVision: boolean;
  supportsJsonMode: boolean;
  storageSecure: boolean;
  providers: PublicProviderSettings[];
}

export interface SaveAiSettingsInput {
  provider?: AiProviderId;
  responseLanguage?: ResponseLanguage;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  supportsVision?: boolean;
}

const ENV_PREFIXES: Record<AiProviderId, string[]> = {
  openai: ["OPENAI"],
  deepseek: ["DEEPSEEK"],
  kimi: ["KIMI", "MOONSHOT"],
  doubao: ["DOUBAO", "ARK"],
  qwen: ["QWEN", "DASHSCOPE"],
  glm: ["GLM", "ZHIPU"],
  gemini: ["GEMINI", "GOOGLE"],
  anthropic: ["ANTHROPIC"],
};

function firstEnvironmentValue(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function parseEnvironmentBoolean(value: string): boolean | undefined {
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return undefined;
}

function normalizeResponseLanguage(value: unknown): ResponseLanguage | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["zh", "zh-cn", "chinese", "中文"].includes(normalized)) return "zh-CN";
  if (["en", "en-us", "english", "英文"].includes(normalized)) return "en";
  return undefined;
}

function validateBaseUrl(value: string): string {
  const baseUrl = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Base URL must be a valid HTTP(S) URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Base URL must use HTTP or HTTPS.");
  }
  return baseUrl;
}

export class SettingsStore {
  private readonly settingsPath = path.join(
    app.getPath("userData"),
    "settings.json",
  );

  private read(): StoredSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Failed to read settings:", error);
      }
      return {};
    }
  }

  private migrate(settings: StoredSettings): StoredSettings {
    settings.providers ||= {};
    const legacyExists = Boolean(
      settings.encryptedApiKey || settings.plainApiKey || settings.model,
    );
    if (legacyExists) {
      settings.providers.openai ||= {};
      const openai = settings.providers.openai;
      openai.encryptedApiKey ||= settings.encryptedApiKey;
      openai.plainApiKey ||= settings.plainApiKey;
      openai.model ||= settings.model;
      delete settings.encryptedApiKey;
      delete settings.plainApiKey;
      delete settings.model;
    }
    return settings;
  }

  private write(settings: StoredSettings): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(this.settingsPath, 0o600);
  }

  private getStoredProvider(
    settings: StoredSettings,
    provider: AiProviderId,
  ): StoredProviderSettings {
    const current = settings.providers?.[provider] || {};
    if (provider !== "openai") return current;
    return {
      encryptedApiKey:
        current.encryptedApiKey || settings.encryptedApiKey || undefined,
      plainApiKey: current.plainApiKey || settings.plainApiKey || undefined,
      model: current.model || settings.model || undefined,
      baseUrl: current.baseUrl,
      supportsVision: current.supportsVision,
    };
  }

  private getProviderEnvironmentValue(
    provider: AiProviderId,
    suffix: "API_KEY" | "MODEL" | "BASE_URL" | "SUPPORTS_VISION",
  ): string {
    return firstEnvironmentValue(
      ENV_PREFIXES[provider].map((prefix) => `${prefix}_${suffix}`),
    );
  }

  public getActiveProvider(): AiProviderId {
    const environmentProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
    if (isAiProviderId(environmentProvider)) return environmentProvider;
    const storedProvider = this.read().activeProvider;
    return isAiProviderId(storedProvider) ? storedProvider : "openai";
  }

  public getApiKey(provider = this.getActiveProvider()): string {
    const environmentKey = this.getProviderEnvironmentValue(
      provider,
      "API_KEY",
    );
    if (environmentKey) return environmentKey;

    const providerSettings = this.getStoredProvider(this.read(), provider);
    if (
      providerSettings.encryptedApiKey &&
      safeStorage.isEncryptionAvailable()
    ) {
      try {
        return safeStorage.decryptString(
          Buffer.from(providerSettings.encryptedApiKey, "base64"),
        );
      } catch (error) {
        console.error(`Failed to decrypt the ${provider} API key:`, error);
      }
    }
    return providerSettings.plainApiKey?.trim() || "";
  }

  public getModel(provider = this.getActiveProvider()): string {
    const definition = getAiProviderDefinition(provider);
    const environmentModel =
      process.env.AI_MODEL?.trim() ||
      this.getProviderEnvironmentValue(provider, "MODEL");
    return (
      environmentModel ||
      this.getStoredProvider(this.read(), provider).model?.trim() ||
      definition.defaultModel
    );
  }

  public getBaseUrl(provider = this.getActiveProvider()): string {
    const definition = getAiProviderDefinition(provider);
    return (
      process.env.AI_BASE_URL?.trim() ||
      this.getProviderEnvironmentValue(provider, "BASE_URL") ||
      this.getStoredProvider(this.read(), provider).baseUrl?.trim() ||
      definition.defaultBaseUrl
    );
  }

  public getSupportsVision(provider = this.getActiveProvider()): boolean {
    const environmentValue =
      process.env.AI_SUPPORTS_VISION?.trim() ||
      this.getProviderEnvironmentValue(provider, "SUPPORTS_VISION");
    if (environmentValue) {
      const parsed = parseEnvironmentBoolean(environmentValue);
      if (parsed !== undefined) return parsed;
    }
    const stored = this.getStoredProvider(this.read(), provider).supportsVision;
    return stored ?? getAiProviderDefinition(provider).defaultSupportsVision;
  }

  public getResponseLanguage(): ResponseLanguage {
    return (
      normalizeResponseLanguage(process.env.AI_RESPONSE_LANGUAGE) ||
      normalizeResponseLanguage(this.read().responseLanguage) ||
      "zh-CN"
    );
  }

  public getRuntimeConfig(): AiRuntimeConfig {
    const provider = this.getActiveProvider();
    const definition = getAiProviderDefinition(provider);
    return {
      provider,
      providerLabel: definition.label,
      apiKey: this.getApiKey(provider),
      model: this.getModel(provider),
      baseUrl: this.getBaseUrl(provider),
      supportsVision: this.getSupportsVision(provider),
      supportsJsonMode: definition.supportsJsonMode,
      responseLanguage: this.getResponseLanguage(),
    };
  }

  private getPublicProvider(provider: AiProviderId): PublicProviderSettings {
    const definition = getAiProviderDefinition(provider);
    return {
      id: provider,
      label: definition.label,
      hasApiKey: Boolean(this.getApiKey(provider)),
      model: this.getModel(provider),
      baseUrl: this.getBaseUrl(provider),
      supportsVision: this.getSupportsVision(provider),
      supportsJsonMode: definition.supportsJsonMode,
      apiKeyPlaceholder: definition.apiKeyPlaceholder,
      models: definition.models,
    };
  }

  public getPublicSettings(): PublicSettings {
    const provider = this.getActiveProvider();
    const active = this.getPublicProvider(provider);
    return {
      provider,
      responseLanguage: this.getResponseLanguage(),
      hasApiKey: active.hasApiKey,
      model: active.model,
      baseUrl: active.baseUrl,
      supportsVision: active.supportsVision,
      supportsJsonMode: active.supportsJsonMode,
      storageSecure: safeStorage.isEncryptionAvailable(),
      providers: AI_PROVIDERS.map((item) => this.getPublicProvider(item.id)),
    };
  }

  public save(input: SaveAiSettingsInput): PublicSettings {
    const settings = this.migrate(this.read());
    const provider = isAiProviderId(input.provider)
      ? input.provider
      : this.getActiveProvider();
    const definition = getAiProviderDefinition(provider);
    settings.activeProvider = provider;
    const responseLanguage = normalizeResponseLanguage(input.responseLanguage);
    if (responseLanguage) settings.responseLanguage = responseLanguage;
    settings.providers ||= {};
    const providerSettings = (settings.providers[provider] ||= {});
    const apiKey = input.apiKey?.trim();

    if (apiKey) {
      if (safeStorage.isEncryptionAvailable()) {
        providerSettings.encryptedApiKey = safeStorage
          .encryptString(apiKey)
          .toString("base64");
        delete providerSettings.plainApiKey;
      } else {
        providerSettings.plainApiKey = apiKey;
        delete providerSettings.encryptedApiKey;
      }
    }

    if (input.model !== undefined) {
      providerSettings.model = input.model.trim() || definition.defaultModel;
    }
    if (input.baseUrl !== undefined) {
      providerSettings.baseUrl = validateBaseUrl(
        input.baseUrl || definition.defaultBaseUrl,
      );
    }
    if (typeof input.supportsVision === "boolean") {
      providerSettings.supportsVision = input.supportsVision;
    }

    this.write(settings);
    return this.getPublicSettings();
  }

  public clearApiKey(provider = this.getActiveProvider()): PublicSettings {
    const settings = this.migrate(this.read());
    settings.activeProvider = provider;
    settings.providers ||= {};
    const providerSettings = (settings.providers[provider] ||= {});
    delete providerSettings.encryptedApiKey;
    delete providerSettings.plainApiKey;
    this.write(settings);
    return this.getPublicSettings();
  }
}
