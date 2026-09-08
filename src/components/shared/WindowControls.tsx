import { useState } from "react";
import { Minus, Plus, Square, Copy, X } from "lucide-react";

export function WindowControls({ isZh = true }: { isZh?: boolean }) {
  const isMac = window.electronAPI.getPlatform() === "darwin";
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  const controls = [
    { id: "close", label: isZh ? "退出程序" : "Quit application", Icon: X,
      run: () => window.electronAPI.quitApp() },
    { id: "minimize", label: isZh ? "最小化" : "Minimize", Icon: Minus,
      run: () => window.electronAPI.minimizeWindow() },
    { id: "maximize", label: maximized ? (isZh ? "还原窗口" : "Restore window") : (isZh ? "最大化" : "Maximize"),
      Icon: isMac ? (maximized ? Minus : Plus) : (maximized ? Copy : Square),
      run: async () => {
        const result = await window.electronAPI.toggleMaximizeWindow();
        if (result.success) setMaximized(Boolean(result.maximized));
        return result;
      } },
  ];
  const ordered = isMac ? controls : [controls[1], controls[2], controls[0]];
  return <div className={`auth-titlebar ${isMac ? "mac" : "windows"}`}>
    <div className="window-controls" aria-label={isZh ? "窗口控制" : "Window controls"}>
      {ordered.map(({ id, label, Icon, run }) => <button key={id} type="button"
        className={`window-control ${id}`} aria-label={label} title={label}
        onClick={() => { setError(""); void run().then(result => {
          if (!result.success) setError(isZh ? "窗口操作失败，请重试" : "Window action failed. Please retry.");
        }).catch(() => setError(isZh ? "窗口操作失败，请重试" : "Window action failed. Please retry.")); }}>
        <Icon size={isMac ? 10 : 12} strokeWidth={2} aria-hidden="true" />
      </button>)}
    </div>
    {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
  </div>;
}
