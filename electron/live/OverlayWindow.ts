import { BrowserWindow, ipcMain, screen } from "electron";

/** Native geometry owns the display; the live renderer owns its visible panels. */
export class OverlayWindowController {
  private live = false;
  private interactive = false;
  private displayId?: number;
  private normalBounds?: Electron.Rectangle;

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  isLive(): boolean { return this.live; }
  getDisplay(): Electron.Display {
    return screen.getAllDisplays().find(display => display.id === this.displayId) || screen.getPrimaryDisplay();
  }

  setLive(enabled: boolean): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) { this.live = false; return; }
    if (enabled === this.live) return;
    if (enabled) {
      this.normalBounds = win.getBounds();
      this.displayId = screen.getDisplayMatching(this.normalBounds).id;
      this.interactive = false;
      this.live = true;
      win.setMovable(false);
      win.setResizable(false);
      win.setBounds(this.getDisplay().workArea);
    } else {
      this.live = false;
      this.interactive = false;
      win.setMovable(true);
      if (this.normalBounds) {
        const area = screen.getDisplayMatching(this.normalBounds).workArea;
        const width = Math.min(this.normalBounds.width, area.width), height = Math.min(this.normalBounds.height, area.height);
        win.setBounds({ width, height, x: Math.max(area.x, Math.min(this.normalBounds.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(this.normalBounds.y, area.y + area.height - height)) });
      }
    }
    this.restoreMousePolicy();
  }

  refreshDisplay(): void {
    if (!this.live) return;
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    const display = this.getDisplay();
    this.displayId = display.id;
    win.setBounds(display.workArea);
    win.webContents.send("overlay-recenter");
  }

  setInteractive(interactive: boolean): void {
    this.interactive = this.live && interactive;
    this.restoreMousePolicy();
  }
  restoreMousePolicy(): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(this.live && !this.interactive, { forward: true });
  }
  setFocus(focused: boolean): void {
    if (!this.live) return;
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    if (focused) win.focus(); else win.blur();
  }
  reset(): void {
    this.live = false;
    this.interactive = false;
    this.normalBounds = undefined;
  }
}

export function initializeOverlayIpc(controller: OverlayWindowController, getWindow: () => BrowserWindow | null): void {
  const booleanCommand = (channel: string, operation: (value: boolean) => void) => {
    ipcMain.handle(channel, (event, value: unknown) => {
      const win = getWindow();
      if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("Untrusted overlay caller.");
      if (typeof value !== "boolean") throw new Error("Invalid overlay input.");
      operation(value);
    });
  };
  booleanCommand("overlay-set-interactive", value => controller.setInteractive(value));
  booleanCommand("overlay-set-focus", value => controller.setFocus(value));
}
