import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Camera, Check, ChevronDown, ChevronLeft, Copy, GripVertical, Loader2, MessageSquare, Pause, Play, Radio, Settings, Square, X } from "lucide-react";
import type { CaptureStatus, LiveResult, LiveSnapshot } from "../../../electron/live/types";
import type { OverlayGeometry } from "../../../electron/live/overlayTypes";
import type { Screenshot } from "../../types/screenshots";
import { AISettings } from "../shared/AISettings";
import { ResumePanel } from "../shared/ResumePanel";
import { AnswerMarkdown } from "./AnswerMarkdown";
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
  return <button type="button" className="pw-live-icon" aria-label={failed ? "复制失败，请重试" : copied ? "已复制" : "复制回答"}
    title={failed ? "复制失败，请重试" : copied ? "已复制" : "复制回答"}
    onClick={() => { setFailed(false); void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setFailed(true)); }}>
    {copied ? <Check size={13} /> : <Copy size={13} />}
  </button>;
}

export interface OverlayPosition { x: number; y: number }
function Keycaps({ keys }: { keys: string[] }) {
  return <span className="pw-live-keycaps" aria-hidden="true">{keys.map(key => <kbd key={key}>{key}</kbd>)}</span>;
}
export function isOverlayInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-overlay-interactive],[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper],[data-overlay-global]');
}
export function clampOverlayPosition(position: OverlayPosition, viewport: { width: number; height: number }, regionWidth = 620): OverlayPosition {
  const half = Math.min(regionWidth / 2, Math.max(0, (viewport.width - 40) / 2));
  return { x: Math.max(20 + half, Math.min(position.x, viewport.width - 20 - half)), y: Math.max(20, Math.min(position.y, viewport.height - 60)) };
}

