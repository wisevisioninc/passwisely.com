import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { WindowControls } from "../shared/WindowControls";
import type { CapturePermissionAPI, CapturePermissionId, CapturePermissionItem, CapturePermissionSnapshot, CapturePermissionStartupCheck, CapturePermissionStatus } from "../../../electron/permissionsTypes";
import "./permissionOnboarding.css";

interface PermissionOnboardingProps {
  onOpenChange: (open: boolean) => void;
  api?: CapturePermissionAPI;
}

const purposes: Record<CapturePermissionId, { name: string; description: string }> = {
  screen: { name: "屏幕截图", description: "用于截图提问。" },
  microphone: { name: "麦克风", description: "用于转写你的声音。" },
  "system-audio": { name: "系统音频", description: "用于转写电脑播放的声音。" },
  accessibility: { name: "辅助功能", description: "语音功能需要此权限。" },
};
const statusLabels: Record<CapturePermissionStatus, string> = {
  granted: "已授权", "not-granted": "未授权", "not-determined": "未授权", not_requested: "未授权", denied: "未授权", restricted: "系统限制",
  not_installed: "组件未安装", error: "检查失败", unknown: "待确认", "not-required": "无需单独授权", unsupported: "暂不支持",
};
const message = (reason: unknown, fallback: string) => reason instanceof Error ? reason.message || fallback : typeof reason === "string" && reason.trim() ? reason : fallback;
const actionLabel = (item: CapturePermissionItem) => {
  if (item.action === "settings") return "打开设置";
  if (item.id === "screen") return "授权截图";
  if (item.id === "system-audio" && item.status === "granted" && item.observedAt !== undefined) return "再次检测";
  return "去授权";
};

