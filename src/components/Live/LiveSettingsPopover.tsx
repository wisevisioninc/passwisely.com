import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { CODE_LANGUAGES, OUTPUT_LANGUAGES, getCodeLanguage, getOutputLanguage } from "../../../electron/languages";
import type { CodeLanguage, OutputLanguageId } from "../../../electron/languages";
import type { CaptureStatus } from "../../../electron/live/types";
import type { OverlayDisplay, OverlayGeometry } from "../../../electron/live/overlayTypes";
import { getTranscriptionProfile, TRANSCRIPTION_PROFILES } from "../../../electron/live/transcription";
import type { TranscriptionProfileId } from "../../../electron/live/transcription";
import { formatShortcutKeys, saveKeyDisplayMode, useKeyDisplayMode } from "./livePreferences";
import { directSettingsWrite } from "../shared/settingsWrites";
import type { SettingsWriteRunner } from "../shared/settingsWrites";
import "./settingsPopover.css";

type OutputLanguage = OutputLanguageId;
export type LiveCodeLanguage = CodeLanguage;
type SettingsApi = Pick<Window["electronAPI"], "getAiSettings" | "saveAiSettings" | "getTranscriptionSettings" | "saveTranscriptionSettings" | "accountOpenPortal"> & {
  getOverlayDisplays: () => Promise<OverlayDisplay[]>;
  selectOverlayDisplay: (id: number) => Promise<OverlayGeometry | null>;
};
type Action = () => void | Promise<void>;
export interface LiveSettingsPopoverProps {
  currentLanguage: string;
  onLanguageChange: (language: LiveCodeLanguage) => void;
  captureStatus: CaptureStatus;
  captureNeedsCleanup?: boolean;
  answerBusy?: boolean;
  writeBusy?: boolean;
  runSettingsWrite?: SettingsWriteRunner;
  credits: number;
  onClose: () => void;
  onOpenAdvanced: Action;
  onOpenResume: Action;
  onOpenProgramming: Action;
  onOpenShortcuts: Action;
  onLogout: Action;
  onQuit: Action;
  returnFocusRef?: RefObject<HTMLElement>;
  autoFocus?: boolean;
  placement?: "above" | "below";
  maxHeight?: number;
  api?: SettingsApi;
}

const errorMessage = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;
const outputLanguage = (value: unknown): OutputLanguage | null => getOutputLanguage(value)?.id ?? null;
export function isSpeechSelectionLocked(status: CaptureStatus, needsCleanup = false): boolean {
  return needsCleanup || !["idle", "ended", "error"].includes(status);
}

export function LiveKeycaps({ keys }: { keys: readonly string[] }) {
  const mode = useKeyDisplayMode();
  return <span className="pw-live-keycaps" data-key-display={mode} aria-hidden="true">{formatShortcutKeys(keys, mode).map((key, index) => <kbd key={`${index}:${key}`}>{key}</kbd>)}</span>;
}

function ShortcutRow({ label, keys }: { label: string; keys: readonly string[] }) {
  return <div className="pw-settings-shortcut"><span>{label}</span><LiveKeycaps keys={keys} /></div>;
}

