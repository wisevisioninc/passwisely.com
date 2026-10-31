import { app, desktopCapturer, screen, shell, systemPreferences, type Display } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_SCREENSHOTS } from "./screenshotLimits";
import { ScreenshotFailure, screenshotFailureMessage, type ScreenAccessStatus, type ScreenshotStage } from "./screenshotFailure";

export interface ScreenshotMutationResult {
  success: boolean;
  error?: string;
  removed: string[];
  failed: Array<{ path: string; error: string }>;
}
type View = "queue" | "solutions" | "debug";

/** Owns both queues and serializes captures/retirements by exact file identity. */
export class ScreenshotHelper {
  private screenshotQueue: string[] = [];
  private extraScreenshotQueue: string[] = [];
  private readonly screenshotDir: string;
  private readonly extraScreenshotDir: string;
  private mutation: Promise<void> = Promise.resolve();

  constructor(private view: View = "queue", private readonly getDisplay: () => Display = () => screen.getPrimaryDisplay()) {
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots");
    this.extraScreenshotDir = path.join(app.getPath("userData"), "extra_screenshots");
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    fs.mkdirSync(this.extraScreenshotDir, { recursive: true });
    this.screenshotQueue = this.loadExistingScreenshots(this.screenshotDir);
    this.extraScreenshotQueue = this.loadExistingScreenshots(this.extraScreenshotDir);
  }
  private loadExistingScreenshots(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".png"))
      .map(entry => path.join(directory, entry.name))
      .sort((left, right) => fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs)
      .slice(-MAX_SCREENSHOTS);
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }
  getView(): View { return this.view; }
  setView(view: View): void { this.view = view; }
  getScreenshotQueue(): string[] { return [...this.screenshotQueue]; }
  getExtraScreenshotQueue(): string[] { return [...this.extraScreenshotQueue]; }
  /** Live always uses the normal pending queue, irrespective of the code view. */
  getPendingScreenshots(): string[] { return this.getScreenshotQueue(); }
  private owned(filePath: string): boolean {
    return this.screenshotQueue.includes(filePath) || this.extraScreenshotQueue.includes(filePath);
  }
  private async verifyOwnedFile(filePath: string): Promise<void> {
    if (!this.owned(filePath) || path.extname(filePath).toLowerCase() !== ".png" ||
      ![this.screenshotDir, this.extraScreenshotDir].includes(path.dirname(filePath))) {
      throw new Error("Screenshot is not owned by the pending queue.");
    }
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Screenshot is no longer a regular owned file.");
  }
  private async retire(paths: readonly string[], signal?: AbortSignal, ownedAtEnqueue = new Set<string>()): Promise<ScreenshotMutationResult> {
    const result: ScreenshotMutationResult = { success: true, removed: [], failed: [] };
    for (const filePath of paths) {
      if (signal?.aborted) {
        result.failed.push({ path: filePath, error: "Screenshot cleanup was cancelled; the pending file was retained." });
        continue;
      }
      // Another serialized operation may have released a file owned when this
      // operation queued. Preserve that bounded proof without a global tombstone cache.
      if (!this.owned(filePath) && ownedAtEnqueue.has(filePath)) { result.removed.push(filePath); continue; }
      try {
        await this.verifyOwnedFile(filePath);
        signal?.throwIfAborted();
        await shell.trashItem(filePath);
        this.screenshotQueue = this.screenshotQueue.filter(item => item !== filePath);
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(item => item !== filePath);
        result.removed.push(filePath);
      } catch (error) {
        result.failed.push({ path: filePath, error: error instanceof Error ? error.message : "Moving screenshot to Trash failed." });
      }
    }
    result.success = result.failed.length === 0;
    if (!result.success) result.error = result.failed.map(item => item.error).join("; ");
    return result;
  }
  consumeScreenshots(paths: readonly string[], signal?: AbortSignal): Promise<ScreenshotMutationResult> {
    const snapshot = [...new Set(paths)];
    const ownedAtEnqueue = new Set(snapshot.filter(filePath => this.owned(filePath)));
    return this.serialize(() => this.retire(snapshot, signal, ownedAtEnqueue));
  }
  clearPendingScreenshots(signal?: AbortSignal): Promise<ScreenshotMutationResult> {
    return this.consumeScreenshots(this.getPendingScreenshots(), signal);
  }
  clearQueues(): Promise<ScreenshotMutationResult> {
    return this.consumeScreenshots([...this.screenshotQueue, ...this.extraScreenshotQueue]);
  }
  clearExtraScreenshotQueue(): Promise<ScreenshotMutationResult> {
    return this.consumeScreenshots(this.extraScreenshotQueue);
  }
  deleteScreenshot(filePath: string): Promise<ScreenshotMutationResult> {
    return this.consumeScreenshots([path.resolve(filePath)]);
  }
  private captureFailure(stage: ScreenshotStage, cause: unknown): ScreenshotFailure {
    if (cause instanceof ScreenshotFailure) return cause;
    let access: ScreenAccessStatus = "unknown";
    if (process.platform === "darwin" || process.platform === "win32") {
      try {
        const observed = systemPreferences.getMediaAccessStatus("screen");
        if (["not-determined", "granted", "denied", "restricted", "unknown"].includes(observed)) access = observed;
      } catch { /* A failed status read is unknown, not proof of denied access. */ }
    }
    return new ScreenshotFailure(stage, cause, access, process.platform);
  }
  private freezeDisplay(): Display {
    try {
      const display = this.getDisplay();
      return { ...display, size: { ...display.size } };
    } catch (error) { throw this.captureFailure("display-selection", error); }
  }
  private async captureThumbnail(display: Display, thumbnailSize: Electron.Size): Promise<Electron.NativeImage> {
    let sources: Electron.DesktopCapturerSource[];
    try {
      sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize,
        fetchWindowIcons: false,
      });
    } catch (error) { throw this.captureFailure("screen-enumeration", error); }
    const source = sources.find(candidate => candidate.display_id === String(display.id));
    if (!source) throw this.captureFailure("display-selection", `The selected display (${display.id}) was not returned by the capture backend. Verify it is connected.`);
    try {
      if (source.thumbnail.isEmpty()) throw new Error("The selected display returned an empty image.");
    } catch (error) { throw this.captureFailure("thumbnail", error); }
    return source.thumbnail;
  }
  private async captureScreenshot(display: Display): Promise<Buffer> {
    const scaleFactor = display.scaleFactor || 1;
    const thumbnail = await this.captureThumbnail(display, {
      width: Math.max(1, Math.round(display.size.width * scaleFactor)),
      height: Math.max(1, Math.round(display.size.height * scaleFactor)),
    });
    try {
      const png = thumbnail.toPNG();
      if (!Buffer.isBuffer(png) || png.length === 0) throw new Error("PNG conversion returned no image data.");
      return png;
    } catch (error) { throw this.captureFailure("image-conversion", error); }
  }
  /** Explicit permission action only: validate one tiny thumbnail without encoding or retaining it. */
  async probeScreenPermission(): Promise<void> {
    const display = this.freezeDisplay();
    await this.serialize(async () => { await this.captureThumbnail(display, { width: 1, height: 1 }); });
  }
  private async takeIntoQueue(queue: "main" | "extra"): Promise<string> {
    const display = this.freezeDisplay();
    return this.serialize(async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));
        const screenshotBuffer = await this.captureScreenshot(display);
        const paths = queue === "main" ? this.screenshotQueue : this.extraScreenshotQueue;
        if (paths.length >= MAX_SCREENSHOTS) {
          const removed = await this.retire(paths.slice(0, paths.length - MAX_SCREENSHOTS + 1));
          if (!removed.success) throw new Error("The screenshot queue is full. " + removed.error);
        }
        const filePath = path.join(queue === "main" ? this.screenshotDir : this.extraScreenshotDir, randomUUID() + ".png");
        const file = await fs.promises.open(filePath, "wx");
        (queue === "main" ? this.screenshotQueue : this.extraScreenshotQueue).push(filePath);
        try { await file.writeFile(screenshotBuffer); }
        catch (error) {
          const detail = screenshotFailureMessage(error);
          try { await file.close(); }
          catch (closeError) {
            // Do not retire the owned path while closing its handle is unresolved.
            throw new Error(detail + " Closing the screenshot also failed: " + screenshotFailureMessage(closeError));
          }
          const cleanup = await this.retire([filePath]);
          throw new Error(detail + (cleanup.success ? "" : " " + cleanup.error));
        }
        await file.close();
        return filePath;
      } catch (error) { throw this.captureFailure("storage", error); }
      finally {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    });
  }
  takeScreenshot(): Promise<string> {
    // Select once before the asynchronous capture, rather than re-reading view later.
    return this.takeIntoQueue(this.view === "queue" ? "main" : "extra");
  }
  takeLiveScreenshot(): Promise<string> {
    return this.takeIntoQueue("main");
  }
  async getImagePreview(filePath: string): Promise<string> {
    try {
      await this.verifyOwnedFile(filePath);
      return "data:image/png;base64," + (await fs.promises.readFile(filePath)).toString("base64");
    } catch (error) { throw this.captureFailure("storage", error); }
  }
}
