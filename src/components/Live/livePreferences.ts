import { useEffect, useState } from "react";
import { DEFAULT_CODE_LANGUAGE, getCodeLanguage } from "../../../electron/languages";
import type { CodeLanguage } from "../../../electron/languages";
import { getPlatform } from "../../utils/platform";

export type KeyDisplayMode = "icon" | "text";
export const LIVE_UI_PREFERENCES_KEY = "passwisely.liveUi.preferences.v1";
export const LIVE_UI_PREFERENCES_BACKUP_KEY = `${LIVE_UI_PREFERENCES_KEY}.before-key-display.bak`;
export const LIVE_CODE_LANGUAGE_BACKUP_KEY = `${LIVE_UI_PREFERENCES_KEY}.before-code-language.bak`;
const CHANGE_EVENT = "passwisely:live-ui-preferences-changed";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export type SaveKeyDisplayResult = { success: true; mode: KeyDisplayMode } | { success: false; error: string };

function browserStorage(): PreferenceStorage {
  if (typeof window === "undefined") throw new Error("当前环境无法保存界面设置。");
  return window.localStorage;
}

function parsePreferences(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("界面设置格式无效，原配置已保留。");
  return value as Record<string, unknown>;
}

/** This namespace owns UI preferences only; it never reads native AI/Key storage. */
export function readKeyDisplayMode(storage?: PreferenceStorage): KeyDisplayMode {
  try {
    const value = parsePreferences((storage ?? browserStorage()).getItem(LIVE_UI_PREFERENCES_KEY));
    return value.keyDisplayMode === "text" ? "text" : "icon";
  } catch { return "icon"; }
}

function writePreference(field: "keyDisplayMode" | "codeLanguage", value: string, backupKey: string, storage?: PreferenceStorage): void {
  const target = storage ?? browserStorage();
  const previous = target.getItem(LIVE_UI_PREFERENCES_KEY);
  const preferences = parsePreferences(previous);
  // Each preference's first write owns an immutable backup. Never overwrite
  // malformed input or unrelated/future fields, including the other preference.
  if (previous !== null && target.getItem(backupKey) === null) target.setItem(backupKey, previous);
  target.setItem(LIVE_UI_PREFERENCES_KEY, JSON.stringify({ ...preferences, [field]: value }));
  if (!storage && typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function saveKeyDisplayMode(mode: unknown, storage?: PreferenceStorage): SaveKeyDisplayResult {
  if (mode !== "icon" && mode !== "text") return { success: false, error: "请选择有效的快捷键显示方式。" };
  try {
    writePreference("keyDisplayMode", mode, LIVE_UI_PREFERENCES_BACKUP_KEY, storage);
    return { success: true, mode };
  } catch {
    return { success: false, error: "无法保存快捷键显示方式；原配置已保留，请重试。" };
  }
}

export type CodeLanguagePreference = { language: CodeLanguage | null; error?: string };
export function readCodeLanguagePreference(storage?: PreferenceStorage): CodeLanguagePreference {
  try {
    const value = parsePreferences((storage ?? browserStorage()).getItem(LIVE_UI_PREFERENCES_KEY)).codeLanguage;
    if (value === undefined) return { language: DEFAULT_CODE_LANGUAGE };
    const language = getCodeLanguage(value);
    if (language) return { language: language.id };
    return { language: null, error: "已保存的代码语言无法识别；请明确选择有效语言后再生成回答。原配置已保留。" };
  } catch {
    return { language: null, error: "无法读取代码语言设置；请明确选择有效语言后再生成回答，原配置已保留。" };
  }
}
export function saveCodeLanguage(value: unknown, storage?: PreferenceStorage): { success: true; language: CodeLanguage } | { success: false; error: string } {
  const language = getCodeLanguage(value);
  if (!language) return { success: false, error: "请选择有效的代码语言。" };
  try {
    writePreference("codeLanguage", language.id, LIVE_CODE_LANGUAGE_BACKUP_KEY, storage);
    return { success: true, language: language.id };
  } catch {
    return { success: false, error: "无法保存代码语言；原配置已保留。" };
  }
}

export function useKeyDisplayMode(): KeyDisplayMode {
  const [mode, setMode] = useState<KeyDisplayMode>(() => readKeyDisplayMode());
  useEffect(() => {
    const refresh = () => setMode(readKeyDisplayMode());
    const storageChanged = (event: StorageEvent) => {
      if (event.key === LIVE_UI_PREFERENCES_KEY || event.key === null) refresh();
    };
    refresh();
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", storageChanged);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);
  return mode;
}

const KEY_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  "⌘": ["⌘", "Cmd"], Command: ["⌘", "Cmd"], Cmd: ["⌘", "Cmd"], CommandOrControl: ["⌘", "Cmd"],
  "⌃": ["⌃", "Ctrl"], Control: ["⌃", "Ctrl"], Ctrl: ["⌃", "Ctrl"],
  "⌥": ["⌥", "Option"], Alt: ["⌥", "Option"], Option: ["⌥", "Option"],
  "⇧": ["⇧", "Shift"], Shift: ["⇧", "Shift"],
  "↵": ["⏎", "Enter"], "⏎": ["⏎", "Enter"], Enter: ["⏎", "Enter"], Return: ["⏎", "Enter"],
  "↑": ["↑", "Up"], Up: ["↑", "Up"], "↓": ["↓", "Down"], Down: ["↓", "Down"],
  "←": ["←", "Left"], Left: ["←", "Left"], "→": ["→", "Right"], Right: ["→", "Right"],
  Escape: ["Esc", "Esc"], Esc: ["Esc", "Esc"],
};

/** Presentation only. Producers pass the actual accelerator token, including
 * CommandOrControl; explicit Command and unknown labels retain their meaning.
 */
export function formatShortcutKeys(keys: readonly string[], mode: KeyDisplayMode, platform = getPlatform()): string[] {
  return keys.map(key => {
    if (platform !== "darwin") {
      if (["CommandOrControl", "Control", "Ctrl", "⌃"].includes(key)) return "Ctrl";
      if (key === "Alt") return "Alt";
    }
    return KEY_NAMES[key]?.[mode === "text" ? 1 : 0] ?? key;
  });
}