export default function LiveWorkspace({ visible, onSnapshot, onProgramming, credits = 0 }: {
  visible: boolean; onSnapshot?: (snapshot: LiveSnapshot) => void; onProgramming?: () => void; credits?: number;
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
  const [retainedSession, setRetainedSession] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panel, setPanel] = useState<"settings" | "resume" | "shortcuts" | null>(null);
  const [geometry, setViewport] = useState<OverlayGeometry | null>(null);
  const viewport = geometry ?? { width: 0, height: 0 };
  const [position, setPosition] = useState<OverlayPosition>({ x: 0, y: 20 });
  const [contentWidth, setContentWidth] = useState(0);
  const [pinned, setPinned] = useState(true);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
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
  const drag = useRef<{ kind: "move" | "resize"; pointerId: number; x: number; y: number; position: OverlayPosition; width: number } | null>(null);
  const hit = useRef<boolean | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  publishSnapshot.current = onSnapshot;
  visibleRef.current = visible;

  useEffect(() => {
    alive.current = true;
    const accept = (next: LiveSnapshot) => {
      if (!alive.current || !isNewerLiveSnapshot(snapshotRef.current, next)) return;
      snapshotRef.current = next; setSnapshot(next); publishSnapshot.current?.(next); setLoading(false);
      if (["starting", "recording", "paused", "pausing", "resuming"].includes(next.captureStatus)) setRetainedSession(true);
      if (next.error || next.screenshotError) setCollapsed(false);
    };
    const unsubscribe = api.onLiveSnapshot(accept);
    void api.liveGetSnapshot().then(accept).catch(reason => { if (alive.current && !snapshotRef.current) { setError(errorText(reason)); setLoading(false); } });
    return () => { alive.current = false; unsubscribe(); if (settingsTimer.current) clearTimeout(settingsTimer.current); void api.liveSetWorkspace(false).catch(() => {}); };
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
    const offError = api.onScreenshotError(message => { if (alive.current) { setError(message); setCollapsed(false); } });
    void refreshScreenshots();
    return () => { screenshotRead.current++; off(); offQueue(); offError(); };
  }, [refreshScreenshots]);
  useEffect(() => { if (visible) void refreshScreenshots(); }, [visible, refreshScreenshots]);

  const setInteractive = useCallback((interactive: boolean) => {
    if (hit.current === interactive) return;
    hit.current = interactive;
    void api.setOverlayInteractive(interactive).catch(() => { hit.current = null; });
  }, []);
  useEffect(() => {
    const move = (event: PointerEvent) => { pointer.current = { x: event.clientX, y: event.clientY }; setInteractive(visibleRef.current && (!!drag.current || isOverlayInteractiveTarget(event.target))); };
    const leave = () => { if (!drag.current) setInteractive(false); };
    const isField = (target: EventTarget | null) => target instanceof HTMLElement && target.matches('input,textarea,select,[contenteditable="true"]');
    const focus = (event: FocusEvent) => {
      if (visibleRef.current && isField(event.target) && isOverlayInteractiveTarget(event.target)) void api.setOverlayFocus(true).catch(() => {});
    };
    const blur = (event: FocusEvent) => {
      // Let an in-overlay button receive its click before changing native focus.
      if (isField(event.target) && !isField(event.relatedTarget) && !isOverlayInteractiveTarget(event.relatedTarget)) void api.setOverlayFocus(false).catch(() => {});
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
      if (!shown) { drag.current = null; setInteractive(false); }
      else {
        resize();
        if (visibleRef.current && pointer.current) setInteractive(isOverlayInteractiveTarget(document.elementFromPoint(pointer.current.x, pointer.current.y)));
      }
    });
    return () => { mounted = false; document.removeEventListener("pointermove", move); document.removeEventListener("pointerleave", leave); document.removeEventListener("focusin", focus); document.removeEventListener("focusout", blur); window.removeEventListener("resize", resize); off(); offGeometry(); offVisibility(); setInteractive(false); void api.setOverlayFocus(false).catch(() => {}); };
  }, [setInteractive]);
  useEffect(() => { if (!visible) { nativeGeometry.current = null; userWidth.current = false; userPosition.current = false; setViewport(null); setInteractive(false); void api.setOverlayFocus(false).catch(() => {}); } }, [visible, setInteractive]);

  const transcripts = snapshot?.transcripts ?? [];
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
  const showContent = !!panel || manualInput || active || retainedSession || hasSessionText || answerBusy || screenshotBusy || !!error || !!snapshot?.error || !!snapshot?.screenshotError;
  const clampVisiblePosition = (next: OverlayPosition, width = cardWidth) => clampOverlayPosition(next, viewport,
    Math.max(toolbar.current?.offsetWidth ?? 0, showContent && !collapsed ? width : 0));

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
    if (action === "start") { switchTab("transcript"); setPanel(null); setCollapsed(false); }
    try { const result = await operation(); if (id === captureOperation.current && !result.success) throw new Error(result.error || "Audio operation failed."); }
    catch (reason) { if (alive.current && id === captureOperation.current) setError(errorText(reason)); }
    finally { if (id === captureOperation.current) { captureLocked.current = false; captureAction.current = null; if (alive.current) setCaptureBusy(false); } }
  };
  const submitQuestion = async () => {
    if (!canAsk || askLocked.current || clearLocked.current) return;
    askLocked.current = true; const submitted = question, session = snapshotRef.current?.sessionId, draft = draftRevision.current;
    setAnswerBusy(true); setError(""); switchTab("answers"); setPanel(null); setManualInput(false); setPinned(true); setCollapsed(false);
    try {
      const result = await api.liveAsk({ question: submitted.trim(), includeScreenshots });
      if (!result.success) throw new Error(result.error || "Answer request failed.");
      if (alive.current && session === snapshotRef.current?.sessionId && draftRevision.current === draft) { draftRevision.current++; setQuestion(""); }
    } catch (reason) { if (alive.current) { setError(errorText(reason)); if (submitted) setManualInput(true); } }
    finally { askLocked.current = false; if (alive.current) setAnswerBusy(false); }
  };
  const startOver = async () => {
    if (clearLocked.current) return;
    clearLocked.current = true; setClearing(true); setError("");
    const submitted = question, session = snapshotRef.current?.sessionId, draft = draftRevision.current;
    try {
      const result = await api.liveStartOver();
      if (!result.success) throw new Error(result.error || "Start Over failed.");
      if (alive.current && session === snapshotRef.current?.sessionId) {
        if (draftRevision.current === draft) { draftRevision.current++; setQuestion(""); if (!submitted) setManualInput(false); }
        if (!["starting", "recording", "paused", "pausing", "resuming", "stopping"].includes(snapshotRef.current?.captureStatus ?? "idle")) setRetainedSession(false);
      }
    } catch (reason) { if (alive.current) { setError(errorText(reason)); setCollapsed(false); } }
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
    else if (action === "response") { switchTab("answers"); setPanel(null); setCollapsed(false); setRetainedSession(true); }
    else if (action === "transcripts") { switchTab("transcript"); setPanel(null); setCollapsed(false); setRetainedSession(true); }
    else if (action === "scroll-up" || action === "scroll-down") scroll.current?.scrollBy({ top: action === "scroll-up" ? -300 : 300, behavior: "smooth" });
    else if (action.startsWith("move-")) { userPosition.current = true; setPosition(current => clampVisiblePosition({ x: current.x + (action === "move-left" ? -60 : action === "move-right" ? 60 : 0), y: current.y + (action === "move-up" ? -60 : action === "move-down" ? 60 : 0) })); }
  };
  const answerAction = async (operation: () => Promise<LiveResult>) => {
    setError(""); try { const result = await operation(); if (!result.success) throw new Error(result.error || "Operation failed."); }
    catch (reason) { if (alive.current) { setError(errorText(reason)); setCollapsed(false); } }
  };
  const captureScreenshot = async () => {
    if (screenshotBusy) return; setScreenshotBusy(true); setError("");
    try { const result = await api.triggerScreenshot(); if (!result.success) throw new Error(result.error || "Screenshot failed."); await refreshScreenshots(); }
    catch (reason) { if (alive.current) { setError(errorText(reason)); setCollapsed(false); } }
    finally { if (alive.current) setScreenshotBusy(false); }
  };
  const deleteScreenshot = async (path: string) => {
    try { const result = await api.deleteScreenshot(path); if (!result.success) throw new Error(result.error || "Screenshot removal failed."); await refreshScreenshots(); }
    catch (reason) { if (alive.current) setError(errorText(reason)); }
  };
  const openSettings = () => { if (settingsTimer.current) clearTimeout(settingsTimer.current); setSettingsOpen(true); };
  const closeSettings = () => { if (settingsTimer.current) clearTimeout(settingsTimer.current); settingsTimer.current = setTimeout(() => setSettingsOpen(false), 500); };
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
  }, [geometry?.width, geometry?.height, cardWidth, showContent, collapsed, visible]);
  const menuAbove = Math.max(0, position.y - 28);
  const menuBelow = Math.max(0, viewport.height - position.y - 68);
  const menuPlacement = menuBelow >= menuAbove ? "below" : "above";

  return <section className="pw-live pw-overlay" aria-label="会话浮层" hidden={!visible || !geometryReady} data-edge={top ? "top" : "bottom"} onClickCapture={event => {
    if ((event.target as Element).closest("button")) setTimeout(() => {
      if (!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) void api.setOverlayFocus(false).catch(() => {});
    }, 0);
  }}>
    <div className="pw-live-windows" style={{ left: cardLeft, width: cardWidth, maxHeight: Math.max(64, top ? viewport.height - position.y - 84 : position.y - 44), ...(top ? { top: position.y + 64 } : { bottom: viewport.height - position.y + 24 }) }}>
    {showContent && !collapsed && <section className="pw-live-card pw-glass" data-overlay-interactive>
      <header className="pw-live-card-header" {...dragEvents} onPointerDown={event => { if (!(event.target as Element).closest("button,input,textarea,a")) beginDrag(event, "move"); }}>
        <img className="pw-live-brand" src="./logo512.png" alt="PassWisely" width={24} height={24} draggable={false} />
        <nav className="pw-live-tabs" aria-label="会话内容">
          <button type="button" aria-pressed={tab === "answers"} onClick={() => switchTab("answers")}>Response <Keycaps keys={["⌥", "1"]} /></button>
          <button type="button" aria-pressed={tab === "transcript"} onClick={() => switchTab("transcript")}>Transcripts <Keycaps keys={["⌥", "2"]} /></button>
        </nav>
        <span className="pw-live-title" role="status">{loading ? "Connecting…" : title}</span>
        <button type="button" className="pw-live-icon" aria-label="Collapse / 收起内容" title="Collapse" onClick={() => setCollapsed(true)}><ChevronDown size={13} /></button>
        {generating && <button type="button" className="pw-live-icon" title="Stop generation / 停止生成" aria-label="停止生成" onClick={() => void answerAction(api.liveCancelAnswer)}><Square size={12} /></button>}
      </header>
      {(error || snapshot?.error || snapshot?.platformMessage || snapshot?.screenshotError) && <div className="pw-live-alert" role="alert"><span>{error || snapshot?.error || snapshot?.platformMessage || snapshot?.screenshotError}</span><button type="button" className="pw-live-icon" aria-label="关闭操作提示" onClick={() => setError("")}><X size={12} /></button></div>}
      {panel ? <div className="pw-live-settings-view">
        <button type="button" className="pw-live-back" onClick={() => setPanel(null)}><ChevronLeft size={13} />Back · {panel === "settings" ? "AI Settings / 语言" : panel === "resume" ? "Resume / 简历" : "Shortcuts"}</button>
        <div className="pw-live-settings-content">{panel === "settings" ? <AISettings /> : panel === "resume" ? <ResumePanel /> : <dl className="pw-live-shortcuts">{[["Solve", "⌘ ↵"], ["Screenshot", "⌘ H"], ["Show / Hide", "⌘ B"], ["Start Over", "⌘ G"], ["Start / Stop Listening", "⌘ ⇧ \\"], ["Response / Transcripts", "⌥ 1 / ⌥ 2"], ["Scroll", "⌘ ⇧ ↑ / ↓"], ["Move", "⌘ arrows"]].map(([label, key]) => <div key={label}><dt>{label}</dt><dd>{key}</dd></div>)}</dl>}</div>
      </div> : <>
        <div className="pw-live-scroll" ref={scroll} style={{ maxHeight: viewport.height * 2 / 3 }} onScroll={event => { const element = event.currentTarget; const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 50; setPinned(nearBottom); scrollOffsets.current[tab] = element.scrollTop; }}>
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
            {transcripts.length === 0 ? <p className="pw-live-empty-transcript">{captureStatus === "starting" ? "Establishing connection…" : captureStatus === "paused" ? "Session paused" : captureStatus === "recording" ? "Listening for audio…" : 'Click "Start Interview" to create your first transcript.'}</p> : transcripts.map(segment => <article className={`pw-live-segment source-${segment.source} ${segment.isFinal ? "final" : "partial"}`} key={segment.id} aria-label={`${SOURCE_LABELS[segment.source]}${segment.isFinal ? "" : " · 识别中"}`} title={`${SOURCE_LABELS[segment.source]} · ${clockLabel(segment.receivedAt)}`}>
              <p>{segment.text}</p>{segment.source === "unknown" && <small>来源未知</small>}{!segment.isFinal && <span className="pw-live-caret" aria-hidden="true" />}
            </article>)}
            {snapshot?.transcriptTruncated && <p className="pw-live-context-note">Earlier transcript exceeded the retention limit.</p>}
          </section>
        </div>
        {!pinned && <button type="button" className="pw-live-follow" onClick={() => setPinned(true)}><ArrowDown size={12} />View Latest</button>}
        {(tab === "answers" && answers.length > 0 && !generating || tab === "transcript" && !active && transcripts.length > 0) && <footer className="pw-live-bottom-actions">{tab === "answers" && <button type="button" aria-label="Scroll Up" onClick={() => scroll.current?.scrollBy({ top: -300, behavior: "smooth" })}>Scroll Up <Keycaps keys={["⌘", "⇧", "↑"]} /></button>}<button type="button" disabled={clearing} onClick={() => void startOver()}>Start Over <Keycaps keys={["⌘", "G"]} /></button></footer>}
      </>}
      <div className="pw-live-resize" role="separator" aria-label="调整内容宽度" aria-orientation="vertical" {...dragEvents} onPointerDown={event => beginDrag(event, "resize")} />
    </section>}

    <div className="pw-live-island">
      {screenshots.length > 0 && <div className="pw-live-attachments pw-glass" data-overlay-interactive aria-label="待提交截图"><div className="pw-live-thumbnails">{screenshots.map((shot, index) => <figure key={shot.path}><img src={shot.preview} alt={`截图 ${index + 1}`} /><button type="button" aria-label={`删除截图 ${index + 1}`} onClick={() => void deleteScreenshot(shot.path)}><X size={10} /></button></figure>)}</div><label><input type="checkbox" checked={includeScreenshots} onChange={event => setIncludeScreenshots(event.target.checked)} />Include screenshots</label></div>}
      {manualInput && !panel && <form className="pw-live-composer pw-glass" data-overlay-interactive onSubmit={event => { event.preventDefault(); void submitQuestion(); }}>
        <textarea ref={input} aria-label="会话提问" value={question} rows={2} placeholder={active ? "Ask about your screen or audio" : "Ask about your screen"} onChange={event => { draftRevision.current++; setQuestion(event.target.value); }} onFocus={() => { void api.setOverlayFocus(true).catch(() => {}); }} onKeyDown={event => { if (event.key === "Escape") { setManualInput(false); void api.setOverlayFocus(false).catch(() => {}); } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); void submitQuestion(); } }} />
        <button type="submit" disabled={!canAsk} aria-label="发送问题">Submit <Keycaps keys={["↵"]} /></button>
      </form>}
    </div>
    </div>
    <div ref={toolbar} className="pw-live-toolbar pw-glass" data-overlay-interactive style={{ left: position.x, top: position.y }}>
      <button type="button" className="pw-live-drag" aria-label="移动浮条" {...dragEvents} onPointerDown={event => beginDrag(event, "move")}><GripVertical size={13} /></button>
      <div className="pw-live-toolbar-actions">
      <button type="button" className="pw-live-credits" title="PassWisely account & credits" onClick={() => { void api.accountOpenPortal(); }}>{credits} credits</button>
      <img className="pw-live-toolbar-brand" src="./logo512.png" alt="PassWisely" width={24} height={24} draggable={false} />
      <div className="pw-live-capture-controls">
        {controls.showStart && !snapshot?.captureNeedsCleanup ? <button type="button" className="pw-live-start" disabled={loading || controls.startDisabled} title={hasSessionText ? "开始新会话将清空当前转录和回答。音频将发送并保存至你的 Recall 项目。" : "音频将发送并保存至你的 Recall 项目；点击后开始英文实时转录。"} onClick={() => void runCapture(api.liveStart, "start")}><Play size={11} />Start Interview</button> : captureStatus === "recording" || captureStatus === "paused" ? <>
          <button type="button" className="pw-live-pause" disabled={captureBusy} title={captureStatus === "paused" ? "Resume Listening" : "Pause Listening"} aria-label={captureStatus === "paused" ? "Resume Listening / 继续采集" : "Pause Listening / 暂停采集"} onClick={() => void runCapture(captureStatus === "paused" ? api.liveResume : api.livePause)}>{captureStatus === "paused" ? <Play size={11} /> : <Pause size={11} />}</button>
          <span className={`pw-live-waveform ${captureStatus === "paused" ? "paused" : ""}`} role="status" aria-label={CAPTURE_LABELS[captureStatus]}><i /><i /><i /><i /><i /></span>
          {captureStatus === "paused" && <button type="button" className="pw-live-done" disabled={controls.stopDisabled} title="Stop Listening" onClick={() => void runCapture(api.liveStop, "stop")}>Done <Square size={9} /></button>}
        </> : <button type="button" className="pw-live-done" disabled={controls.stopDisabled} onClick={() => void runCapture(api.liveStop, "stop")}>{captureStatus === "starting" ? "Cancel" : snapshot?.captureNeedsCleanup && ["ended", "error"].includes(captureStatus) ? "Release audio" : "Stopping…"}</button>}
      </div>
      <span className="pw-live-divider" />
      <button type="button" className="pw-live-command" disabled={screenshotBusy || clearing} aria-label="Take Screenshot / 截图" onClick={() => void captureScreenshot()}>{screenshotBusy && <Loader2 className="pw-live-spinning" size={16} />}Take Screenshot <Keycaps keys={["⌘", "H"]} /></button>
      <button type="button" className="pw-live-command" disabled={!canAsk} aria-label="Solve / 生成回答" onClick={() => void submitQuestion()}>Solve <Keycaps keys={["⌘", "↵"]} /></button>
      <button type="button" className={`pw-live-command ${manualInput ? "selected" : ""}`} title="Ask a question / 手动输入" aria-label="手动输入问题" aria-pressed={manualInput} onClick={() => { setManualInput(!manualInput); setCollapsed(false); setPanel(null); }}><MessageSquare size={14} /></button>
      {collapsed && <button type="button" className="pw-live-command" onClick={() => setCollapsed(false)}>Expand</button>}
      <button type="button" className="pw-live-command" onClick={() => { void api.toggleMainWindow(); }}>Show / Hide <Keycaps keys={["⌘", "B"]} /></button>
      </div>
      <div className="pw-live-settings-anchor" onPointerEnter={openSettings} onPointerLeave={closeSettings}>
        <button type="button" className="pw-live-icon" aria-label="Settings / 设置" aria-expanded={settingsOpen} onClick={() => { if (settingsTimer.current) clearTimeout(settingsTimer.current); setSettingsOpen(!settingsOpen); }}><Settings size={14} /></button>
        {settingsOpen && <div className="pw-live-menu pw-glass" role="menu" data-placement={menuPlacement} style={{ top: menuPlacement === "below" ? "calc(100% + 8px)" : "auto", bottom: menuPlacement === "above" ? "calc(100% + 8px)" : "auto", maxHeight: menuPlacement === "below" ? menuBelow : menuAbove }}><strong>PassWisely</strong><span>{credits} credits</span>
          <button type="button" role="menuitem" onClick={() => { setPanel("settings"); setSettingsOpen(false); }}>AI Settings · Language</button>
          <button type="button" role="menuitem" onClick={() => { setPanel("resume"); setSettingsOpen(false); }}>Resume / 简历助手</button>
          <button type="button" role="menuitem" onClick={() => { setSettingsOpen(false); onProgramming?.(); }}>Programming / 编程解题</button>
          <button type="button" role="menuitem" onClick={() => { setPanel("shortcuts"); setSettingsOpen(false); }}>Keyboard Shortcuts</button>
          <button type="button" role="menuitem" disabled={clearing} onClick={() => void startOver()}>Start Over <Keycaps keys={["⌘", "G"]} /></button>
          <button type="button" role="menuitem" onClick={() => { void api.accountOpenPortal(); }}>Account & credits</button>
          <button type="button" role="menuitem" onClick={() => { void api.accountLogout().then(result => { if (result.success) window.location.reload(); else setError(result.error || "Sign out failed."); }).catch(reason => setError(errorText(reason))); }}>Sign out</button>
          <button type="button" role="menuitem" onClick={() => { void api.quitApp().catch(reason => setError(errorText(reason))); }}>Quit PassWisely</button>
          <p className="pw-live-audio-notice">English ASR. 音频将发送并保存至你的 Recall 项目，用于实时转录。点击 Start Interview 后才开始采集。{hasSessionText && " 新会话会清空当前转录和回答。"}</p>
        </div>}
      </div>
    </div>
  </section>;
}
