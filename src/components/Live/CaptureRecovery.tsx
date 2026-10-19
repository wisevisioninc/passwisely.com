import { useEffect, useRef, useState } from "react";
import type { LiveSnapshot } from "../../../electron/live/types";
import { captureStatusNotice } from "./CaptureStatusNotice";
import { isNewerLiveSnapshot } from "./LiveWorkspace";

/** Remains reachable on the login screen if native resource release failed. */
export function CaptureRecovery() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef<LiveSnapshot | null>(null);
  useEffect(() => {
    let active = true;
    const api = window.electronAPI;
    const accept = (next: LiveSnapshot) => {
      if (!active || !isNewerLiveSnapshot(latest.current, next)) return;
      latest.current = next; setSnapshot(next);
    };
    const unsubscribe = api.onLiveSnapshot(accept);
    void api.liveGetSnapshot().then(accept).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "无法读取采集状态。"); });
    return () => { active = false; unsubscribe(); };
  }, []);
  const status = captureStatusNotice(snapshot);
  if (!status && !error) return null;
  const release = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await window.electronAPI.liveStop();
      if (!result.success) setError(result.error || "音频资源释放失败，请重试。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "音频资源释放失败，请重试。"); }
    finally { setBusy(false); }
  };
  return <aside className="pw-capture-recovery" aria-label="音频采集恢复">
    <div role="alert"><strong>{status || "采集状态读取失败"}</strong><p>账号尚未登录。主进程正在停止采集；若释放失败，可在这里重试。</p>
      {(error || snapshot?.error) && <p>{error || snapshot?.error}</p>}</div>
    {status && <button type="button" disabled={busy || snapshot?.captureStatus === "stopping"} onClick={() => void release()}>{busy ? "正在释放…" : "结束 / 释放音频采集"}</button>}
  </aside>;
}
