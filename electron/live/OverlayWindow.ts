import { BrowserWindow, ipcMain, screen } from "electron";
import type { OverlayDisplay, OverlayGeometry } from "./overlayTypes";

/** Native geometry owns the display; the live renderer owns its visible panels. */
export class OverlayWindowController {
  private live = false;
  private interactive = false;
  private displayId?: number;
  private normalBounds?: Electron.Rectangle;
  private lastGeometryKey?: string;

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  isLive(): boolean { return this.live; }
  getDisplay(): Electron.Display {
    return screen.getAllDisplays().find(display => display.id === this.displayId) || screen.getPrimaryDisplay();
  }

  getDisplays(): OverlayDisplay[] {
    const win = this.getWindow();
    const selectedId = this.live && win && !win.isDestroyed() ? this.getDisplay().id : undefined;
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.label || `Display ${index + 1}`,
      isPrimary: display.id === primaryId,
      selected: display.id === selectedId,
    }));
  }

  selectDisplay(displayId: number): OverlayGeometry | null {
    if (typeof displayId !== "number" || !Number.isSafeInteger(displayId)) throw new Error("Invalid overlay display ID.");
    const display = screen.getAllDisplays().find(candidate => candidate.id === displayId);
    if (!display) throw new Error("Unknown overlay display.");
    const win = this.getWindow();
    if (!this.live || !win || win.isDestroyed()) return null;
    this.displayId = display.id;
    win.setBounds(display.workArea);
    win.webContents.send("overlay-recenter");
    this.restoreMousePolicy();
    this.publishGeometry(true);
    return this.getGeometry();
  }

  getGeometry(): OverlayGeometry | null {
    const win = this.getWindow();
    if (!this.live || !win || win.isDestroyed()) return null;
    const display = this.getDisplay(), area = display.workArea, actual = win.getBounds();
    // setBounds can complete after its command returns. Auth-size bounds never
    // establish live geometry; the native resize/move events retry publication.
    if (actual.x !== area.x || actual.y !== area.y || actual.width !== area.width || actual.height !== area.height) return null;
    return { displayId: display.id, width: actual.width, height: actual.height };
  }

  publishGeometry(force = false): void {
    const geometry = this.getGeometry();
    if (!geometry) return;
    const key = `${geometry.displayId}:${geometry.width}:${geometry.height}`;
    if (!force && key === this.lastGeometryKey) return;
    this.lastGeometryKey = key;
    this.getWindow()!.webContents.send("overlay-geometry", geometry);
  }

  setLive(enabled: boolean): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) { this.live = false; return; }
    if (enabled === this.live) { this.publishGeometry(); return; }
    this.lastGeometryKey = undefined;
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
    this.publishGeometry();
  }

  refreshDisplay(): void {
    if (!this.live) return;
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    const display = this.getDisplay();
    this.displayId = display.id;
    win.setBounds(display.workArea);
    win.webContents.send("overlay-recenter");
    this.publishGeometry(true);
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
    this.displayId = undefined;
    this.normalBounds = undefined;
    this.lastGeometryKey = undefined;
  }
}

export function initializeOverlayIpc(controller: OverlayWindowController, getWindow: () => BrowserWindow | null): void {
  const requireOwner = (event: Electron.IpcMainInvokeEvent) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error("Untrusted overlay caller.");
  };
  ipcMain.handle("overlay-get-geometry", event => {
    requireOwner(event);
    return controller.getGeometry();
  });
  ipcMain.handle("overlay-get-displays", event => {
    requireOwner(event);
    return controller.getDisplays();
  });
  ipcMain.handle("overlay-select-display", (event, displayId: unknown) => {
    requireOwner(event);
    if (typeof displayId !== "number" || !Number.isSafeInteger(displayId)) throw new Error("Invalid overlay display ID.");
    return controller.selectDisplay(displayId);
  });
  const booleanCommand = (channel: string, operation: (value: boolean) => void) => {
    ipcMain.handle(channel, (event, value: unknown) => {
      requireOwner(event);
      if (typeof value !== "boolean") throw new Error("Invalid overlay input.");
      operation(value);
    });
  };
  booleanCommand("overlay-set-interactive", value => controller.setInteractive(value));
  booleanCommand("overlay-set-focus", value => controller.setFocus(value));
}
