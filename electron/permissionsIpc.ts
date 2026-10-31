import { ipcMain, type BrowserWindow } from "electron";
import type { PermissionService } from "./PermissionService";
import type { CapturePermissionId } from "./permissionsTypes";
const IDS = ["screen", "microphone", "system-audio", "accessibility"] as const;
export function initializePermissionIpc(service: PermissionService, getWindow: () => BrowserWindow | null, restart: () => Promise<{success: boolean; error?: string}>): void {
  const handle = (channel: string, operation: (input?: unknown) => unknown) => ipcMain.handle(channel, (event, input) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("Untrusted permission caller.");
    return operation(input);
  });
  const id = (input: unknown): CapturePermissionId => {
    if (!IDS.includes(input as never)) throw new Error("Invalid capture permission.");
    return input as CapturePermissionId;
  };
  handle("capture-permissions-get", () => service.snapshot());
  handle("capture-permissions-request", input => service.request(id(input)));
  handle("capture-permissions-settings", input => service.settings(id(input)));
  handle("capture-permissions-acknowledge", () => service.acknowledge());
  handle("capture-permissions-open", () => { getWindow()!.webContents.send("capture-permissions-needed"); });
  handle("capture-permissions-restart", async () => {
    const state = service.snapshot();
    if (state.audioCheckBusy || state.cleanupRequired) return { success: false, error: "请先停止并释放音频采集，再重启应用。" };
    return restart();
  });
}
