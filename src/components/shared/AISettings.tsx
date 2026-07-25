import React, { useEffect, useId, useState } from "react";
import type {
  AiProviderId,
  ResponseLanguage,
} from "../../../electron/aiProviders";
import { getAiProviderDefinition } from "../../../electron/aiProviders";
import type {
  PublicProviderSettings,
  PublicSettings,
} from "../../../electron/settings";
import { useToast } from "../../contexts/toast";

export const AISettings: React.FC = () => {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const modelListId = useId();
  const { showToast } = useToast();

  useEffect(() => {
    window.electronAPI
      .getAiSettings()
      .then(setSettings)
      .catch((error) => {
        console.error("Failed to load AI settings:", error);
        showToast(
          "Settings error",
          "Could not load AI provider settings.",
          "error",
        );
      });
  }, [showToast]);

  const activeProvider = settings?.providers.find(
    (provider) => provider.id === settings.provider,
  );

  const selectProvider = (providerId: AiProviderId) => {
    setApiKey("");
    setSettings((current) => {
      if (!current) return current;
      const selected = current.providers.find(
        (provider) => provider.id === providerId,
      );
      if (!selected) return current;
      return {
        ...current,
        provider: providerId,
        hasApiKey: selected.hasApiKey,
        model: selected.model,
        baseUrl: selected.baseUrl,
        supportsVision: selected.supportsVision,
        supportsJsonMode: selected.supportsJsonMode,
      };
    });
  };

  const updateActiveProvider = (patch: Partial<PublicProviderSettings>) => {
    setSettings((current) => {
      if (!current) return current;
      const providers = current.providers.map((provider) =>
        provider.id === current.provider ? { ...provider, ...patch } : provider,
      );
      const selected = providers.find(
        (provider) => provider.id === current.provider,
      );
      if (!selected) return current;
      return {
        ...current,
        hasApiKey: selected.hasApiKey,
        model: selected.model,
        baseUrl: selected.baseUrl,
        supportsVision: selected.supportsVision,
        supportsJsonMode: selected.supportsJsonMode,
        providers,
      };
    });
  };

  const updateModel = (model: string) => {
    const preset = activeProvider?.models.find((item) => item.id === model);
    updateActiveProvider({
      model,
      ...(preset ? { supportsVision: preset.supportsVision } : {}),
    });
  };

  const save = async () => {
    if (!settings || !activeProvider) return;
    setSaving(true);
    try {
      const result = await window.electronAPI.saveAiSettings({
        provider: settings.provider,
        responseLanguage: settings.responseLanguage,
        apiKey: apiKey || undefined,
        model: activeProvider.model,
        baseUrl: activeProvider.baseUrl,
        supportsVision: activeProvider.supportsVision,
      });
      if (!result.success || !result.settings) {
        throw new Error(result.error || "Save failed");
      }
      setSettings(result.settings);
      setApiKey("");
      showToast(
        "Settings saved",
        `${activeProvider.label} is ready to use.`,
        "success",
      );
    } catch (error) {
      showToast(
        "Settings error",
        error instanceof Error ? error.message : "Could not save settings.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!settings) return;
    const result = await window.electronAPI.clearApiKey(settings.provider);
    if (result.success && result.settings) {
      setSettings(result.settings);
      setApiKey("");
      showToast(
        "API key cleared",
        "Add a new key before using this provider.",
        "neutral",
      );
    } else {
      showToast("Settings error", result.error || "Clear failed", "error");
    }
  };

  if (!settings || !activeProvider) {
    return <div className="px-2 text-[10px] text-white/50">Loading AI settings…</div>;
  }

  const defaultDefinition = getAiProviderDefinition(settings.provider);

  return (
    <div className="space-y-2 px-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium">AI provider</span>
        <span
          className={`text-[10px] ${
            activeProvider.hasApiKey ? "text-green-300" : "text-amber-300"
          }`}
        >
          {activeProvider.hasApiKey ? "Configured" : "Key required"}
        </span>
      </div>

      <select
        value={settings.provider}
        onChange={(event) =>
          selectProvider(event.target.value as AiProviderId)
        }
        className="w-full rounded bg-gray-900 px-2 py-1.5 text-[11px] outline-none"
      >
        {settings.providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.label}
          </option>
        ))}
      </select>

      <div>
        <label className="mb-1 block text-[9px] text-white/50">
          Answer language
        </label>
        <select
          value={settings.responseLanguage}
          onChange={(event) =>
            setSettings((current) =>
              current
                ? {
                    ...current,
                    responseLanguage: event.target.value as ResponseLanguage,
                  }
                : current,
            )
          }
          className="w-full rounded bg-gray-900 px-2 py-1.5 text-[11px] outline-none"
        >
          <option value="zh-CN">中文（默认）</option>
          <option value="en">English</option>
        </select>
        <p className="mt-1 text-[9px] leading-relaxed text-white/40">
          中文模式下说明和答案使用中文，代码与技术标识可保留英文。
        </p>
      </div>

      <input
        type="password"
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
        placeholder={
          activeProvider.hasApiKey
            ? "Enter a replacement key"
            : activeProvider.apiKeyPlaceholder
        }
        autoComplete="off"
        aria-label={`${activeProvider.label} API key`}
        className="w-full rounded bg-white/10 px-2 py-1.5 text-[11px] outline-none focus:ring-1 focus:ring-blue-400/70"
      />

      <div>
        <label className="mb-1 block text-[9px] text-white/50">Model</label>
        <input
          type="text"
          list={modelListId}
          value={activeProvider.model}
          onChange={(event) => updateModel(event.target.value)}
          placeholder="Enter a model or deployment ID"
          className="w-full rounded bg-white/10 px-2 py-1.5 text-[11px] outline-none focus:ring-1 focus:ring-blue-400/70"
        />
        <datalist id={modelListId}>
          {activeProvider.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </datalist>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[9px] text-white/50">OpenAI-compatible Base URL</label>
          {activeProvider.baseUrl !== defaultDefinition.defaultBaseUrl && (
            <button
              type="button"
              onClick={() =>
                updateActiveProvider({
                  baseUrl: defaultDefinition.defaultBaseUrl,
                })
              }
              className="text-[9px] text-blue-300 hover:text-blue-200"
            >
              Reset
            </button>
          )}
        </div>
        <input
          type="url"
          value={activeProvider.baseUrl}
          onChange={(event) =>
            updateActiveProvider({ baseUrl: event.target.value })
          }
          spellCheck={false}
          className="w-full rounded bg-white/10 px-2 py-1.5 text-[10px] outline-none focus:ring-1 focus:ring-blue-400/70"
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded bg-white/5 px-2 py-1.5">
        <input
          type="checkbox"
          checked={activeProvider.supportsVision}
          onChange={(event) =>
            updateActiveProvider({ supportsVision: event.target.checked })
          }
          className="mt-0.5"
        />
        <span className="text-[9px] leading-relaxed text-white/70">
          This model accepts screenshots/images. Disable this for text-only
          models to prevent unsupported image requests.
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded bg-blue-500/70 px-2 py-1 text-[10px] hover:bg-blue-500/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {activeProvider.hasApiKey && (
          <button
            type="button"
            onClick={clear}
            className="rounded bg-white/10 px-2 py-1 text-[10px] hover:bg-white/20"
          >
            Clear key
          </button>
        )}
      </div>

      <p className="text-[9px] leading-relaxed text-white/50">
        {settings.storageSecure
          ? "Keys are stored separately for each provider and encrypted with the operating system credential store."
          : "System encryption is unavailable; keys are stored in the app data directory with restricted permissions."}
        {!activeProvider.supportsJsonMode &&
          " This provider uses prompt-based JSON output compatibility."}
      </p>
      <p className="text-[9px] leading-relaxed text-white/40">
        Model IDs and endpoints are editable for new models, private gateways,
        and deployment-specific IDs such as Volcengine Ark endpoints.
      </p>
    </div>
  );
};
