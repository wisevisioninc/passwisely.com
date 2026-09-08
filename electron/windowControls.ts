import { app, BrowserWindow, ipcMain, screen } from "electron";

let authWindow = true;
let restoreBounds: Electron.Rectangle | null = null;
export function isAuthWindow() { return authWindow; }

export function initializeWindowControls(getWindow: () => BrowserWindow | null) {
  ipcMain.handle("set-auth-window", (_event, enabled: boolean) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const changed = authWindow !== Boolean(enabled);
    authWindow = Boolean(enabled);
    win.setMinimizable(authWindow);
    win.setSkipTaskbar(!authWindow);
    if (process.platform === "darwin") {
      if (authWindow) void app.dock.show();
      else app.dock.hide();
    }
    if (changed || (authWindow && !restoreBounds)) {
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      if (restoreBounds) win.setBounds(restoreBounds);
      restoreBounds = null;
      if (authWindow) win.setBounds({
        x: area.x + Math.round((area.width - Math.min(600, area.width)) / 2),
        y: area.y + Math.round((area.height - Math.min(720, area.height)) / 2),
        width: Math.min(600, area.width), height: Math.min(720, area.height),
      });
    }
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
