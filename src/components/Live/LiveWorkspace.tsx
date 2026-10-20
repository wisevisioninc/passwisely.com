import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Camera, Check, ChevronLeft, Copy, GripVertical, Loader2, MessageSquare, Pause, Play, Radio, Settings, Square, X } from "lucide-react";
import type { CaptureStatus, LiveResult, LiveSnapshot } from "../../../electron/live/types";
import { projectTranscriptParagraphs } from "../../../electron/live/TranscriptParagraphs";
import type { OverlayGeometry } from "../../../electron/live/overlayTypes";
import type { Screenshot } from "../../types/screenshots";
import { AISettings } from "../shared/AISettings";
import { ResumePanel } from "../shared/ResumePanel";
import { AnswerMarkdown } from "./AnswerMarkdown";
import { LiveKeycaps, LiveSettingsPopover } from "./LiveSettingsPopover";
import type { LiveCodeLanguage } from "./LiveSettingsPopover";
import type { SettingsWriteRunner } from "../shared/settingsWrites";
import "./live.css";

const CAPTURE_LABELS: Record<CaptureStatus, string> = {
  idle: "AI Response", starting: "Establishing connection…", recording: "Listening", pausing: "Pausing…",
  paused: "Session paused", resuming: "Resuming…", stopping: "Stopping…", ended: "Session ended", error: "Audio unavailable",
};
const SOURCE_LABELS = { microphone: "麦克风", system: "系统声音", unknown: "来源未知" };

// Revisions are globally monotonic in the main process, including across sessions.
export function isNewerLiveSnapshot(previous: LiveSnapshot | null, next: LiveSnapshot): boolean {
  return !previous || next.revision > previous.revision;
}

export function liveCaptureControls(snapshot: LiveSnapshot | null, busy: boolean) {
  const status = snapshot?.captureStatus ?? "idle";
  const needsCleanup = snapshot?.captureNeedsCleanup ?? false;
  const canReleasePending = status === "starting" || (needsCleanup && ["ended", "error"].includes(status));
  return {
    showStart: ["idle", "ended", "error"].includes(status),
    startDisabled: !snapshot || !snapshot.platformSupported || needsCleanup || busy,
    stopDisabled: !snapshot || status === "stopping" ||
      (!needsCleanup && !["starting", "recording", "paused"].includes(status)) ||
      (busy && !canReleasePending),
    stopLabel: status === "starting" ? "取消启动" : needsCleanup && ["ended", "error"].includes(status) ? "释放采集" : "结束",
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

function clockLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return <button type="button" className="pw-live-icon" data-overlay-interactive aria-label={failed ? "复制失败，请重试" : copied ? "已复制" : "复制回答"}
    title={failed ? "复制失败，请重试" : copied ? "已复制" : "复制回答"}
    onClick={async () => {
      setCopied(false); setFailed(false);
      try {
        if (typeof window.electronAPI?.liveCopyText === "function") {
          const result = await window.electronAPI.liveCopyText(text);
          if (!result.success) throw new Error(result.error || "Copy failed.");
        } else {
          // The standalone browser fixture has no Electron preload.
          await navigator.clipboard.writeText(text);
        }
        setCopied(true);
      } catch { setFailed(true); }
    }}>
    {copied ? <Check size={13} /> : <Copy size={13} />}
  </button>;
}

export interface OverlayPosition { x: number; y: number }
export function isOverlayInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-overlay-interactive],[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper],[data-overlay-global]');
}
/** Editable fields and deliberately focused dialog controls own keyboard input.
 * Passive hover/open state alone never requests native keyboard focus. */
export function isOverlayKeyboardTarget(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && isOverlayInteractiveTarget(target) &&
    (target.matches('input,textarea,select,[contenteditable="true"]') || !!target.closest('[role="dialog"],[role="alertdialog"]'));
}
export function clampOverlayPosition(position: OverlayPosition, viewport: { width: number; height: number }, regionWidth = 620): OverlayPosition {
  const half = Math.min(regionWidth / 2, Math.max(0, (viewport.width - 40) / 2));
  return { x: Math.max(20 + half, Math.min(position.x, viewport.width - 20 - half)), y: Math.max(20, Math.min(position.y, viewport.height - 60)) };
}