/** Owns guide visibility and permission IPC, independently of account state. */
export function PermissionOnboarding({ onOpenChange, api = window.electronAPI }: PermissionOnboardingProps) {
  const [open, setOpen] = useState(false);
  const [presentation, setPresentation] = useState<"automatic" | "manual">("automatic");
  const [snapshot, setSnapshot] = useState<CapturePermissionSnapshot | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const root = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const awaySinceOpen = useRef(false);
  const snapshotRef = useRef<CapturePermissionSnapshot | null>(null);
  const busyRef = useRef(false);
  const refreshPending = useRef(false);
  const initialOpenAllowed = useRef(true);
  const startupCheck = useRef<Promise<CapturePermissionStartupCheck> | null>(null);
  const lifetime = useRef(0);
  const active = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const changeOpen = useCallback((value: boolean) => { awaySinceOpen.current = false; openRef.current = value; setOpen(value); }, []);
  const accept = useCallback((next: CapturePermissionSnapshot | null) => { snapshotRef.current = next; setSnapshot(next); }, []);
  const close = useCallback(() => { initialOpenAllowed.current = false; refreshPending.current = false; changeOpen(false); }, [changeOpen]);

  // Panel refreshes join the same gate as actions. Returning from a system dialog
  // queues a fresh observation instead of overlapping the in-flight request.
  const refresh = useCallback(async () => {
    if (!active.current || !openRef.current) return;
    if (busyRef.current) { refreshPending.current = true; return; }
    const current = lifetime.current;
    busyRef.current = true; setOperation("refresh"); setError(""); setNotice("");
    try {
      const next = await api.getCapturePermissions();
      if (!active.current || lifetime.current !== current) return;
      accept(next); setReadError("");
    } catch (reason) {
      if (!active.current || lifetime.current !== current) return;
      accept(null); setReadError(message(reason, "无法读取权限，请重试。"));
    } finally {
      if (active.current && lifetime.current === current) {
        busyRef.current = false; setOperation(null);
        if (refreshPending.current) { refreshPending.current = false; if (openRef.current) void refreshRef.current(); }
      }
    }
  }, [api, accept]);
  refreshRef.current = refresh;

  useEffect(() => {
    active.current = true; lifetime.current += 1; busyRef.current = false;
    const current = lifetime.current;
    const remove = api.onCapturePermissionsNeeded(() => {
      initialOpenAllowed.current = false;
      setPresentation("manual"); changeOpen(true); void refreshRef.current();
    });
    const left = () => { if (openRef.current) awaySinceOpen.current = true; };
    const returned = () => {
      if (!openRef.current || !awaySinceOpen.current || document.visibilityState !== "visible") return;
      awaySinceOpen.current = false;
      void refreshRef.current();
    };
    const visible = () => { if (document.visibilityState === "hidden") left(); else returned(); };
    window.addEventListener("blur", left);
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", visible);
    // Startup is read-only and silent until the native owner reports a known
    // missing permission. Reuse the promise across effect replays; manual open
    // or dismissal takes presentation ownership from any late startup result.
    startupCheck.current ||= Promise.resolve().then(() => api.getCapturePermissionStartupCheck());
    void startupCheck.current.then(result => {
      if (!active.current || lifetime.current !== current || !initialOpenAllowed.current) return;
      initialOpenAllowed.current = false;
      accept(result.snapshot); setReadError("");
      if (result.shouldPrompt) changeOpen(true);
    }, reason => {
      if (!active.current || lifetime.current !== current || !initialOpenAllowed.current) return;
      initialOpenAllowed.current = false;
      accept(null); setReadError(message(reason, "无法读取权限，请重试。"));
    });
    return () => {
      active.current = false; lifetime.current += 1; refreshPending.current = false;
      remove(); window.removeEventListener("blur", left); window.removeEventListener("focus", returned); document.removeEventListener("visibilitychange", visible);
    };
  }, [api, accept, changeOpen, refresh]);
  useEffect(() => { onOpenChange(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open]);

  const run = async (kind: string, work: () => Promise<void>) => {
    if (!active.current || !openRef.current || busyRef.current || snapshotRef.current?.audioCheckBusy) return;
    const current = lifetime.current;
    busyRef.current = true; setOperation(kind); setError(""); setNotice("");
    try { await work(); }
    catch (reason) {
      if (active.current && lifetime.current === current) {
        accept(null); setReadError(message(reason, "操作失败，请重试。"));
      }
    } finally {
      if (active.current && lifetime.current === current) {
        busyRef.current = false; setOperation(null);
        if (refreshPending.current) { refreshPending.current = false; if (openRef.current) void refreshRef.current(); }
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
      if (!result.success) setError(result.error || "权限未就绪，请重试。");
      else if (item.action === "settings") setNotice("已打开设置，更改后返回即可。");
    });
  };
  const restart = () => {
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot?.restartRecommended || currentSnapshot.cleanupRequired) return;
    const current = lifetime.current;
    void run("restart", async () => {
      const result = await api.restartForCapturePermissions();
      if (active.current && lifetime.current === current && !result.success) setError(result.error || "暂时无法重启，请重试。");
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
        <div><span className="pw-permission-brand">PassWisely</span><h1 id={titleId}>{presentation === "automatic" ? "需要授权" : "权限设置"}</h1></div>
        <button type="button" className="pw-permission-close" aria-label="关闭权限指南" onClick={close}>×</button>
      </header>
      <div className="pw-permission-body">
        <p id={descriptionId} className="pw-permission-intro">{presentation === "manual" ? "管理截图和语音权限。" : snapshot?.audioSupported === false ? "授权后可使用截图。" : "授权后可使用截图和语音。"}</p>
        {snapshot && <p className="pw-permission-platform">{snapshot.platform === "darwin" ? "macOS" : snapshot.platform === "win32" ? "Windows" : "当前系统"}</p>}
        {readError ? <div className="pw-permission-error" role="alert"><strong>检查失败</strong><p>{readError}</p></div>
          : <div className="pw-permission-list">{snapshot?.items.map(item => {
            const purpose = purposes[item.id];
            const observedAt = item.id === "system-audio" && item.status === "granted" ? item.observedAt : undefined;
            return <section className="pw-permission-item" key={item.id} aria-label={purpose.name}>
              <div className="pw-permission-item-heading"><h2>{purpose.name}</h2><span className="pw-permission-status" data-status={item.status}
                title={observedAt !== undefined ? `上次检查：${new Date(observedAt).toLocaleString()}` : undefined}>{observedAt !== undefined ? "上次已授权" : statusLabels[item.status]}</span></div>
              <p>{purpose.description}</p>
              {["error", "unsupported", "restricted", "not_installed"].includes(item.status) && item.detail && <p className="pw-permission-detail">{item.detail}</p>}
              {item.action !== "none" && <button type="button" className="pw-permission-button" disabled={busy} aria-label={`${purpose.name}：${actionLabel(item)}`} onClick={() => act(item.id)}>{actionLabel(item)}</button>}
            </section>;
          })}</div>}
        {snapshot && !snapshot.audioSupported && snapshot.audioSupportMessage && <p className="pw-permission-warning" role="status">{snapshot.audioSupportMessage}</p>}
        {snapshot?.cleanupRequired && <p className="pw-permission-warning" role="status">音频尚未释放，请先结束采集再重试。</p>}
        {snapshot?.restartRecommended && <div className="pw-permission-restart"><p>建议保存后重启。</p>
          <button type="button" className="pw-permission-button" disabled={busy || snapshot.cleanupRequired} onClick={restart}>保存后重启</button></div>}
        {error && <p className="pw-permission-error" role="alert">{error}</p>}
        {notice && <p className="pw-permission-notice" role="status">{notice}</p>}
        {busy && <p className="pw-permission-notice" role="status">{operation === "refresh" ? "正在检查…" : snapshot?.audioCheckBusy && !operation ? "音频检查中…" : "正在处理…"}</p>}
      </div>
      <footer className="pw-permission-footer">
        <p>可稍后在设置中开启。</p>
        <div><button type="button" className="pw-permission-button" disabled={busy} onClick={() => void refresh()}>重新检查</button>
          <button type="button" className="pw-permission-button pw-permission-primary" onClick={close}>{presentation === "automatic" ? "稍后设置" : "完成"}</button></div>
      </footer>
    </div>
  </div>;
}
