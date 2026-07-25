// ScreenshotHelper.ts

import { app, desktopCapturer, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class ScreenshotHelper {
  private screenshotQueue: string[] = [];
  private extraScreenshotQueue: string[] = [];
  private readonly MAX_SCREENSHOTS = 5;

  private readonly screenshotDir: string;
  private readonly extraScreenshotDir: string;

  private view: "queue" | "solutions" | "debug" = "queue";

  constructor(view: "queue" | "solutions" | "debug" = "queue") {
    this.view = view;

    // Initialize directories
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots");
    this.extraScreenshotDir = path.join(
      app.getPath("userData"),
      "extra_screenshots",
    );

    fs.mkdirSync(this.screenshotDir, { recursive: true });
    fs.mkdirSync(this.extraScreenshotDir, { recursive: true });
    this.screenshotQueue = this.loadExistingScreenshots(this.screenshotDir);
    this.extraScreenshotQueue = this.loadExistingScreenshots(
      this.extraScreenshotDir,
    );
  }

  private loadExistingScreenshots(directory: string): string[] {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
      .map((entry) => path.join(directory, entry.name))
      .sort(
        (left, right) =>
          fs.statSync(left).mtimeMs - fs.statSync(right).mtimeMs,
      )
      .slice(-this.MAX_SCREENSHOTS);
  }

  public getView(): "queue" | "solutions" | "debug" {
    return this.view;
  }

  public setView(view: "queue" | "solutions" | "debug"): void {
    console.log("Setting view in ScreenshotHelper:", view);
    console.log(
      "Current queues - Main:",
      this.screenshotQueue,
      "Extra:",
      this.extraScreenshotQueue,
    );
    this.view = view;
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotQueue;
  }

  public getExtraScreenshotQueue(): string[] {
    console.log("Getting extra screenshot queue:", this.extraScreenshotQueue);
    return this.extraScreenshotQueue;
  }

  public clearQueues(): void {
    // Clear screenshotQueue
    this.screenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(`Error deleting screenshot at ${screenshotPath}:`, err);
      });
    });
    this.screenshotQueue = [];

    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(
            `Error deleting extra screenshot at ${screenshotPath}:`,
            err,
          );
      });
    });
    this.extraScreenshotQueue = [];
  }

  private async captureScreenshot(): Promise<Buffer> {
    const primaryDisplay = screen.getPrimaryDisplay();
    const scaleFactor = primaryDisplay.scaleFactor || 1;
    const thumbnailSize = {
      width: Math.max(1, Math.round(primaryDisplay.size.width * scaleFactor)),
      height: Math.max(1, Math.round(primaryDisplay.size.height * scaleFactor)),
    };
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize,
      fetchWindowIcons: false,
    });
    const displayId = String(primaryDisplay.id);
    const source =
      sources.find((candidate) => candidate.display_id === displayId) ||
      sources[0];

    if (!source || source.thumbnail.isEmpty()) {
      throw new Error(
        process.platform === "darwin"
          ? "Screen capture failed. Enable Screen Recording permission for PassWisely in System Settings."
          : "Screen capture failed. Make sure a display is connected and screen capture is permitted.",
      );
    }
    return source.thumbnail.toPNG();
  }

  public async takeScreenshot(
    hideMainWindow: () => void,
    showMainWindow: () => void,
  ): Promise<string> {
    console.log("Taking screenshot in view:", this.view);
    hideMainWindow();
    await new Promise((resolve) => setTimeout(resolve, 100));

    let screenshotPath = "";
    try {
      const screenshotBuffer = await this.captureScreenshot();

      // Save and manage the screenshot based on current view
      if (this.view === "queue") {
        screenshotPath = path.join(this.screenshotDir, `${randomUUID()}.png`);
        await fs.promises.writeFile(screenshotPath, screenshotBuffer);
        console.log("Adding screenshot to main queue:", screenshotPath);
        this.screenshotQueue.push(screenshotPath);
        if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.screenshotQueue.shift();
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath);
              console.log(
                "Removed old screenshot from main queue:",
                removedPath,
              );
            } catch (error) {
              console.error("Error removing old screenshot:", error);
            }
          }
        }
      } else {
        // In solutions view, only add to extra queue
        screenshotPath = path.join(
          this.extraScreenshotDir,
          `${randomUUID()}.png`,
        );
        await fs.promises.writeFile(screenshotPath, screenshotBuffer);
        console.log("Adding screenshot to extra queue:", screenshotPath);
        this.extraScreenshotQueue.push(screenshotPath);
        if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.extraScreenshotQueue.shift();
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath);
              console.log(
                "Removed old screenshot from extra queue:",
                removedPath,
              );
            } catch (error) {
              console.error("Error removing old screenshot:", error);
            }
          }
        }
      }
    } catch (error) {
      console.error("Screenshot error:", error);
      throw error;
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 50));
      showMainWindow();
    }

    return screenshotPath;
  }

  public async getImagePreview(filepath: string): Promise<string> {
    try {
      const data = await fs.promises.readFile(filepath);
      return `data:image/png;base64,${data.toString("base64")}`;
    } catch (error) {
      console.error("Error reading image:", error);
      throw error;
    }
  }

  public async deleteScreenshot(
    filePath: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const resolvedPath = path.resolve(filePath);
      const allowedDirectories = [
        path.resolve(this.screenshotDir),
        path.resolve(this.extraScreenshotDir),
      ];
      if (
        !allowedDirectories.some(
          (directory) =>
            resolvedPath.startsWith(`${directory}${path.sep}`) &&
            path.extname(resolvedPath).toLowerCase() === ".png",
        )
      ) {
        return { success: false, error: "Invalid screenshot path" };
      }

      await fs.promises.unlink(resolvedPath);
      this.screenshotQueue = this.screenshotQueue.filter(
        (queuedPath) => queuedPath !== resolvedPath,
      );
      this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
        (queuedPath) => queuedPath !== resolvedPath,
      );
      return { success: true };
    } catch (error) {
      console.error("Error deleting file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  public clearExtraScreenshotQueue(): void {
    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err)
          console.error(
            `Error deleting extra screenshot at ${screenshotPath}:`,
            err,
          );
      });
    });
    this.extraScreenshotQueue = [];
  }
}
