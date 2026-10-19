import type { LiveSnapshot } from "../../../electron/live/types";

export function captureStatusNotice(snapshot: LiveSnapshot | null): string | null {
  if (!snapshot) return null;
  if (snapshot.captureNeedsCleanup && ["error", "ended"].includes(snapshot.captureStatus)) return "采集资源待释放";
  switch (snapshot.captureStatus) {
    case "starting": return "音频采集正在启动";
    case "recording": return "正在采集麦克风与系统声音";
    case "paused": return "音频已暂停 · 会话未结束";
    case "pausing": return "正在暂停音频";
    case "resuming": return "正在恢复音频";
    case "stopping": return "正在释放音频采集";
    default: return snapshot.captureNeedsCleanup ? "采集资源待释放" : null;
  }
}

export function CaptureStatusNotice({ snapshot, onReturn }: { snapshot: LiveSnapshot | null; onReturn: () => void }) {
  const status = captureStatusNotice(snapshot);
  if (!status) return null;
  return <button type="button" className="pw-workspace-capture" onClick={onReturn}>
    <span className={`pw-live-status-dot ${snapshot?.captureStatus === "recording" ? "recording" : ""}`} aria-hidden="true" />
    <span role="status">{status}</span><span>返回会话</span>
  </button>;
}
