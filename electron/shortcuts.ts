import { app, globalShortcut } from "electron";
import type { IShortcutsHelperDeps } from "./main";
import type { LiveShortcutAction } from "./live/overlayTypes";

export class ShortcutsHelper {
  private readonly bindings = new Map<string, { run: () => unknown; live: boolean; programming: boolean; hidden: boolean }>();
  private readonly active = new Set<string>();
  constructor(private readonly deps: IShortcutsHelperDeps) {}

  private enabled(binding: { live: boolean; programming: boolean; hidden: boolean }): boolean {
    return this.deps.canUseShortcuts() && (this.deps.isLiveWorkspace()
      ? binding.live && (this.deps.isVisible() || binding.hidden)
      : binding.programming);
  }
  refreshGlobalShortcuts(): void {
    for (const [accelerator, binding] of this.bindings) {
      if (this.enabled(binding)) {
        if (this.active.has(accelerator)) continue;
        const registered = globalShortcut.register(accelerator, () => {
          if (!this.enabled(binding)) return;
          try {
            const result = binding.run();
            if (result instanceof Promise || result && typeof (result as Promise<unknown>).then === "function") {
              return Promise.resolve(result).catch(error => this.reportFailure(error));
            }
            return result;
          } catch (error) { this.reportFailure(error); }
        });
        if (registered) this.active.add(accelerator);
        else console.error(`Global shortcut registration failed: ${accelerator}`);
      } else if (this.active.delete(accelerator)) globalShortcut.unregister(accelerator);
    }
  }
  private reportFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : "Shortcut operation failed";
    console.error("Shortcut operation failed:", message);
    const win = this.deps.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send("solution-error", message);
  }

  private sendLive(action: LiveShortcutAction): void {
    const win = this.deps.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send("live-shortcut", action);
  }

  private async resetProgramming(): Promise<void> {
    this.deps.processingHelper?.cancelOngoingRequests();
    const result = await this.deps.clearQueues();
    if (!result.success) throw new Error(result.error || "Screenshot cleanup failed");
    this.deps.setView("queue");
    const win = this.deps.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("reset-view");
      win.webContents.send("reset");
    }
  }

  public registerGlobalShortcuts(): void {
    const register = (accelerator: string, operation: () => unknown, options: { live?: boolean; programming?: boolean; hidden?: boolean } = {}) => {
      this.bindings.set(accelerator, { run: operation, live: options.live ?? true, programming: options.programming ?? true, hidden: options.hidden ?? false });
    };
    const action = (accelerator: string, live: LiveShortcutAction, programming?: () => unknown) => {
      register(accelerator, () => this.deps.isLiveWorkspace() ? this.sendLive(live) : programming?.(), {
        programming: !!programming, hidden: live === "toggle-session",
      });
    };
    register("CommandOrControl+H", async () => {
      const win = this.deps.getMainWindow();
      if (!win || win.isDestroyed()) return;
      try {
        const screenshotPath = await this.deps.takeScreenshot();
        const preview = await this.deps.getImagePreview(screenshotPath);
        if (!win.isDestroyed()) win.webContents.send("screenshot-taken", { path: screenshotPath, preview });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Screenshot capture failed";
        console.error("Screenshot shortcut failed:", message);
        if (!win.isDestroyed()) win.webContents.send("screenshot-error", message);
      }
    });
    action("CommandOrControl+Enter", "ask", () => this.deps.processingHelper?.processScreenshots());
    register("CommandOrControl+B", () => this.deps.toggleMainWindow(), { hidden: true });
    action("CommandOrControl+G", "clear", () => this.resetProgramming());
    action("CommandOrControl+Shift+\\", "toggle-session");
    action("Alt+1", "response");
    action("Alt+2", "transcripts");
    action("CommandOrControl+Left", "move-left", () => this.deps.moveWindowLeft());
    action("CommandOrControl+Right", "move-right", () => this.deps.moveWindowRight());
    action("CommandOrControl+Up", "move-up", () => this.deps.moveWindowUp());
    action("CommandOrControl+Down", "move-down", () => this.deps.moveWindowDown());
    action("CommandOrControl+Shift+Up", "scroll-up");
    action("CommandOrControl+Shift+Down", "scroll-down");
    // Preserve the programming workspace's established reset shortcut.
    register("CommandOrControl+R", () => {
      return this.resetProgramming();
    }, { live: false });
    for (const [accelerator, language] of [["Alt+P", "python"], ["Alt+J", "java"], ["Alt+C", "cpp"]]) {
      register(accelerator, () => {
        if (!this.deps.isLiveWorkspace()) this.deps.getMainWindow()?.webContents.send("change-language", language);
      }, { live: false });
    }
    this.refreshGlobalShortcuts();
    app.on("will-quit", () => { globalShortcut.unregisterAll(); this.active.clear(); });
  }
}
