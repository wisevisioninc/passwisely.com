import type { BrowserWindow } from "electron";

type ProtectedWindow = Pick<BrowserWindow, "isDestroyed" | "setContentProtection" | "on" | "removeListener">;

/** Owns Electron's capture-exclusion request for one native window.
 * This is an OS/API request, not proof that every capture mechanism excludes it.
 * Installation must happen while the new window is hidden, before loading UI.
 */
export class WindowCaptureProtection {
  private disposed = false;

  constructor(private readonly window: ProtectedWindow) {
    // Let an initial failure propagate; the caller must not load/show the UI.
    this.reassert();
    window.on("show", this.reassert);
    window.on("restore", this.reassert);
    window.on("focus", this.reassert);
    window.on("closed", this.dispose);
  }

  private readonly reassert = (): void => {
    if (!this.disposed && !this.window.isDestroyed()) this.window.setContentProtection(true);
  };

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.window.removeListener("show", this.reassert);
    this.window.removeListener("restore", this.reassert);
    this.window.removeListener("focus", this.reassert);
    this.window.removeListener("closed", this.dispose);
  };
}
