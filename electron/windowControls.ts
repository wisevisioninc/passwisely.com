import { app, BrowserWindow, ipcMain, screen } from "electron";

let authWindow = true;
let restoreBounds: Electron.Rectangle | null = null;
// Only legacy workspaces are restored here. A live overlay retains its own geometry.
let workspaceBounds: Electron.Rectangle | null = null;
export function isAuthWindow() { return authWindow; }

export function initializeWindowControls(
  getWindow: () => BrowserWindow | null,
  onAuthChange: () => void = () => {},
  workspaceOwnsGeometry: () => boolean = () => false,
) {
  ipcMain.handle("set-auth-window", (event, enabled: boolean) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || typeof enabled !== "boolean") throw new Error("Untrusted window caller.");
    const changed = authWindow !== enabled;
    const enteringAuth = changed && enabled;
    const layoutChanged = changed || (enabled && !restoreBounds);
    // Read the active display before its live owner releases the window.
    const area = layoutChanged ? screen.getDisplayMatching(win.getBounds()).workArea : undefined;
    if (enteringAuth) {
      workspaceBounds = workspaceOwnsGeometry() ? null : win.getBounds();
      restoreBounds = null;
    }
    authWindow = enabled;
    win.setMinimizable(authWindow);
    win.setSkipTaskbar(!authWindow);
    if (process.platform === "darwin") {
      if (authWindow) void app.dock.show();
      else app.dock.hide();
    }
    // Surrender live bounds before applying the guide's layout. On exit, restore
    // a maximized guide first so its workspace owner never captures full-screen
    // bounds as the normal/auth layout.
    if (enteringAuth) onAuthChange();
    if (area) {
      if (!authWindow && workspaceBounds) {
        win.setBounds(workspaceBounds);
        workspaceBounds = null;
      } else if (restoreBounds) win.setBounds(restoreBounds);
      restoreBounds = null;
      if (authWindow) win.setBounds({
        x: area.x + Math.round((area.width - Math.min(600, area.width)) / 2),
        y: area.y + Math.round((area.height - Math.min(720, area.height)) / 2),
        width: Math.min(600, area.width), height: Math.min(720, area.height),
      });
    }
    if (!enteringAuth) onAuthChange();
  });
  ipcMain.handle("minimize-window", () => {
    const win = getWindow();
    if (!win || win.isDestroyed() || !authWindow) return { success: false };
    win.minimize();
    return { success: true };
  });
  ipcMain.handle("toggle-maximize-window", () => {
    const win = getWindow();
    if (!win || win.isDestroyed() || !authWindow) return { success: false };
    // Transparent windows cannot reliably use native maximize on Windows.
    if (restoreBounds) {
      win.setBounds(restoreBounds);
      restoreBounds = null;
    } else {
      restoreBounds = win.getBounds();
      win.setBounds(screen.getDisplayMatching(restoreBounds).workArea);
    }
    return { success: true, maximized: Boolean(restoreBounds) };
  });
}