export default function LiveWorkspace({ visible, onSnapshot, onProgramming, credits = 0, currentLanguage, onLanguageChange }: {
  visible: boolean; onSnapshot?: (snapshot: LiveSnapshot) => void; onProgramming?: () => void; credits?: number;
  currentLanguage: string; onLanguageChange: (language: LiveCodeLanguage) => void;
}) {
  const api = window.electronAPI;
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const snapshotRef = useRef<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [includeScreenshots, setIncludeScreenshots] = useState(true);
  const [question, setQuestion] = useState("");
  const [tab, setTab] = useState<"transcript" | "answers">("answers");
  const [manualInput, setManualInput] = useState(false);
  const [contentOpened, setContentOpened] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAutoFocus, setSettingsAutoFocus] = useState(false);
  const [panel, setPanel] = useState<"settings" | "resume" | "shortcuts" | null>(null);
  const panelOwner = useRef(panel);
  panelOwner.current = panel;
  const settingsWritePending = useRef(false);
  const [settingsWriteBusy, setSettingsWriteBusy] = useState(false);
  const [geometry, setViewport] = useState<OverlayGeometry | null>(null);
  const viewport = geometry ?? { width: 0, height: 0 };
  const [position, setPosition] = useState<OverlayPosition>({ x: 0, y: 20 });
  const [contentWidth, setContentWidth] = useState(0);
  const [pinned, setPinned] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const settingsAnchor = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const nativeGeometry = useRef<OverlayGeometry | null>(null);
  const userWidth = useRef(false);
  const userPosition = useRef(false);
  const scrollOffsets = useRef({ transcript: 0, answers: 0 });
  const pendingScroll = useRef<number | null>(null);
  const screenshotRead = useRef(0);
  const alive = useRef(false);
  const askLocked = useRef(false);
  const clearLocked = useRef(false);
  const draftRevision = useRef(0);
  const captureLocked = useRef(false);
  const captureOperation = useRef(0);
  const captureAction = useRef<"start" | "normal" | "stop" | null>(null);
  const shortcutAction = useRef<(action: string) => void>(() => {});
  const publishSnapshot = useRef(onSnapshot);
  const visibleRef = useRef(visible);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ kind: "move" | "resize"; pointerId: number; x: number; y: number; position: OverlayPosition; width: number } | null>(null);
  const hit = useRef<boolean | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const focusedOverlayControl = useRef<HTMLElement | null>(null);
  publishSnapshot.current = onSnapshot;
  visibleRef.current = visible;

  useEffect(() => {
    alive.current = true;
    const accept = (next: LiveSnapshot) => {
      if (!alive.current || !isNewerLiveSnapshot(snapshotRef.current, next)) return;
      snapshotRef.current = next; setSnapshot(next); publishSnapshot.current?.(next); setLoading(false);
      if (["starting", "recording", "paused", "pausing", "resuming"].includes(next.captureStatus)) setContentOpened(true);
    };
    const unsubscribe = api.onLiveSnapshot(accept);
    void api.liveGetSnapshot().then(accept).catch(reason => { if (alive.current && !snapshotRef.current) { setError(errorText(reason)); setLoading(false); } });
    return () => { alive.current = false; unsubscribe(); if (settingsTimer.current) clearTimeout(settingsTimer.current); if (clickFocusTimer.current) clearTimeout(clickFocusTimer.current); void api.liveSetWorkspace(false).catch(() => {}); };
  }, []);
  useEffect(() => { void api.liveSetWorkspace(visible).catch(reason => { if (alive.current) setError(errorText(reason)); }); }, [visible]);
  useEffect(() => api.onLiveShortcut(action => shortcutAction.current(action)), []);

  const refreshScreenshots = useCallback(async () => {
    const read = ++screenshotRead.current;
    try { const next = await api.getScreenshots(); if (alive.current && read === screenshotRead.current) setScreenshots(next); }
    catch (reason) { if (alive.current && read === screenshotRead.current) setError(errorText(reason)); }
  }, []);
  useEffect(() => {
    const off = api.onScreenshotTaken(() => {
      void refreshScreenshots(); hit.current = null;
      if (visibleRef.current && pointer.current) setInteractive(isOverlayInteractiveTarget(document.elementFromPoint(pointer.current.x, pointer.current.y)));
    });
    const offQueue = api.onScreenshotQueueChanged(() => { void refreshScreenshots(); });
    const offError = api.onScreenshotError(message => { if (alive.current) { setError(message); } });
    void refreshScreenshots();
    return () => { screenshotRead.current++; off(); offQueue(); offError(); };
  }, [refreshScreenshots]);
  useEffect(() => { if (visible) void refreshScreenshots(); }, [visible, refreshScreenshots]);

  const setInteractive = useCallback((interactive: boolean) => {
    if (hit.current === interactive) return;
    hit.current = interactive;
    void api.setOverlayInteractive(interactive).catch(() => { hit.current = null; });
  }, []);
  const refreshPointerHit = useCallback(() => {
    const point = pointer.current;
    setInteractive(visibleRef.current && (!!drag.current || !!point && isOverlayInteractiveTarget(document.elementFromPoint(point.x, point.y))));
  }, [setInteractive]);
  // Native mouse ownership follows committed DOM, including controls moving
  // under a stationary cursor after a tab/panel change or streamed content.
  useLayoutEffect(() => {
    refreshPointerHit();
    if (focusedOverlayControl.current && !focusedOverlayControl.current.isConnected) {
      const next = isOverlayKeyboardTarget(document.activeElement) ? document.activeElement : null;
      focusedOverlayControl.current = next;
      void api.setOverlayFocus(!!next).catch(() => {});
    }
  });
  useEffect(() => {
    const move = (event: PointerEvent) => { pointer.current = { x: event.clientX, y: event.clientY }; setInteractive(visibleRef.current && (!!drag.current || isOverlayInteractiveTarget(event.target))); };
    const leave = () => { if (!drag.current) setInteractive(false); };
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const focus = (event: FocusEvent) => {
      if (visibleRef.current && isOverlayKeyboardTarget(event.target)) {
        if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
        focusedOverlayControl.current = event.target;
        void api.setOverlayFocus(true).catch(() => {});
      }
    };
    const blur = (event: FocusEvent) => {
      // A native select popup may temporarily remove DOM focus without a DOM
      // destination. Unknown transfer alone does not release its live lease.
      if (event.relatedTarget === null && visibleRef.current && event.target instanceof HTMLElement &&
          event.target.tagName === "SELECT" && event.target.isConnected && isOverlayKeyboardTarget(event.target)) return;
      if (event.target === focusedOverlayControl.current) focusedOverlayControl.current = null;
      // Let the destination control receive its click/focus before returning
      // keyboard ownership. Dialog buttons need Escape and arrow navigation.
      if (isOverlayKeyboardTarget(event.target) && !isOverlayKeyboardTarget(event.relatedTarget)) {
        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
          focusTimer = null;
          const next = visibleRef.current && isOverlayKeyboardTarget(document.activeElement) ? document.activeElement : null;
          focusedOverlayControl.current = next;
          void api.setOverlayFocus(!!next).catch(() => {});
        }, 0);
      }
    };
    let geometryRead = 0;
    let mounted = true;
    const acceptGeometry = (next: OverlayGeometry) => {
      if (!mounted || !Number.isFinite(next.width) || !Number.isFinite(next.height) || next.width <= 0 || next.height <= 0) return;
      geometryRead++;
      if (!visibleRef.current) return;
      if (nativeGeometry.current && nativeGeometry.current.displayId !== next.displayId) { userWidth.current = false; userPosition.current = false; }
      nativeGeometry.current = next; setViewport(next);
      setContentWidth(current => userWidth.current ? Math.min(current, next.width - 40) : next.width / 2);
      setPosition(current => userPosition.current ? clampOverlayPosition(current, next, toolbar.current?.offsetWidth) : { x: next.width / 2, y: 20 });
    };
    const resize = () => {
      const read = ++geometryRead;
      void api.getOverlayGeometry().then(next => { if (mounted && read === geometryRead && next) acceptGeometry(next); }).catch(reason => { if (mounted) setError(errorText(reason)); });
    };
    const recenter = () => { userPosition.current = false; if (nativeGeometry.current) setPosition({ x: nativeGeometry.current.width / 2, y: 20 }); resize(); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerleave", leave);
    document.addEventListener("focusin", focus); document.addEventListener("focusout", blur);
    window.addEventListener("resize", resize);
    // Native geometry is authoritative. Auth's 600px viewport is never a
    // candidate for the live panel's initial width. Subscribe before reading.
    const offGeometry = api.onOverlayGeometryChanged(acceptGeometry);
    resize();
    const off = api.onOverlayRecenter(recenter);
    const offVisibility = api.onOverlayVisibilityChanged(shown => {
      hit.current = null;
      if (!shown) {
        drag.current = null; focusedOverlayControl.current = null;
        if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
        if (clickFocusTimer.current) { clearTimeout(clickFocusTimer.current); clickFocusTimer.current = null; }
        setInteractive(false); void api.setOverlayFocus(false).catch(() => {});
      }
      else {
        resize();
        if (visibleRef.current && pointer.current) setInteractive(isOverlayInteractiveTarget(document.elementFromPoint(pointer.current.x, pointer.current.y)));
      }
    });
    return () => { mounted = false; if (focusTimer) clearTimeout(focusTimer); document.removeEventListener("pointermove", move); document.removeEventListener("pointerleave", leave); document.removeEventListener("focusin", focus); document.removeEventListener("focusout", blur); window.removeEventListener("resize", resize); off(); offGeometry(); offVisibility(); setInteractive(false); void api.setOverlayFocus(false).catch(() => {}); };
  }, [setInteractive]);
  useEffect(() => { if (!visible) { focusedOverlayControl.current = null; nativeGeometry.current = null; userWidth.current = false; userPosition.current = false; setViewport(null); setInteractive(false); void api.setOverlayFocus(false).catch(() => {}); } }, [visible, setInteractive]);

  const transcripts = snapshot?.transcripts ?? [];
  const transcriptParagraphs = projectTranscriptParagraphs(transcripts);
  const answers = snapshot?.answers ?? [];
  const generating = answers.some(answer => answer.status === "preparing" || answer.status === "streaming");
  const hasTranscript = transcripts.some(segment => segment.isFinal && segment.text.trim());
  const hasContext = !!question.trim() || hasTranscript || (includeScreenshots && screenshots.length > 0);
  const canAsk = !!snapshot && hasContext && !generating && !answerBusy && !screenshotBusy && !clearing;
  const captureStatus = snapshot?.captureStatus ?? "idle";
  const active = ["starting", "recording", "pausing", "paused", "resuming", "stopping"].includes(captureStatus);
  const controls = liveCaptureControls(snapshot, captureBusy);
  const geometryReady = geometry !== null;
  const top = !geometryReady || position.y < viewport.height / 2;
  const availableWidth = Math.max(0, viewport.width - 40);
  const cardWidth = Math.min(Math.max(Math.min(320, availableWidth), contentWidth), availableWidth);
  const cardLeft = Math.max(20, Math.min(position.x - cardWidth / 2, viewport.width - cardWidth - 20));
  const title = screenshotBusy ? "Analyzing screen..." : generating ? "Thinking..." : tab === "transcript" ? "AI Transcripts" : "AI Response";
  const hasSessionText = transcripts.length > 0 || answers.length > 0;
  const showContent = !!panel || manualInput || active || contentOpened || hasSessionText || answerBusy || screenshotBusy || !!error || !!snapshot?.error || !!snapshot?.screenshotError;
  const clampVisiblePosition = (next: OverlayPosition, width = cardWidth) => clampOverlayPosition(next, viewport,
    Math.max(toolbar.current?.offsetWidth ?? 0, showContent ? width : 0));

  const switchTab = (next: "transcript" | "answers") => {
    if (scroll.current) scrollOffsets.current[tab] = scroll.current.scrollTop;
    pendingScroll.current = scrollOffsets.current[next]; setTab(next);
  };
  useLayoutEffect(() => {
    if (!scroll.current || !visible || panel) return;
    if (pendingScroll.current !== null) { scroll.current.scrollTop = pendingScroll.current; pendingScroll.current = null; }
    else if (pinned) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [snapshot?.transcripts, snapshot?.answers, visible, panel, tab, pinned]);
  useEffect(() => { if (manualInput && visible && !panel) { input.current?.focus(); void api.setOverlayFocus(true).catch(() => {}); } }, [manualInput, visible, panel]);

  const runCapture = async (operation: () => Promise<LiveResult>, action: "start" | "normal" | "stop" = "normal") => {
    const current = snapshotRef.current;
    const releasing = action === "stop" && captureAction.current !== "stop" && (current?.captureStatus === "starting" || (current?.captureNeedsCleanup && ["ended", "error"].includes(current.captureStatus)));
    if (captureLocked.current && !releasing) return;
    const id = ++captureOperation.current; captureAction.current = action; captureLocked.current = true;
    setCaptureBusy(true); setError("");
    if (action === "start") { setContentOpened(true); switchTab("transcript"); setPanel(null); }
    try { const result = await operation(); if (id === captureOperation.current && !result.success) throw new Error(result.error || "Audio operation failed."); }
    catch (reason) { if (alive.current && id === captureOperation.current) setError(errorText(reason)); }
    finally { if (id === captureOperation.current) { captureLocked.current = false; captureAction.current = null; if (alive.current) setCaptureBusy(false); } }
  };
  const submitQuestion = async () => {
    if (!canAsk || askLocked.current || clearLocked.current) return;
    askLocked.current = true; const submitted = question, session = snapshotRef.current?.sessionId, draft = draftRevision.current;
    setContentOpened(true); setAnswerBusy(true); setError(""); switchTab("answers"); setPanel(null); setManualInput(false); setPinned(true);
    try {
      const result = await api.liveAsk({ question: submitted.trim(), includeScreenshots, codeLanguage: currentLanguage as LiveCodeLanguage });
      if (!result.success) throw new Error(result.error || "Answer request failed.");
      if (alive.current && session === snapshotRef.current?.sessionId && draftRevision.current === draft) { draftRevision.current++; setQuestion(""); }
    } catch (reason) { if (alive.current) { setError(errorText(reason)); if (submitted) setManualInput(true); } }
    finally { askLocked.current = false; if (alive.current) setAnswerBusy(false); }
  };
  const startOver = async () => {
    if (clearLocked.current) return;
    clearLocked.current = true; setContentOpened(true); setClearing(true); setError("");
    const submitted = question, session = snapshotRef.current?.sessionId, draft = draftRevision.current;
    try {
      const result = await api.liveStartOver();
      if (!result.success) throw new Error(result.error || "Start Over failed.");
      if (alive.current && session === snapshotRef.current?.sessionId) {
        if (draftRevision.current === draft) { draftRevision.current++; setQuestion(""); if (!submitted) setManualInput(false); }
      }
    } catch (reason) { if (alive.current) { setError(errorText(reason)); } }
    finally { clearLocked.current = false; if (alive.current) setClearing(false); }
  };
  const toggleSession = () => {
    const current = snapshotRef.current;
    if (current?.captureNeedsCleanup || (current && ["starting", "recording", "paused", "pausing", "resuming", "stopping"].includes(current.captureStatus))) void runCapture(api.liveStop, "stop");
    else if (current?.platformSupported) void runCapture(api.liveStart, "start");
  };
  shortcutAction.current = action => {
    if (!visible) return;
    if (action === "ask" && !panel) void submitQuestion();
    else if (action === "clear") void startOver();
    else if (action === "toggle-session") toggleSession();
    else if (action === "response") { switchTab("answers"); setPanel(null); setContentOpened(true); }
    else if (action === "transcripts") { switchTab("transcript"); setPanel(null); setContentOpened(true); }
    else if (action === "scroll-up" || action === "scroll-down") scroll.current?.scrollBy({ top: action === "scroll-up" ? -300 : 300, behavior: "smooth" });
    else if (action.startsWith("move-")) { userPosition.current = true; setPosition(current => clampVisiblePosition({ x: current.x + (action === "move-left" ? -60 : action === "move-right" ? 60 : 0), y: current.y + (action === "move-up" ? -60 : action === "move-down" ? 60 : 0) })); }
  };
  const answerAction = async (operation: () => Promise<LiveResult>) => {
    setError(""); try { const result = await operation(); if (!result.success) throw new Error(result.error || "Operation failed."); }
    catch (reason) { if (alive.current) { setError(errorText(reason)); } }
  };
  const captureScreenshot = async () => {
    if (screenshotBusy) return; setScreenshotBusy(true); setError("");
    try { const result = await api.triggerScreenshot(); if (!result.success) throw new Error(result.error || "Screenshot failed."); await refreshScreenshots(); }
    catch (reason) { if (alive.current) { setError(errorText(reason)); } }
    finally { if (alive.current) setScreenshotBusy(false); }
  };
  const deleteScreenshot = async (path: string) => {
    try { const result = await api.deleteScreenshot(path); if (!result.success) throw new Error(result.error || "Screenshot removal failed."); await refreshScreenshots(); }
    catch (reason) { if (alive.current) setError(errorText(reason)); }
  };
  // The workspace owns native-write lifetime across compact popover unmounts.
  const runSettingsWrite = async <T,>(editor: "compact" | "advanced", operation: () => Promise<T>): Promise<T> => {
    const currentEditor = panelOwner.current === "settings" ? "advanced" : "compact";
    if (settingsWritePending.current || editor !== currentEditor) throw new Error("已有设置正在编辑或保存，请完成后重试。");
    settingsWritePending.current = true; setSettingsWriteBusy(true);
    try { return await operation(); }
    finally { settingsWritePending.current = false; if (alive.current) setSettingsWriteBusy(false); }
  };
  const runCompactSettingsWrite: SettingsWriteRunner = operation => runSettingsWrite("compact", operation);
  const runAdvancedSettingsWrite: SettingsWriteRunner = operation => runSettingsWrite("advanced", operation);
  const closeSettingsNow = () => {
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    setSettingsOpen(false); setSettingsAutoFocus(false);
  };
  const openSettings = () => {
    if (panelOwner.current === "settings") { closeSettingsNow(); return; }
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    setSettingsAutoFocus(false); setSettingsOpen(true);
  };
  const closeSettings = () => {
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(() => {
      // Keep native selects and keyboard navigation alive after pointer leave.
      const keyboardOwner = focusedOverlayControl.current;
      const ownsKeyboard = !!keyboardOwner?.isConnected && settingsAnchor.current?.contains(keyboardOwner);
      if (!ownsKeyboard && !settingsAnchor.current?.contains(document.activeElement)) closeSettingsNow();
    }, 500);
  };
  const openSettingsPanel = (next: "settings" | "resume" | "shortcuts") => {
    if (settingsWritePending.current) return;
    panelOwner.current = next;
    closeSettingsNow(); setPanel(next);
  };
  const beginDrag = (event: React.PointerEvent<HTMLElement>, kind: "move" | "resize") => {
    if (event.button !== 0) return;
    drag.current = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, position, width: cardWidth };
    event.currentTarget.setPointerCapture(event.pointerId); setInteractive(true); event.preventDefault();
  };
  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current; if (!current || current.pointerId !== event.pointerId) return;
    if (current.kind === "move") { userPosition.current = true; setPosition(clampVisiblePosition({ x: current.position.x + event.clientX - current.x, y: current.position.y + event.clientY - current.y })); }
    else { userWidth.current = true; const width = Math.max(Math.min(320, viewport.width - 40), Math.min(viewport.width - 40, current.width + (event.clientX - current.x) * 2)); setContentWidth(width); setPosition(position => clampVisiblePosition(position, width)); }
  };
  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const target = document.elementFromPoint(event.clientX, event.clientY);
    setInteractive(isOverlayInteractiveTarget(target));
  };
  const dragEvents = { onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => { drag.current = null; setInteractive(isOverlayInteractiveTarget(document.elementFromPoint(event.clientX, event.clientY))); } };
  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!element || !geometryReady || !visible) return;
    const fit = () => {
      setPosition(current => {
        const next = clampVisiblePosition(current);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    // The bar has an intrinsic width independent of its left coordinate.
    // Font loading and recording controls can still change that width.
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [geometry?.width, geometry?.height, cardWidth, showContent, visible]);
  const menuAbove = Math.max(0, position.y - 28);
  const menuBelow = Math.max(0, viewport.height - position.y - 68);
  const menuPlacement = menuBelow >= menuAbove ? "below" : "above";

  return <section className="pw-live pw-overlay" aria-label="会话浮层" hidden={!visible || !geometryReady} data-edge={top ? "top" : "bottom"} onClickCapture={event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button) return;
    // A user click in the dialog is an explicit keyboard-focus request. On
    // macOS a button click need not otherwise move document.activeElement.
    if (button.closest('[role="dialog"],[role="alertdialog"]')) button.focus({ preventScroll: true });
    if (clickFocusTimer.current) clearTimeout(clickFocusTimer.current);
    clickFocusTimer.current = setTimeout(() => {
      clickFocusTimer.current = null;
      if (!alive.current) return;
      const next = visibleRef.current && isOverlayKeyboardTarget(document.activeElement) ? document.activeElement : null;
      focusedOverlayControl.current = next;
      void api.setOverlayFocus(!!next).catch(() => {});
    }, 0);
  }}>
    <div className="pw-live-windows" style={{ left: cardLeft, width: cardWidth, maxHeight: Math.max(64, top ? viewport.height - position.y - 84 : position.y - 44), ...(top ? { top: position.y + 64 } : { bottom: viewport.height - position.y + 24 }) }}>
    {showContent && <section className="pw-live-card pw-glass">
      <header className="pw-live-card-header" data-overlay-interactive {...dragEvents} onPointerDown={event => { if (!(event.target as Element).closest("button,input,textarea,a")) beginDrag(event, "move"); }}>
        <img className="pw-live-brand" src="./logo512.png" alt="PassWisely" width={24} height={24} draggable={false} />
        <nav className="pw-live-tabs" aria-label="会话内容">
          <button type="button" aria-pressed={tab === "answers"} onClick={() => switchTab("answers")}>Response <LiveKeycaps keys={["⌥", "1"]} /></button>
          <button type="button" aria-pressed={tab === "transcript"} onClick={() => switchTab("transcript")}>Transcripts <LiveKeycaps keys={["⌥", "2"]} /></button>
        </nav>
        <span className="pw-live-title" role="status">{loading ? "Connecting…" : title}</span>
        {generating && <button type="button" className="pw-live-icon" title="Stop generation / 停止生成" aria-label="停止生成" onClick={() => void answerAction(api.liveCancelAnswer)}><Square size={12} /></button>}
      </header>
      {(error || snapshot?.error || snapshot?.platformMessage || snapshot?.screenshotError) && <div className="pw-live-alert" role="alert"><span>{error || snapshot?.error || snapshot?.platformMessage || snapshot?.screenshotError}</span><button type="button" className="pw-live-icon" data-overlay-interactive aria-label="关闭操作提示" onClick={() => setError("")}><X size={12} /></button></div>}
      {panel ? <div className="pw-live-settings-view" data-overlay-interactive>
        <button type="button" className="pw-live-back" onClick={() => setPanel(null)}><ChevronLeft size={13} />Back · {panel === "settings" ? "AI Settings / 语言" : panel === "resume" ? "Resume / 简历" : "Shortcuts"}</button>
        <div className="pw-live-settings-content">{panel === "settings" ? <AISettings runSettingsWrite={runAdvancedSettingsWrite} /> : panel === "resume" ? <ResumePanel /> : <dl className="pw-live-shortcuts">{[["Solve", "⌘ ↵"], ["Screenshot", "⌘ H"], ["Show / Hide", "⌘ B"], ["Start Over", "⌘ G"], ["Start / Stop Listening", "⌘ ⇧ \\"], ["Response / Transcripts", "⌥ 1 / ⌥ 2"], ["Scroll", "⌘ ⇧ ↑ / ↓"], ["Move", "⌘ arrows"]].map(([label, key]) => <div key={label}><dt>{label}</dt><dd>{key}</dd></div>)}</dl>}</div>
      </div> : <>
        <div className="pw-live-scroll" ref={scroll} style={{ maxHeight: viewport.height * 2 / 3 }} onScroll={event => { const element = event.currentTarget; const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 50; setPinned(nearBottom); scrollOffsets.current[tab] = element.scrollTop; refreshPointerHit(); }}>
          <section className="pw-live-response-view" aria-label="AI 回答" hidden={tab !== "answers"}>
            {answers.length === 0 ? <div className="pw-live-empty-response"><span className="pw-live-question">💡 Crack it</span><p>Ask about your screen or audio.</p></div> : answers.map(answer => <article className="pw-live-answer" key={answer.id}>
              <div className="pw-live-question">{answer.question || "💡 Crack it"}{answer.screenshotCount > 0 && <small><Camera size={10} />{answer.screenshotCount}</small>}</div>
              <div className="pw-live-answer-meta"><span>{answer.status === "preparing" ? "Thinking…" : answer.status === "streaming" ? "AI Response" : answer.status === "cancelled" ? "Stopped · preview retained" : answer.status === "error" ? "Response incomplete" : "AI Response"}{answer.model && <small>{answer.model}</small>}</span>{answer.text && <CopyText text={answer.text} />}</div>
              <div className="pw-live-answer-text">{answer.text ? <AnswerMarkdown text={answer.text} /> : ["preparing", "streaming"].includes(answer.status) ? <Loader2 className="pw-live-spinning" size={14} /> : "No response text."}{answer.status === "streaming" && answer.text && <span className="pw-live-caret" aria-hidden="true" />}</div>
              {answer.contextTruncated && <p className="pw-live-context-note">Using recent context; earlier content exceeded the limit.</p>}
              {(answer.error || answer.screenshotCleanupError) && <p className="pw-live-answer-error" role="alert">{answer.error || answer.screenshotCleanupError}</p>}
            </article>)}
          </section>
          <section className="pw-live-transcript-view" aria-label="会话转录" hidden={tab !== "transcript"}>
            {snapshot?.transcription && <p className="pw-live-context-note" aria-label="本次语音识别">本次：{snapshot.transcription.language === "zh" ? "中文" : "English"} · {snapshot.transcription.provider === "deepgram" ? "Deepgram" : "Recall"} · {snapshot.transcription.latency === "delayed" ? "分钟级（实验）" : "实时"}</p>}
            {transcripts.length === 0 ? <p className="pw-live-empty-transcript">{captureStatus === "starting" ? "Establishing connection…" : captureStatus === "paused" ? "Session paused" : captureStatus === "recording" ? "Listening for audio…" : 'Click "Start Interview" to create your first transcript.'}</p> : transcriptParagraphs.map(segment => <article className={`pw-live-segment source-${segment.source} ${segment.isFinal ? "final" : "partial"}`} key={segment.id} aria-label={`${SOURCE_LABELS[segment.source]}${segment.isFinal ? "" : " · 识别中"}`} title={`${SOURCE_LABELS[segment.source]} · ${clockLabel(segment.receivedAt)}`}>
              <p>{segment.text}</p>{segment.source === "unknown" && <small>来源未知</small>}{!segment.isFinal && <span className="pw-live-caret" aria-hidden="true" />}
            </article>)}
            {snapshot?.transcriptTruncated && <p className="pw-live-context-note">Earlier transcript exceeded the retention limit.</p>}
          </section>
        </div>
        {!pinned && <button type="button" className="pw-live-follow" data-overlay-interactive onClick={() => setPinned(true)}><ArrowDown size={12} />View Latest</button>}
        {(tab === "answers" && answers.length > 0 && !generating || tab === "transcript" && !active && transcripts.length > 0) && <footer className="pw-live-bottom-actions">{tab === "answers" && <button type="button" data-overlay-interactive aria-label="Scroll Up" onClick={() => scroll.current?.scrollBy({ top: -300, behavior: "smooth" })}>Scroll Up <LiveKeycaps keys={["⌘", "⇧", "↑"]} /></button>}<button type="button" data-overlay-interactive disabled={clearing} onClick={() => void startOver()}>Start Over <LiveKeycaps keys={["⌘", "G"]} /></button></footer>}
      </>}
      <div className="pw-live-resize" data-overlay-interactive role="separator" aria-label="调整内容宽度" aria-orientation="vertical" {...dragEvents} onPointerDown={event => beginDrag(event, "resize")} />
    </section>}

    <div className="pw-live-island">
      {screenshots.length > 0 && <div className="pw-live-attachments pw-glass" data-overlay-interactive aria-label="待提交截图"><div className="pw-live-thumbnails">{screenshots.map((shot, index) => <figure key={shot.path}><img src={shot.preview} alt={`截图 ${index + 1}`} /><button type="button" aria-label={`删除截图 ${index + 1}`} onClick={() => void deleteScreenshot(shot.path)}><X size={10} /></button></figure>)}</div><label><input type="checkbox" checked={includeScreenshots} onChange={event => setIncludeScreenshots(event.target.checked)} />Include screenshots</label></div>}
      {manualInput && !panel && <form className="pw-live-composer pw-glass" data-overlay-interactive onSubmit={event => { event.preventDefault(); void submitQuestion(); }}>
        <textarea ref={input} aria-label="会话提问" value={question} rows={2} placeholder={active ? "Ask about your screen or audio" : "Ask about your screen"} onChange={event => { draftRevision.current++; setQuestion(event.target.value); }} onFocus={() => { void api.setOverlayFocus(true).catch(() => {}); }} onKeyDown={event => { if (event.key === "Escape") { setManualInput(false); void api.setOverlayFocus(false).catch(() => {}); } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); void submitQuestion(); } }} />
        <button type="submit" disabled={!canAsk} aria-label="发送问题">Submit <LiveKeycaps keys={["↵"]} /></button>
      </form>}
    </div>
    </div>
    <div ref={toolbar} className="pw-live-toolbar pw-glass" data-overlay-interactive style={{ left: position.x, top: position.y }}>
      <button type="button" className="pw-live-drag" aria-label="移动浮条" {...dragEvents} onPointerDown={event => beginDrag(event, "move")}><GripVertical size={13} /></button>
      <div className="pw-live-toolbar-actions">
      <button type="button" className="pw-live-credits" title="PassWisely account & credits" onClick={() => { void api.accountOpenPortal(); }}>{credits} credits</button>
      <img className="pw-live-toolbar-brand" src="./logo512.png" alt="PassWisely" width={24} height={24} draggable={false} />
      <div className="pw-live-capture-controls">
        {controls.showStart && !snapshot?.captureNeedsCleanup ? <button type="button" className="pw-live-start" disabled={loading || controls.startDisabled} title={`${hasSessionText ? "开始新会话将清空当前转录和回答。" : ""}按已保存的语音设置开始新会话。音频将发送并保存至你的 Recall 项目。`} onClick={() => void runCapture(api.liveStart, "start")}><Play size={11} />Start Interview</button> : captureStatus === "recording" || captureStatus === "paused" ? <>
          <button type="button" className="pw-live-pause" disabled={captureBusy} title={captureStatus === "paused" ? "Resume Listening" : "Pause Listening"} aria-label={captureStatus === "paused" ? "Resume Listening / 继续采集" : "Pause Listening / 暂停采集"} onClick={() => void runCapture(captureStatus === "paused" ? api.liveResume : api.livePause)}>{captureStatus === "paused" ? <Play size={11} /> : <Pause size={11} />}</button>
          <span className={`pw-live-waveform ${captureStatus === "paused" ? "paused" : ""}`} role="status" aria-label={CAPTURE_LABELS[captureStatus]}><i /><i /><i /><i /><i /></span>
          {captureStatus === "paused" && <button type="button" className="pw-live-done" disabled={controls.stopDisabled} title="Stop Listening" onClick={() => void runCapture(api.liveStop, "stop")}>Done <Square size={9} /></button>}
        </> : <button type="button" className="pw-live-done" disabled={controls.stopDisabled} onClick={() => void runCapture(api.liveStop, "stop")}>{captureStatus === "starting" ? "Cancel" : snapshot?.captureNeedsCleanup && ["ended", "error"].includes(captureStatus) ? "Release audio" : CAPTURE_LABELS[captureStatus]}</button>}
      </div>
      <span className="pw-live-divider" />
      <button type="button" className="pw-live-command" disabled={screenshotBusy || clearing} aria-label="Take Screenshot / 截图" onClick={() => void captureScreenshot()}>{screenshotBusy && <Loader2 className="pw-live-spinning" size={16} />}Take Screenshot <LiveKeycaps keys={["⌘", "H"]} /></button>
      <button type="button" className="pw-live-command" disabled={!canAsk} aria-label="Solve / 生成回答" onClick={() => void submitQuestion()}>Solve <LiveKeycaps keys={["⌘", "↵"]} /></button>
      <button type="button" className={`pw-live-command ${manualInput ? "selected" : ""}`} title="Ask a question / 手动输入" aria-label="手动输入问题" aria-pressed={manualInput} onClick={() => { setManualInput(!manualInput); setPanel(null); }}><MessageSquare size={14} /></button>
      <button type="button" className="pw-live-command" onClick={() => { void api.toggleMainWindow(); }}>Show / Hide <LiveKeycaps keys={["⌘", "B"]} /></button>
      </div>
      <div ref={settingsAnchor} className="pw-live-settings-anchor" onPointerEnter={openSettings} onPointerLeave={closeSettings}
        onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeSettings(); }}>
        <button ref={settingsTrigger} type="button" className="pw-live-icon" aria-label="Settings / 设置" aria-haspopup="dialog" aria-expanded={settingsOpen && panel !== "settings"} aria-disabled={panel === "settings"}
          title={panel === "settings" ? "高级设置已打开，请在面板中修改；Back 返回后可打开快捷设置。" : "Settings"}
          onClick={() => { if (settingsOpen) closeSettingsNow(); else openSettings(); }}
          onKeyDown={event => {
            if (!["Enter", " ", "ArrowDown"].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            if (panelOwner.current === "settings") { closeSettingsNow(); return; }
            if (settingsTimer.current) clearTimeout(settingsTimer.current);
            setSettingsAutoFocus(true); setSettingsOpen(true);
            void api.setOverlayFocus(true).catch(() => {});
          }}><Settings size={14} /></button>
        {settingsOpen && panel !== "settings" && <LiveSettingsPopover currentLanguage={currentLanguage} onLanguageChange={onLanguageChange}
          captureStatus={captureStatus} captureNeedsCleanup={snapshot?.captureNeedsCleanup} answerBusy={generating || answerBusy} credits={credits}
          writeBusy={settingsWriteBusy} runSettingsWrite={runCompactSettingsWrite}
          placement={menuPlacement} maxHeight={menuPlacement === "below" ? menuBelow : menuAbove}
          returnFocusRef={settingsTrigger} autoFocus={settingsAutoFocus} onClose={closeSettingsNow}
          onOpenAdvanced={() => openSettingsPanel("settings")} onOpenResume={() => openSettingsPanel("resume")}
          onOpenShortcuts={() => openSettingsPanel("shortcuts")} onOpenProgramming={() => { if (settingsWritePending.current) return; closeSettingsNow(); onProgramming?.(); }}
          onLogout={() => {
            closeSettingsNow();
            void api.accountLogout().then(result => { if (result.success) window.location.reload(); else { setError(result.error || "Sign out failed."); } })
              .catch(reason => { setError(errorText(reason)); });
          }}
          onQuit={() => { closeSettingsNow(); void api.quitApp().catch(reason => { setError(errorText(reason)); }); }} />}
      </div>
    </div>
  </section>;
}
