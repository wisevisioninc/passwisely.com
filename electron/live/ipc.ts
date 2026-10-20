import { BrowserWindow, clipboard, ipcMain } from "electron";
import type { LiveSessionService } from "./LiveSessionService";

export function initializeLiveIpc(service: LiveSessionService, getWindow: () => BrowserWindow | null, setWorkspace: (visible: boolean) => void, isAuthenticated: () => boolean): void {
  const handle = (channel: string, operation: (input?: any) => any) => ipcMain.handle(channel, (event, input) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("Untrusted session caller.");
    return operation(input);
  });
  // Native clipboard access avoids Chromium focus/permission requirements for
  // the background overlay. Keep writes behind the existing main-frame trust
  // boundary, with the same UTF-8 bound as a retained live answer.
  handle("live-copy-text", text => {
    if (typeof text !== "string") throw new Error("Invalid clipboard text.");
    if (Buffer.byteLength(text, "utf8") > 128 * 1024) throw new Error("Clipboard text exceeds 128 KiB.");
    clipboard.writeText(text);
    return { success: true };
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
  handle("live-start-over", () => service.startOver());
}
