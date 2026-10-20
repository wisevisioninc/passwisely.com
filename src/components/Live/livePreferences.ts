import { useEffect, useState } from "react";

export type KeyDisplayMode = "icon" | "text";
export const LIVE_UI_PREFERENCES_KEY = "passwisely.liveUi.preferences.v1";
export const LIVE_UI_PREFERENCES_BACKUP_KEY = `${LIVE_UI_PREFERENCES_KEY}.before-key-display.bak`;
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

export function saveKeyDisplayMode(mode: unknown, storage?: PreferenceStorage): SaveKeyDisplayResult {
  if (mode !== "icon" && mode !== "text") return { success: false, error: "请选择有效的快捷键显示方式。" };
  try {
    const target = storage ?? browserStorage();
    const previous = target.getItem(LIVE_UI_PREFERENCES_KEY);
    const preferences = parsePreferences(previous);
    // Backup is immutable once created. If either read/backup fails, do not write
    // over the current preferences; unrelated and unknown fields stay intact.
    if (previous !== null && target.getItem(LIVE_UI_PREFERENCES_BACKUP_KEY) === null) {
      target.setItem(LIVE_UI_PREFERENCES_BACKUP_KEY, previous);
    }
    target.setItem(LIVE_UI_PREFERENCES_KEY, JSON.stringify({ ...preferences, keyDisplayMode: mode }));
    if (!storage && typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
    return { success: true, mode };
  } catch {
    return { success: false, error: "无法保存快捷键显示方式；原配置已保留，请重试。" };
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

/** Presentation only: unknown key labels and the caller's actual binding stay unchanged. */
export function formatShortcutKeys(keys: readonly string[], mode: KeyDisplayMode): string[] {
  return keys.map(key => KEY_NAMES[key]?.[mode === "text" ? 1 : 0] ?? key);
}