/** A compact non-modal dialog. Native selects retain their own arrow-key behavior. */
export function LiveSettingsPopover({ currentLanguage, onLanguageChange, captureStatus, captureNeedsCleanup = false, answerBusy = false, writeBusy = false, runSettingsWrite = directSettingsWrite, credits,
  onClose, onOpenAdvanced, onOpenResume, onOpenProgramming, onOpenShortcuts, onLogout, onQuit,
  returnFocusRef, autoFocus = false, placement = "below", maxHeight, api = window.electronAPI }: LiveSettingsPopoverProps) {
  const titleId = useId();
  const speechHintId = useId();
  const outputHintId = useId();
  const root = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const deferredLoad = useRef<(() => void) | null>(null);
  const writeBusyRef = useRef(writeBusy);
  writeBusyRef.current = writeBusy;
  const locks = useRef({ output: false, speech: false, display: false });
  const [output, setOutput] = useState<OutputLanguage | "">("");
  const [speech, setSpeech] = useState<TranscriptionProfileId | "">("");
  const [displays, setDisplays] = useState<OverlayDisplay[]>([]);
  const [busy, setBusy] = useState({ output: false, speech: false, display: false });
  const [errors, setErrors] = useState({ output: "", speech: "", display: "", preferences: "", action: "" });
  const [notices, setNotices] = useState({ output: "", speech: "", display: "" });
  const [reload, setReload] = useState(0);
  const mode = useKeyDisplayMode();
  const answerBusyRef = useRef(answerBusy);
  answerBusyRef.current = answerBusy;
  const speechLocked = isSpeechSelectionLocked(captureStatus, captureNeedsCleanup);
  const speechLockedRef = useRef(speechLocked);
  speechLockedRef.current = speechLocked;

  useEffect(() => {
    let current = true;
    mounted.current = true;
    setOutput(""); setSpeech(""); setDisplays([]);
    setErrors({ output: "", speech: "", display: "", preferences: "", action: "" });
    const load = () => {
      void api.getAiSettings().then(value => {
        const parsed = outputLanguage(value?.responseLanguage);
        if (!parsed) throw new Error("无法识别已保存的回答语言。");
        if (current) setOutput(parsed);
      }).catch(reason => { if (current) setErrors(previous => ({ ...previous, output: errorMessage(reason, "无法加载回答语言。") })); });
      void api.getTranscriptionSettings().then(value => {
        const parsed = getTranscriptionProfile(value?.profileId);
        if (!parsed) throw new Error("无法识别已保存的语音设置。");
        if (current) setSpeech(parsed.id);
      }).catch(reason => { if (current) setErrors(previous => ({ ...previous, speech: errorMessage(reason, "无法加载语音设置。") })); });
      void api.getOverlayDisplays().then(value => {
        if (current) setDisplays(value);
      }).catch(reason => { if (current) setErrors(previous => ({ ...previous, display: errorMessage(reason, "无法加载显示器列表。") })); });
    };
    // A reopened popover must not snapshot pre-save values while a prior
    // instance's native write is still owned by the workspace gate.
    if (writeBusyRef.current) deferredLoad.current = load; else load();
    return () => { current = false; mounted.current = false; deferredLoad.current = null; };
  }, [api, reload]);
  useEffect(() => {
    if (!writeBusy) { const load = deferredLoad.current; deferredLoad.current = null; load?.(); }
  }, [writeBusy]);

  useEffect(() => {
    if (autoFocus) root.current?.querySelector<HTMLElement>("[data-settings-control]:not(:disabled)")?.focus({ preventScroll: true });
  }, [autoFocus]);
  useEffect(() => {
    const panel = root.current;
    return () => {
      if (panel?.contains(document.activeElement)) returnFocusRef?.current?.focus({ preventScroll: true });
    };
  }, [returnFocusRef]);

  const changeOutput = async (value: unknown) => {
    const requested = outputLanguage(value);
    if (!requested || !output || requested === output || locks.current.output || locks.current.speech || writeBusyRef.current || answerBusyRef.current) return;
    locks.current.output = true;
    setBusy(previous => ({ ...previous, output: true }));
    setErrors(previous => ({ ...previous, output: "" })); setNotices(previous => ({ ...previous, output: "" }));
    try {
      // Send the owned field only; preserve provider, model, API Key and speech.
      const result = await runSettingsWrite(() => api.saveAiSettings({ responseLanguage: requested }));
      if (!result.success) throw new Error(result.error || "无法保存回答语言。");
      if (outputLanguage(result.settings?.responseLanguage) !== requested) throw new Error("服务返回了不同的回答语言，请重新加载确认。");
      if (mounted.current) { setOutput(requested); setNotices(previous => ({ ...previous, output: "Saved" })); }
    } catch (reason) { if (mounted.current) setErrors(previous => ({ ...previous, output: errorMessage(reason, "无法保存回答语言。") })); }
    finally { locks.current.output = false; if (mounted.current) setBusy(previous => ({ ...previous, output: false })); }
  };
  const changeSpeech = async (value: unknown) => {
    const requested = getTranscriptionProfile(value);
    if (!requested || !speech || requested.id === speech || locks.current.speech || locks.current.output || writeBusyRef.current || speechLockedRef.current) return;
    locks.current.speech = true;
    setBusy(previous => ({ ...previous, speech: true }));
    setErrors(previous => ({ ...previous, speech: "" })); setNotices(previous => ({ ...previous, speech: "" }));
    try {
      const result = await runSettingsWrite(() => api.saveTranscriptionSettings({ profileId: requested.id }));
      if (!result.success) throw new Error(result.error || "无法保存语音设置。");
      if (getTranscriptionProfile(result.settings?.profileId)?.id !== requested.id) throw new Error("服务返回了不同的语音设置，请重新加载确认。");
      if (mounted.current) { setSpeech(requested.id); setNotices(previous => ({ ...previous, speech: "Saved · 下次新会话生效" })); }
    } catch (reason) { if (mounted.current) setErrors(previous => ({ ...previous, speech: errorMessage(reason, "无法保存语音设置。") })); }
    finally { locks.current.speech = false; if (mounted.current) setBusy(previous => ({ ...previous, speech: false })); }
  };
  const changeDisplay = async (id: number) => {
    if (!Number.isSafeInteger(id) || locks.current.display || !displays.some(display => display.id === id && !display.selected)) return;
    locks.current.display = true;
    setBusy(previous => ({ ...previous, display: true }));
    setErrors(previous => ({ ...previous, display: "" })); setNotices(previous => ({ ...previous, display: "" }));
    try {
      await api.selectOverlayDisplay(id);
      // null may mean native geometry is still settling. Inventory owns the
      // selected fact; don't infer failure or success from geometry readiness.
      const next = await api.getOverlayDisplays();
      if (mounted.current) setDisplays(next);
      if (!next.some(display => display.id === id && display.selected)) throw new Error("显示器尚未切换，请重试。");
      if (mounted.current) setNotices(previous => ({ ...previous, display: "Display switched" }));
    } catch (reason) { if (mounted.current) setErrors(previous => ({ ...previous, display: errorMessage(reason, "无法切换显示器。") })); }
    finally { locks.current.display = false; if (mounted.current) setBusy(previous => ({ ...previous, display: false })); }
  };
  const openPanel = async (callback: Action, allowDuringSave = false) => {
    if (!allowDuringSave && (locks.current.output || locks.current.speech || writeBusyRef.current)) {
      setErrors(previous => ({ ...previous, action: "设置正在保存，完成后可打开其他设置面板。" })); return;
    }
    setErrors(previous => ({ ...previous, action: "" }));
    try { await callback(); if (mounted.current) onClose(); }
    catch (reason) { if (mounted.current) setErrors(previous => ({ ...previous, action: errorMessage(reason, "操作失败，请重试。") })); }
  };
  const openDashboard = async () => {
    setErrors(previous => ({ ...previous, action: "" }));
    try { await api.accountOpenPortal(); if (mounted.current) onClose(); }
    catch (reason) { if (mounted.current) setErrors(previous => ({ ...previous, action: errorMessage(reason, "无法打开账户页面。") })); }
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); onClose(); returnFocusRef?.current?.focus({ preventScroll: true }); return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("select,input,textarea,[contenteditable='true']")) return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const controls = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-settings-control]:not(:disabled)") ?? []);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? controls.length - 1
      : event.key === "ArrowDown" ? (index + 1) % controls.length : (index <= 0 ? controls.length : index) - 1;
    event.preventDefault(); event.stopPropagation(); controls[next].focus({ preventScroll: true });
  };
  const status = (kind: "output" | "speech" | "display") => <>
    {busy[kind] && <p className="pw-settings-status" role="status">{kind === "display" ? "Switching display…" : "Saving…"}</p>}
    {errors[kind] && <p className="pw-settings-error" role="alert">{errors[kind]}</p>}
    {notices[kind] && <p className="pw-settings-status" role="status">{notices[kind]}</p>}
  </>;

  const settingsWriteBusy = busy.output || busy.speech || writeBusy;
  return <div ref={root} className="pw-settings-popover" role="dialog" aria-modal="false" aria-labelledby={titleId}
    data-placement={placement} style={{ top: placement === "below" ? "calc(100% + 8px)" : "auto", bottom: placement === "above" ? "calc(100% + 8px)" : "auto", maxHeight }}
    data-overlay-interactive tabIndex={-1} onKeyDown={keyboard}>
    <h2 id={titleId} className="pw-settings-title">Settings</h2>
    <div className="pw-settings-section pw-settings-languages">
      <label>Output Language<select data-settings-control aria-label="Output Language" aria-describedby={answerBusy ? outputHintId : undefined} value={output} disabled={!output || settingsWriteBusy || answerBusy}
        onChange={event => void changeOutput(event.target.value)}>
        {!output && <option value="" disabled>Loading…</option>}{OUTPUT_LANGUAGES.map(language => <option key={language.id} value={language.id}>{language.label}</option>)}
      </select></label>{status("output")}
      {answerBusy && <p id={outputHintId} className="pw-settings-hint">回答生成完成后可更改回答语言。</p>}
      <label>Code Language<select data-settings-control aria-label="Code Language" value={getCodeLanguage(currentLanguage)?.id ?? ""}
        onChange={event => { const language = getCodeLanguage(event.target.value); if (language) onLanguageChange(language.id); }}>
        {!getCodeLanguage(currentLanguage) && <option value="" disabled>Select language</option>}
        {CODE_LANGUAGES.map(language => <option key={language.id} value={language.id}>{language.label}</option>)}
      </select></label>
      <label>Meeting Audio Language<select data-settings-control aria-label="Meeting Audio Language" aria-describedby={speechHintId} value={speech}
        disabled={!speech || settingsWriteBusy || speechLocked} onChange={event => void changeSpeech(event.target.value)}>
        {!speech && <option value="" disabled>Loading…</option>}{TRANSCRIPTION_PROFILES.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
      </select></label>{status("speech")}
      <p id={speechHintId} className="pw-settings-hint">{speechLocked ? "当前音频会话中无法更改。" : "选择后保存，仅对下次新会话生效。"}</p>
      {speech === "recall-zh" && <p className="pw-settings-hint">实验模式，分钟级转录，不适合实时问答。</p>}
      {displays.length > 1 && <label>Display<select data-settings-control aria-label="Display" value={displays.find(display => display.selected)?.id ?? ""}
        disabled={busy.display} onChange={event => void changeDisplay(Number(event.target.value))}>
        {!displays.some(display => display.selected) && <option value="" disabled>Select display</option>}
        {displays.map(display => <option key={display.id} value={display.id}>{display.label}{display.isPrimary ? " (Primary)" : ""}{display.selected ? " · Current" : ""}</option>)}
      </select></label>}{status("display")}
      {(errors.output || errors.speech || errors.display) && <button data-settings-control type="button" className="pw-settings-button pw-settings-reload"
        disabled={busy.output || busy.speech || busy.display} onClick={() => { setNotices({ output: "", speech: "", display: "" }); setReload(value => value + 1); }}>Reload settings</button>}
    </div>
    <div className="pw-settings-section pw-settings-advanced"><button data-settings-control type="button" className="pw-settings-button pw-settings-open" disabled={settingsWriteBusy}
      onClick={() => void openPanel(onOpenAdvanced)}><span><strong>AI Models &amp; Settings</strong><small>模型、连接与语音设置</small></span><span>Open</span></button>
      {settingsWriteBusy && <p className="pw-settings-hint">设置正在保存，完成后可打开高级设置。</p>}</div>
    <hr className="pw-settings-separator" />
    <div className="pw-settings-key-mode"><span>Key Display:</span><div role="group" aria-label="Key Display">
      <button data-settings-control type="button" aria-label="Icon mode" aria-pressed={mode === "icon"} onClick={() => { const result = saveKeyDisplayMode("icon"); setErrors(previous => ({ ...previous, preferences: result.success ? "" : result.error })); }}>⌘</button>
      <button data-settings-control type="button" aria-label="Text mode" aria-pressed={mode === "text"} onClick={() => { const result = saveKeyDisplayMode("text"); setErrors(previous => ({ ...previous, preferences: result.success ? "" : result.error })); }}>Cmd</button>
    </div></div>{errors.preferences && <p className="pw-settings-error pw-settings-section" role="alert">{errors.preferences}</p>}
    <hr className="pw-settings-separator" />
    <div className="pw-settings-section pw-settings-shortcuts" role="group" aria-label="Core actions and navigation shortcuts">
      <ShortcutRow label="Ask AI" keys={["⌘", "Enter"]} /><ShortcutRow label="Start Over" keys={["⌘", "G"]} />
      <ShortcutRow label="Screenshot" keys={["⌘", "H"]} /><ShortcutRow label="Show/Hide" keys={["⌘", "B"]} />
    </div>
    <hr className="pw-settings-separator" />
    <div className="pw-settings-section pw-settings-shortcuts" role="group" aria-label="Window movement shortcuts">
      <ShortcutRow label="Move Up" keys={["⌘", "Up"]} /><ShortcutRow label="Move Left" keys={["⌘", "Left"]} />
      <ShortcutRow label="Move Down" keys={["⌘", "Down"]} /><ShortcutRow label="Move Right" keys={["⌘", "Right"]} />
    </div>
    <hr className="pw-settings-separator" />
    <div className="pw-settings-section pw-settings-footer">
      <div className="pw-settings-secondary"><button data-settings-control type="button" className="pw-settings-button" disabled={settingsWriteBusy} onClick={() => void openPanel(onOpenResume)}>Resume</button>
        <button data-settings-control type="button" className="pw-settings-button" disabled={settingsWriteBusy} onClick={() => void openPanel(onOpenProgramming)}>Programming</button></div>
      <button data-settings-control type="button" className="pw-settings-button" onClick={() => void openDashboard()}>Dashboard</button>
      <button data-settings-control type="button" className="pw-settings-button" disabled={settingsWriteBusy} onClick={() => void openPanel(onOpenShortcuts)}>Quick Guide</button>
      {errors.action && <p className="pw-settings-error" role="alert">{errors.action}</p>}
      <p className="pw-settings-account">PassWisely · {credits} credits</p>
      <div className="pw-settings-secondary"><button data-settings-control type="button" className="pw-settings-button" onClick={() => void openPanel(onLogout, true)}>Sign out</button>
        <button data-settings-control type="button" className="pw-settings-button" onClick={() => void openPanel(onQuit, true)}>Quit</button></div>
    </div>
  </div>;
}
