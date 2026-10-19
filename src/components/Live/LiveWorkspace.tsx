import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Check, ChevronLeft, Copy, FileUser, Loader2, Mic, Monitor, Pause, Play, Radio, Settings, Square, Trash2, X } from "lucide-react";
import type { CaptureStatus, LiveResult, LiveSessionAPI, LiveSnapshot } from "../../../electron/live/types";
import type { Screenshot } from "../../types/screenshots";
import { AISettings } from "../shared/AISettings";
import { ResumePanel } from "../shared/ResumePanel";
import { AnswerMarkdown } from "./AnswerMarkdown";
import "./live.css";

const CAPTURE_LABELS: Record<CaptureStatus, string> = {
  idle: "尚未开始", starting: "正在连接", recording: "正在聆听", pausing: "正在暂停",
  paused: "会话已暂停", resuming: "正在恢复", stopping: "正在结束", ended: "会话已结束", error: "采集不可用",
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

function elapsedLabel(startedAt: number | undefined, endedAt: number | undefined, now: number): string {
  const seconds = startedAt ? Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 1000)) : 0;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
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

export default function LiveWorkspace({ visible, onSnapshot }: { visible: boolean; onSnapshot?: (snapshot: LiveSnapshot) => void }) {
  const api = window.electronAPI as typeof window.electronAPI & LiveSessionAPI;
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const snapshotRef = useRef<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [includeScreenshots, setIncludeScreenshots] = useState(true);
  const [question, setQuestion] = useState("");
  const [tab, setTab] = useState<"transcript" | "answers">("transcript");
  const [panel, setPanel] = useState<"settings" | "resume" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [followTranscript, setFollowTranscript] = useState(true);
  const [followAnswers, setFollowAnswers] = useState(true);
  const transcriptScroll = useRef<HTMLDivElement>(null);
  const answerScroll = useRef<HTMLDivElement>(null);
  const screenshotRead = useRef(0);
  const alive = useRef(false);
  const askLocked = useRef(false);
  const captureLocked = useRef(false);
  const captureOperation = useRef(0);
  const captureAction = useRef<"start" | "normal" | "stop" | null>(null);
  const shortcutAction = useRef<() => void>(() => {});
  const publishSnapshot = useRef(onSnapshot);
  publishSnapshot.current = onSnapshot;

  useEffect(() => {
    alive.current = true;
    if (typeof api.liveGetSnapshot !== "function" || typeof api.onLiveSnapshot !== "function") {
      setError("当前版本尚未接入实时会话，请更新应用。");
      setLoading(false);
      return () => { alive.current = false; };
    }
    const accept = (next: LiveSnapshot) => {
      if (!alive.current || !isNewerLiveSnapshot(snapshotRef.current, next)) return;
      snapshotRef.current = next;
      setSnapshot(next);
      publishSnapshot.current?.(next);
      setLoading(false);
    };
    // Subscribe first: a slower initial read must not overwrite a newer IPC update.
    const unsubscribe = api.onLiveSnapshot(accept);
    void api.liveGetSnapshot().then(accept).catch((reason) => {
      if (alive.current && !snapshotRef.current) { setError(errorText(reason)); setLoading(false); }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (typeof api.liveSetWorkspace !== "function") return;
    // Visibility changes send their new value. An old effect's cleanup must not
    // send false after the next workspace has already become active.
    void api.liveSetWorkspace(visible).catch((reason) => {
      if (alive.current) setError(errorText(reason));
    });
  }, [visible]);

  useEffect(() => {
    if (typeof api.onLiveAskShortcut !== "function") return;
    return api.onLiveAskShortcut(() => shortcutAction.current());
  }, []);

  const refreshScreenshots = useCallback(async () => {
    const read = ++screenshotRead.current;
    try {
      const next = await window.electronAPI.getScreenshots();
      if (alive.current && read === screenshotRead.current) setScreenshots(next);
    } catch (reason) {
      if (alive.current && read === screenshotRead.current) setError(`截图读取失败：${errorText(reason)}`);
    }
  }, []);

  useEffect(() => {
    const off = window.electronAPI.onScreenshotTaken(() => { void refreshScreenshots(); });
    const offReset = window.electronAPI.onResetView(() => { void refreshScreenshots(); });
    void refreshScreenshots();
    return () => { screenshotRead.current++; off(); offReset(); };
  }, [refreshScreenshots]);

  useEffect(() => { if (visible) void refreshScreenshots(); }, [visible, refreshScreenshots]);
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  const transcripts = snapshot?.transcripts ?? [];
  const answers = snapshot?.answers ?? [];
  const generating = answers.some((answer) => answer.status === "preparing" || answer.status === "streaming");
  const hasTranscript = transcripts.some((segment) => segment.isFinal && segment.text.trim());
  const hasContext = !!question.trim() || hasTranscript || (includeScreenshots && screenshots.length > 0);
  const canAsk = !!snapshot && hasContext && !generating && !answerBusy && !screenshotBusy;
  const captureStatus = snapshot?.captureStatus ?? "idle";
  const transitional = ["starting", "pausing", "resuming", "stopping"].includes(captureStatus);
  const captureControls = liveCaptureControls(snapshot, captureBusy);
  const hasSessionText = transcripts.length > 0 || answers.length > 0;

  useLayoutEffect(() => {
    if (followTranscript && visible && transcriptScroll.current) transcriptScroll.current.scrollTop = transcriptScroll.current.scrollHeight;
  }, [snapshot?.transcripts, followTranscript, tab, panel, visible]);
  useLayoutEffect(() => {
    if (followAnswers && visible && answerScroll.current) answerScroll.current.scrollTop = answerScroll.current.scrollHeight;
  }, [snapshot?.answers, followAnswers, tab, panel, visible]);

  const runCapture = async (operation: () => Promise<LiveResult>, action: "start" | "normal" | "stop" = "normal") => {
    const current = snapshotRef.current;
    const releasingPending = action === "stop" && captureAction.current !== "stop" &&
      (current?.captureStatus === "starting" || (current?.captureNeedsCleanup && ["ended", "error"].includes(current.captureStatus)));
    if (captureLocked.current && !releasingPending) return;
    const operationId = ++captureOperation.current;
    captureAction.current = action;
    captureLocked.current = true;
    setCaptureBusy(true); setError("");
    try {
      const result = await operation();
      if (operationId !== captureOperation.current) return;
      if (!result.success) throw new Error(result.error || "采集操作失败。");
      if (action === "start") { setTab("transcript"); setPanel(null); }
    } catch (reason) { if (alive.current && operationId === captureOperation.current) setError(errorText(reason)); }
    finally {
      if (operationId === captureOperation.current) {
        captureLocked.current = false; captureAction.current = null;
        if (alive.current) setCaptureBusy(false);
      }
    }
  };

  const submitQuestion = async () => {
    if (!canAsk || askLocked.current) return;
    askLocked.current = true;
    const submittedQuestion = question;
    setAnswerBusy(true); setError(""); setTab("answers"); setPanel(null); setFollowAnswers(true);
    try {
      const result = await api.liveAsk({ question: submittedQuestion.trim(), includeScreenshots });
      if (!result.success) throw new Error(result.error || "回答请求失败。");
      // Preserve text typed while this request was being accepted.
      if (alive.current) setQuestion((current) => current === submittedQuestion ? "" : current);
    } catch (reason) { if (alive.current) setError(errorText(reason)); }
    finally { askLocked.current = false; if (alive.current) setAnswerBusy(false); }
  };
  // The native shortcut listener remains mounted, while its action always reads
  // the current draft, attachments, visibility and open panel.
  shortcutAction.current = () => { if (visible && !panel) void submitQuestion(); };

  const answerAction = async (operation: () => Promise<LiveResult>) => {
    setError("");
    try { const result = await operation(); if (!result.success) throw new Error(result.error || "操作失败。"); }
    catch (reason) { if (alive.current) setError(errorText(reason)); }
  };

  const captureScreenshot = async () => {
    if (screenshotBusy) return;
    setScreenshotBusy(true); setError("");
    try {
      const result = await api.triggerScreenshot();
      if (!result.success) throw new Error(result.error || "截图失败。");
      await refreshScreenshots();
    } catch (reason) { if (alive.current) setError(errorText(reason)); }
    finally { if (alive.current) setScreenshotBusy(false); }
  };

  const deleteScreenshot = async (path: string) => {
    setError("");
    try {
      const result = await api.deleteScreenshot(path);
      if (!result.success) throw new Error(result.error || "截图删除失败。");
      await refreshScreenshots();
    } catch (reason) { if (alive.current) setError(errorText(reason)); }
  };

  return <section className="pw-live" aria-label="实时会话工作区" hidden={!visible}>
    <header className="pw-live-toolbar">
      <div className="pw-live-session-status">
        <span className={`pw-live-status-dot ${captureStatus === "recording" ? "recording" : ""}`} aria-hidden="true" />
        <div><strong role="status">{loading ? "正在读取会话" : CAPTURE_LABELS[captureStatus]}</strong>
          <span className="pw-live-sdk"><Radio size={11} aria-hidden="true" /> Recall V2 · {snapshot?.platformSupported === false ? "当前平台不支持采集" : "英文实时转录"}</span></div>
        <time className="pw-live-timer" title="会话时长（包含暂停时间）">{elapsedLabel(snapshot?.startedAt, snapshot?.endedAt, now)}</time>
      </div>
      <div className="pw-live-controls">
        {captureControls.showStart ? <button type="button" className="pw-live-button primary" disabled={loading || captureControls.startDisabled}
          title={hasSessionText ? "开始新会话将清空当前转录和回答" : "开始音频采集"}
          onClick={() => void runCapture(api.liveStart, "start")}><Play size={13} />{hasSessionText || captureStatus === "ended" ? "新会话" : "开始会话"}</button>
          : <button type="button" className="pw-live-button" disabled={transitional || captureBusy || !["recording", "paused"].includes(captureStatus)}
            onClick={() => void runCapture(captureStatus === "paused" ? api.liveResume : api.livePause)}>
            {transitional || captureBusy ? <Loader2 className="pw-live-spinning" size={13} /> : captureStatus === "paused" ? <Play size={13} /> : <Pause size={13} />}
            {captureStatus === "paused" ? "继续" : transitional ? "处理中" : "暂停"}</button>}
        <button type="button" className="pw-live-button" disabled={captureControls.stopDisabled} onClick={() => void runCapture(api.liveStop, "stop")}><Square size={12} />{captureControls.stopLabel}</button>
        <span className="pw-live-divider" />
        <button type="button" className={`pw-live-icon ${panel === "resume" ? "selected" : ""}`} aria-label="简历助手" title="简历助手" aria-pressed={panel === "resume"} onClick={() => setPanel(panel === "resume" ? null : "resume")}><FileUser size={16} /></button>
        <button type="button" className={`pw-live-icon ${panel === "settings" ? "selected" : ""}`} aria-label="模型设置" title="模型设置" aria-pressed={panel === "settings"} onClick={() => setPanel(panel === "settings" ? null : "settings")}><Settings size={16} /></button>
      </div>
    </header>

    <p className="pw-live-audio-notice">当前为英文实时 ASR，中文尚未接入。音频将发送并保存至你的 Recall 项目。点击“开始会话”后才开始采集。</p>
    {hasSessionText && captureControls.showStart && <p className="pw-live-audio-notice">当前转录和回答仍可查看、复制及继续提问；开始新会话会清空这些内容。</p>}

    {(error || snapshot?.error || snapshot?.platformMessage) && <div className="pw-live-alert" role={error || snapshot?.error ? "alert" : "status"}>
      <span>{error || snapshot?.error || snapshot?.platformMessage}</span>
      {error && <button type="button" className="pw-live-icon" aria-label="关闭操作提示" onClick={() => setError("")}><X size={13} /></button>}
    </div>}

    {panel ? <div className="pw-live-settings-view">
      <button type="button" className="pw-live-back" onClick={() => setPanel(null)}><ChevronLeft size={14} />返回会话 · {panel === "settings" ? "模型设置" : "简历助手"}</button>
      <div className="pw-live-settings-content">{panel === "settings" ? <AISettings /> : <ResumePanel />}</div>
    </div> : <>
      <nav className="pw-live-mobile-tabs" aria-label="会话内容">
        <button type="button" aria-pressed={tab === "transcript"} onClick={() => setTab("transcript")}>转录 <span>{transcripts.length}</span></button>
        <button type="button" aria-pressed={tab === "answers"} onClick={() => setTab("answers")}>AI 回答 <span>{answers.length}</span>{generating && <span className="pw-live-small-dot" />}</button>
      </nav>
      <div className={`pw-live-content show-${tab}`}>
        <section className="pw-live-pane pw-live-transcript-pane" aria-label="会话转录">
          <div className="pw-live-pane-heading"><h2>会话转录</h2><span>仅按音频来源标记</span></div>
          <div className="pw-live-scroll" ref={transcriptScroll} onScroll={(event) => { const el = event.currentTarget; setFollowTranscript(el.scrollHeight - el.scrollTop - el.clientHeight < 50); }}>
            {transcripts.length === 0 ? <div className="pw-live-empty"><Mic size={24} strokeWidth={1.5} /><strong>{captureStatus === "recording" ? "正在等待语音" : "听到的内容，留在这里"}</strong>
              <p>{captureStatus === "paused" ? "会话暂停。继续后接收新的转录。" : "开始会话后显示真实转录。也可直接输入或截图提问。"}</p></div>
              : transcripts.map((segment) => <article className={`pw-live-segment source-${segment.source} ${segment.isFinal ? "final" : "partial"}`} key={segment.id}>
                <div className="pw-live-segment-meta"><span>{segment.source === "microphone" ? <Mic size={11} /> : segment.source === "system" ? <Monitor size={11} /> : <Radio size={11} />}{SOURCE_LABELS[segment.source]}</span>
                  <time dateTime={new Date(segment.receivedAt).toISOString()}>{clockLabel(segment.receivedAt)}</time>{!segment.isFinal && <span className="pw-live-interim-label">识别中</span>}</div>
                <p>{segment.text}{!segment.isFinal && <span className="pw-live-caret" aria-hidden="true" />}</p>
              </article>)}
            {snapshot?.transcriptTruncated && <p className="pw-live-context-note">较早转录已超出保留范围；回答使用当前保留的上下文。</p>}
          </div>
          {!followTranscript && <button type="button" className="pw-live-follow" onClick={() => setFollowTranscript(true)}><ArrowDown size={12} />跟随最新转录</button>}
        </section>
        <section className="pw-live-pane pw-live-answer-pane" aria-label="AI 回答">
          <div className="pw-live-pane-heading"><h2>AI 回答</h2><button type="button" className="pw-live-text-button" disabled={answers.length === 0 || generating || answerBusy} onClick={() => void answerAction(api.liveClearAnswers)}><Trash2 size={12} />清空回答</button></div>
          <div className="pw-live-scroll" ref={answerScroll} onScroll={(event) => { const el = event.currentTarget; setFollowAnswers(el.scrollHeight - el.scrollTop - el.clientHeight < 50); }}>
            {answers.length === 0 ? <div className="pw-live-empty"><Radio size={25} strokeWidth={1.5} /><strong>把上下文变成下一步</strong><p>输入问题，或使用已定稿转录与截图。回答由你手动触发。</p></div>
              : answers.map((answer) => <article className="pw-live-answer" key={answer.id}>
                <div className="pw-live-question"><span>你的提问</span><p>{answer.question || "根据当前会话上下文提供建议"}</p>{answer.screenshotCount > 0 && <small><Camera size={11} />{answer.screenshotCount} 张截图</small>}</div>
                <div className="pw-live-answer-meta"><span>{answer.status === "preparing" || answer.status === "streaming" ? <Loader2 className="pw-live-spinning" size={12} /> : <Radio size={12} />}
                  {answer.status === "preparing" ? "正在准备上下文" : answer.status === "streaming" ? "正在回答" : answer.status === "cancelled" ? "已停止 · 保留已生成内容" : answer.status === "error" ? "回答未完成" : "回答完成"}
                  {answer.model && <small>{answer.model}</small>}</span>{answer.text && <CopyText text={answer.text} />}</div>
                <div className="pw-live-answer-text">{answer.text ? <AnswerMarkdown text={answer.text} /> : answer.status === "preparing" || answer.status === "streaming" ? "等待首段内容…" : "尚未生成正文。"}{answer.status === "streaming" && answer.text && <span className="pw-live-caret" aria-hidden="true" />}</div>
                {answer.contextTruncated && <p className="pw-live-context-note">上下文超出预算，已使用最近内容。</p>}
                {answer.error && <p className="pw-live-answer-error" role="alert">{answer.error}</p>}
              </article>)}
          </div>
          {!followAnswers && <button type="button" className="pw-live-follow" onClick={() => setFollowAnswers(true)}><ArrowDown size={12} />回到最新回答</button>}
        </section>
      </div>
      <form className="pw-live-composer" onSubmit={(event) => { event.preventDefault(); void submitQuestion(); }}>
        {screenshots.length > 0 && <div className="pw-live-attachments" aria-label="待提交截图">
          <div className="pw-live-thumbnails">{screenshots.map((shot, index) => <figure key={shot.path}>
            <img src={shot.preview} alt={`截图 ${index + 1}`} /><figcaption>{index + 1}</figcaption>
            <button type="button" aria-label={`删除截图 ${index + 1}`} title="删除截图" onClick={() => void deleteScreenshot(shot.path)}><X size={11} /></button>
          </figure>)}</div>
          <label><input type="checkbox" checked={includeScreenshots} onChange={(event) => setIncludeScreenshots(event.target.checked)} />包含 {screenshots.length} 张截图</label>
          <span>发送后保留，可再次使用</span>
        </div>}
        <div className="pw-live-composer-input">
          <textarea aria-label="会话提问" value={question} rows={2} placeholder={hasTranscript ? "基于刚才的对话提问…" : "输入问题，或添加截图…"} onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); void submitQuestion(); } }} />
          <div className="pw-live-composer-actions"><button type="button" className="pw-live-icon" disabled={screenshotBusy} aria-label="添加屏幕截图" title="添加屏幕截图" onClick={() => void captureScreenshot()}>{screenshotBusy ? <Loader2 className="pw-live-spinning" size={17} /> : <Camera size={17} />}</button>
            {generating ? <button type="button" className="pw-live-button stop" onClick={() => void answerAction(api.liveCancelAnswer)}><Square size={12} />停止生成</button>
              : <button type="submit" className="pw-live-send" disabled={!canAsk} aria-label="发送问题" title="发送问题"><ArrowUp size={17} /></button>}</div>
        </div>
        <div className="pw-live-composer-note"><span>{hasTranscript ? "已包含本次会话转录与此前问答" : "手动问答 · 支持文字与截图"}</span><span>Enter 发送 · Shift + Enter 换行</span></div>
      </form>
    </>}
  </section>;
}
