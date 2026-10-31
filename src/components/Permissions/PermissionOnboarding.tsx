import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { WindowControls } from "../shared/WindowControls";
import type { CapturePermissionAPI, CapturePermissionId, CapturePermissionItem, CapturePermissionSnapshot, CapturePermissionStatus } from "../../../electron/permissionsTypes";
import "./permissionOnboarding.css";

interface PermissionOnboardingProps {
  onOpenChange: (open: boolean) => void;
  api?: CapturePermissionAPI;
}

const purposes: Record<CapturePermissionId, { name: string; description: string }> = {
  screen: { name: "屏幕截图", description: "在你主动截图时读取选定的显示器，为问题补充画面。" },
  microphone: { name: "麦克风", description: "在你开始语音会话后采集你的声音，用于转写与问答。" },
  "system-audio": { name: "系统音频", description: "在你开始语音会话后采集电脑播放的声音，用于会议转写与问答。" },
  accessibility: { name: "辅助功能", description: "macOS ARM 版音频采集组件需要此项系统授权。" },
};
const statusLabels: Record<CapturePermissionStatus, string> = {
  granted: "已授权", "not-determined": "尚未决定", not_requested: "尚未申请", denied: "未获授权", restricted: "受系统限制",
  not_installed: "组件尚未安装", error: "检查失败", unknown: "状态未确认", "not-required": "无需单独授权", unsupported: "当前系统不支持",
};
const message = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message : fallback;
const actionLabel = (item: CapturePermissionItem) => {
  if (item.action === "settings") return "打开系统设置";
  if (item.id === "screen") return "测试并申请";
  if (item.id === "system-audio" && item.status === "granted" && item.observedAt !== undefined) return "再次检测";
  return "申请权限";
};

