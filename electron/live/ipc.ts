import { BrowserWindow, ipcMain } from "electron";
import type { LiveSessionService } from "./LiveSessionService";

export function initializeLiveIpc(service: LiveSessionService, getWindow: () => BrowserWindow | null, setWorkspace: (visible: boolean) => void, isAuthenticated: () => boolean): void {
  const handle = (channel: string, operation: (input?: any) => any) => ipcMain.handle(channel, (event, input) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("Untrusted session caller.");
    return operation(input);
  });
  handle("live-get-snapshot", () => service.getSnapshot());
  handle("live-set-workspace", visible => { if (typeof visible !== "boolean") throw new Error("Invalid workspace."); setWorkspace(visible); });
  handle("live-start", () => isAuthenticated() ? service.start() : { success: false, error: "Please sign in." });
  handle("live-pause", () => service.pause());
  handle("live-resume", () => isAuthenticated() ? service.resume() : { success: false, error: "Please sign in." });
  handle("live-stop", () => service.stop());
  handle("live-ask", input => isAuthenticated() ? service.ask(input) : { success: false, error: "Please sign in." });
  handle("live-cancel-answer", () => service.cancelAnswer());
  handle("live-clear-answers", () => service.clearAnswers());
}
