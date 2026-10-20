import type { BrowserWindow } from "electron";

type VisibilityWindow = Pick<BrowserWindow, "isDestroyed" | "on" | "removeListener">;
interface VisibilityOperations {
  show(): void;
  hide(): void;
  changed(): void;
}
export interface CaptureVisibilityLease { release(): void }
export class WindowVisibilityCleanupError extends Error {
  constructor(message: string, readonly operationError: unknown, readonly cleanupError: unknown) {
    super(message);
    this.name = "WindowVisibilityCleanupError";
  }
}

/** One window owns its persistent visibility intent and temporary capture holds.
 * Native hide/show are effects of this rule, never a second writable intent.
 */
export class WindowVisibilityController {
  private requestedVisible = false;
  private lastAppliedVisibility: boolean | undefined = false; // New native windows start hidden.
  private readonly captures = new Set<symbol>();
  private readonly releasing = new Set<symbol>();
  private disposed = false;

  constructor(private readonly window: VisibilityWindow, private readonly operations: VisibilityOperations) {
    window.on("closed", this.dispose);
  }

  isRequestedVisible(): boolean { return !this.disposed && this.requestedVisible; }
  canPresent(): boolean { return !this.disposed && !this.window.isDestroyed() && this.requestedVisible && this.captures.size === 0; }

  setRequestedVisible(visible: boolean): void {
    if (this.disposed || this.window.isDestroyed()) return;
    this.requestedVisible = visible;
    this.reconcile(visible);
  }

  suppressForCapture(): CaptureVisibilityLease {
    if (this.disposed || this.window.isDestroyed()) throw new Error("The capture window is unavailable.");
    const token = Symbol("capture-visibility");
    this.captures.add(token);
    try { this.reconcile(); }
    catch (error) {
      // Capture must not start when hiding failed. Keep a failed restoration
      // owned here; a later explicit Show / Hide retries reconciliation.
      this.captures.delete(token); this.releasing.add(token);
      try { this.reconcile(); }
      catch (cleanupError) { throw new WindowVisibilityCleanupError("Window suppression and visibility restoration failed.", error, cleanupError); }
      throw error;
    }
    return { release: () => {
      if (this.disposed || (!this.captures.has(token) && !this.releasing.has(token))) return;
      this.captures.delete(token); this.releasing.add(token);
      // Failed effects leave this exact release owned and retryable. Do not
      // mark native visibility as applied after a partial/throwing operation.
      this.reconcile();
    } };
  }

  private reconcile(forceShow = false): void {
    if (this.disposed || this.window.isDestroyed()) return;
    const visible = this.requestedVisible && this.captures.size === 0;
    try {
      if (this.lastAppliedVisibility !== visible || (visible && forceShow)) {
        try { visible ? this.operations.show() : this.operations.hide(); }
        catch (error) { this.lastAppliedVisibility = undefined; throw error; }
        this.lastAppliedVisibility = visible;
      }
      this.releasing.clear();
    } finally { this.operations.changed(); }
  }

  readonly dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.requestedVisible = false;
    this.captures.clear(); this.releasing.clear();
    this.window.removeListener("closed", this.dispose);
  };
}