/** Owns guide visibility and permission IPC, independently of account state. */
export function PermissionOnboarding({ onOpenChange, api = window.electronAPI }: PermissionOnboardingProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<CapturePermissionSnapshot | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const root = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const snapshotRef = useRef<CapturePermissionSnapshot | null>(null);
  const busyRef = useRef(false);
  const refreshPending = useRef(false);
  const initialOpenAllowed = useRef(true);
  const lifetime = useRef(0);
  const active = useRef(false);
  const refreshRef = useRef<(initial?: boolean) => Promise<void>>(async () => {});
  const changeOpen = useCallback((value: boolean) => { openRef.current = value; setOpen(value); }, []);
  const accept = useCallback((next: CapturePermissionSnapshot | null) => { snapshotRef.current = next; setSnapshot(next); }, []);
  const close = useCallback(() => { initialOpenAllowed.current = false; changeOpen(false); }, [changeOpen]);

  // Reads join the same gate as actions. Focus returning from a system dialog
  // queues a fresh observation instead of overlapping the in-flight request.
  const refresh = useCallback(async (initial = false) => {
    if (!active.current) return;
    if (busyRef.current) { refreshPending.current = true; return; }
    const current = lifetime.current;
    busyRef.current = true; setOperation("refresh"); setError(""); setNotice("");
    try {
      const next = await api.getCapturePermissions();
      if (!active.current || lifetime.current !== current) return;
      accept(next); setReadError("");
      if (initial && initialOpenAllowed.current && next.firstRun) changeOpen(true);
    } catch (reason) {
      if (!active.current || lifetime.current !== current) return;
      accept(null); setReadError(message(reason, "无法读取权限状态，请重新检查。"));
      if (initial && initialOpenAllowed.current) changeOpen(true);
    } finally {
      if (active.current && lifetime.current === current) {
        busyRef.current = false; setOperation(null);
        if (refreshPending.current) { refreshPending.current = false; void refreshRef.current(); }
      }
    }
  }, [api, accept, changeOpen]);
  refreshRef.current = refresh;

  useEffect(() => {
    active.current = true; lifetime.current += 1; busyRef.current = false;
    const remove = api.onCapturePermissionsNeeded(() => { changeOpen(true); void refreshRef.current(); });
    const focused = () => { if (openRef.current) void refreshRef.current(); };
    const visible = () => { if (document.visibilityState === "visible") focused(); };
    window.addEventListener("focus", focused);
    document.addEventListener("visibilitychange", visible);
    void refresh(true);
    return () => {
      active.current = false; lifetime.current += 1; refreshPending.current = false;
      remove(); window.removeEventListener("focus", focused); document.removeEventListener("visibilitychange", visible);
    };
  }, [api, changeOpen, refresh]);
  useEffect(() => { onOpenChange(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open]);

  const run = async (kind: string, work: () => Promise<void>) => {
    if (!active.current || busyRef.current || snapshotRef.current?.audioCheckBusy) return;
    const current = lifetime.current;
    busyRef.current = true; setOperation(kind); setError(""); setNotice("");
    try { await work(); }
    catch (reason) {
      if (active.current && lifetime.current === current) {
        accept(null); setReadError("无法确认最新权限状态，请重新检查。"); setError(message(reason, "权限操作失败，请重试。"));
      }
    } finally {
      if (active.current && lifetime.current === current) {
        busyRef.current = false; setOperation(null);
        if (refreshPending.current) { refreshPending.current = false; void refreshRef.current(); }
      }
    }
  };
  const act = (id: CapturePermissionId) => {
    // Resolve from the latest owned snapshot, including when a stale handler
    // outlives a render. Display status never chooses the operation.
    const item = snapshotRef.current?.items.find(value => value.id === id);
    if (!item || item.action === "none") return;
    const current = lifetime.current;
    void run(id, async () => {
      const result = await (item.action === "settings" ? api.openCapturePermissionSettings(id) : api.requestCapturePermission(id));
      if (!active.current || lifetime.current !== current) return;
      accept(result.snapshot); setReadError("");
      if (!result.success) setError(result.error || "权限尚未准备好，请按说明操作后重新检查。");
      else if (item.action === "settings") setNotice("已打开系统设置。更改后返回本窗口，状态将重新检查；打开设置本身不表示已授权。");
    });
  };
  const continueText = () => {
    if (!snapshotRef.current || readError) return;
    const current = lifetime.current;
    void run("acknowledge", async () => {
      const result = await api.acknowledgeCapturePermissionGuide();
      if (!active.current || lifetime.current !== current) return;
      accept(result.snapshot);
      if (result.success) close(); else setError(result.error || "无法保存已读状态，可以暂时关闭后重试。");
    });
  };
  const restart = () => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot?.restartRecommended || currentSnapshot.cleanupRequired) return;
    const current = lifetime.current;
    void run("restart", async () => {
      const result = await api.restartForCapturePermissions();
      if (active.current && lifetime.current === current && !result.success) setError(result.error || "暂时无法重启，请稍后重试。");
    });
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const controls = Array.from(root.current?.querySelectorAll<HTMLElement>("button:not(:disabled),[href],[tabindex='0']") ?? []);
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    const outside = !root.current?.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current || outside)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current || outside)) { event.preventDefault(); first.focus(); }
  };

  if (!open) return null;
  const busy = operation !== null || snapshot?.audioCheckBusy === true;
  return <div className="pw-permission-overlay" data-overlay-global>
    <div ref={root} className="pw-permission-card" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
      data-overlay-interactive tabIndex={-1} onKeyDown={keyboard}>
      <WindowControls />
      <header className="pw-permission-header">
        <img src="./logo512.png" alt="" width="36" height="36" />
        <div><span className="pw-permission-brand">PassWisely</span><h1 id={titleId}>截图与语音权限</h1></div>
        <button type="button" className="pw-permission-close" aria-label="关闭权限指南" onClick={close}>×</button>
      </header>
      <div className="pw-permission-body">
        <p id={descriptionId} className="pw-permission-intro">先了解用途，再按需开启。未登录也可以设置；你可以随时继续纯文字使用。</p>
        <p className="pw-permission-privacy">点击音频授权只检查和申请权限，不会录音或上传音频。屏幕测试会读取屏幕源缩略图，检查选定屏幕后丢弃，不保存、不上传。</p>
        {snapshot && <p className="pw-permission-platform">{snapshot.platform === "darwin" ? "macOS" : snapshot.platform === "win32" ? "Windows" : "当前系统"} · {snapshot.architecture}</p>}
        {readError ? <div className="pw-permission-error" role="alert"><strong>暂时无法确认权限状态</strong><p>{readError}</p><p>当前不会将任何权限显示为已授权。重新检查成功后才能保存指南已读状态。</p></div>
          : <div className="pw-permission-list">{snapshot?.items.map(item => {
            const purpose = purposes[item.id];
            const observedAt = item.id === "system-audio" && item.status === "granted" ? item.observedAt : undefined;
            return <section className="pw-permission-item" key={item.id} aria-label={purpose.name}>
              <div className="pw-permission-item-heading"><h2>{purpose.name}</h2><span className="pw-permission-status" data-status={item.status}>{observedAt !== undefined ? "上次检测已授权" : statusLabels[item.status]}</span></div>
              <p>{purpose.description}</p><p className="pw-permission-detail">{item.detail}</p>
              {observedAt !== undefined && <p className="pw-permission-detail">上次检测：{new Date(observedAt).toLocaleString()}。系统权限可能改变，可再次检测。</p>}
              {item.status === "unknown" && <p className="pw-permission-detail">尚未确认不代表已授权；使用此项采集前仍需系统验证。</p>}
              {snapshot.platform === "win32" && item.status === "not-required" && <p className="pw-permission-detail">Windows 无此项独立权限开关；仍受系统隐私设置与当前设备限制。</p>}
              {item.action !== "none" && <button type="button" className="pw-permission-button" disabled={busy} aria-label={`${purpose.name}：${actionLabel(item)}`} onClick={() => act(item.id)}>{actionLabel(item)}</button>}
            </section>;
          })}</div>}
        {snapshot && !snapshot.audioSupported && snapshot.audioSupportMessage && <p className="pw-permission-warning" role="status">{snapshot.audioSupportMessage}</p>}
        {snapshot?.restartRecommended && <div className="pw-permission-restart"><p>系统建议重启 PassWisely 以使权限更改生效。请先保存工作。</p>
          {snapshot.cleanupRequired && <p className="pw-permission-warning">当前音频采集尚未释放。请先关闭指南，结束 / 释放音频采集，再回来重新检查。</p>}
          <button type="button" className="pw-permission-button" disabled={busy || snapshot.cleanupRequired} onClick={restart}>保存工作后重启</button></div>}
        {error && <p className="pw-permission-error" role="alert">{error}</p>}
        {notice && <p className="pw-permission-notice" role="status">{notice}</p>}
        {busy && <p className="pw-permission-notice" role="status">{operation === "refresh" ? "正在检查权限状态…" : snapshot?.audioCheckBusy && !operation ? "另一项音频权限检查正在进行，请稍后重新检查。" : "正在处理，请稍候…"}</p>}
      </div>
      <footer className="pw-permission-footer">
        <p>继续仅记录你已看过指南，不表示授权。未授权的采集入口仍会由系统验证。以后可在设置中打开本指南。</p>
        <div><button type="button" className="pw-permission-button" disabled={busy} onClick={() => void refresh()}>重新检查</button>
          {readError ? <button type="button" className="pw-permission-button pw-permission-primary" onClick={close}>暂时关闭</button>
            : <button type="button" className="pw-permission-button pw-permission-primary" disabled={busy || !snapshot} onClick={continueText}>继续纯文字使用</button>}</div>
      </footer>
    </div>
  </div>;
}
