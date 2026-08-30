// ipcHandlers.ts

import { app, dialog, ipcMain, shell } from "electron";
import { randomBytes } from "crypto";
import fs from "node:fs";
import { AiProviderId } from "./aiProviders";
import { IIpcHandlerDeps } from "./main";
import { ResumeHelper } from "./ResumeHelper";
import { ResumeRequest } from "./resumeTypes";
import { SaveAiSettingsInput } from "./settings";

export function initializeIpcHandlers(deps: IIpcHandlerDeps): void {
  console.log("Initializing IPC handlers");

  ipcMain.handle("account-get", () => deps.accountService.getAccount());
  ipcMain.handle(
    "account-login",
    (_event, input: { email?: string; password?: string }) =>
      deps.accountService.login(input?.email || "", input?.password || ""),
  );
  ipcMain.handle(
    "account-register",
    (
      _event,
      input: { email?: string; password?: string; locale?: "zh" | "en" },
    ) =>
      deps.accountService.register(
        input?.email || "",
        input?.password || "",
        input?.locale === "en" ? "en" : "zh",
      ),
  );
  ipcMain.handle(
    "account-forgot-password",
    (_event, email: string) => deps.accountService.requestPasswordReset(email || ""),
  );
  ipcMain.handle(
    "account-change-password",
    (_event, input: { currentPassword?: string; newPassword?: string }) =>
      deps.accountService.changePassword(
        input?.currentPassword || "",
        input?.newPassword || "",
      ),
  );
  ipcMain.handle("account-logout", () => {
    deps.accountService.clear();
    return { success: true };
  });
  ipcMain.handle("quit-app", () => {
    app.quit();
    return { success: true };
  });
  ipcMain.handle("account-open-portal", () =>
    shell.openExternal(deps.accountService.getAccountUrl()),
  );

  // New handler for processing input text
  ipcMain.handle("process-input-text", async (_event, inputText: string) => {
    try {
      console.log("Received input text:", inputText);
      // Directly call a function in server.js to handle the input text
      if (!inputText?.trim()) {
        return { success: false, error: "Please enter a question." };
      }
      await deps.processingHelper?.processInputText(inputText.trim());
      return { success: true };
    } catch (error) {
      console.error("Error processing input text:", error);
      return { success: false, error: "Failed to process input text" };
    }
  });

  // Credits handlers
  ipcMain.handle("set-initial-credits", async (_event, credits: number) => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow) return;

    try {
      // Set the credits in a way that ensures atomicity
      await mainWindow.webContents.executeJavaScript(
        `window.__CREDITS__ = ${credits}`,
      );
      mainWindow.webContents.send("credits-updated", credits);
    } catch (error) {
      console.error("Error setting initial credits:", error);
      throw error;
    }
  });

  ipcMain.handle("decrement-credits", async () => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow) return;

    try {
      const currentCredits =
        await mainWindow.webContents.executeJavaScript("window.__CREDITS__");
      if (currentCredits > 0) {
        const newCredits = currentCredits - 1;
        await mainWindow.webContents.executeJavaScript(
          `window.__CREDITS__ = ${newCredits}`,
        );
        mainWindow.webContents.send("credits-updated", newCredits);
      }
    } catch (error) {
      console.error("Error decrementing credits:", error);
    }
  });

  // Screenshot queue handlers
  ipcMain.handle("get-screenshot-queue", () => {
    return deps.getScreenshotQueue();
  });

  ipcMain.handle("get-extra-screenshot-queue", () => {
    return deps.getExtraScreenshotQueue();
  });

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return deps.deleteScreenshot(path);
  });

  ipcMain.handle("get-image-preview", async (event, path: string) => {
    return deps.getImagePreview(path);
  });

  // Screenshot processing handlers
  ipcMain.handle("process-screenshots", async () => {
    await deps.processingHelper?.processScreenshots();
  });

  // Window dimension handlers
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        deps.setWindowDimensions(width, height);
      }
    },
  );

  ipcMain.handle(
    "set-window-dimensions",
    (event, width: number, height: number) => {
      deps.setWindowDimensions(width, height);
    },
  );

  // Screenshot management handlers
  ipcMain.handle("get-screenshots", async () => {
    try {
      let previews = [];
      const currentView = deps.getView();

      if (currentView === "queue") {
        const queue = deps.getScreenshotQueue();
        previews = await Promise.all(
          queue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path),
          })),
        );
      } else {
        const extraQueue = deps.getExtraScreenshotQueue();
        previews = await Promise.all(
          extraQueue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path),
          })),
        );
      }

      return previews;
    } catch (error) {
      console.error("Error getting screenshots:", error);
      throw error;
    }
  });

  ipcMain.handle("get-ai-settings", () => deps.getAiSettings());

  ipcMain.handle("select-resume-file", async () => {
    try {
      const mainWindow = deps.getMainWindow();
      const options = {
        title: "选择简历",
        properties: ["openFile"] as Array<"openFile">,
        filters: [
          {
            name: "Resume",
            extensions: ["doc", "docx", "pdf", "html", "htm"],
          },
        ],
      };
      const selection = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      if (selection.canceled || !selection.filePaths[0]) {
        return { success: false, canceled: true };
      }
      const document = await ResumeHelper.parseFile(selection.filePaths[0]);
      return { success: true, document };
    } catch (error) {
      console.error("Failed to parse resume file:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "无法读取简历文件。",
      };
    }
  });

  ipcMain.handle("load-resume-url", async (_event, url: string) => {
    try {
      const document = await ResumeHelper.parseUrl(url || "");
      return { success: true, document };
    } catch (error) {
      console.error("Failed to parse resume URL:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "无法读取网页简历。",
      };
    }
  });

  ipcMain.handle("process-resume", async (_event, request: ResumeRequest) => {
    return deps.accountService.runResumeAgent(request);
  });
  ipcMain.handle("get-resume-history", () =>
    deps.accountService.getLocalResumeHistory(),
  );

  ipcMain.handle(
    "save-resume-result",
    async (_event, input: { content?: string; suggestedName?: string }) => {
      try {
        const content = input?.content?.trim();
        if (!content) return { success: false, error: "没有可保存的内容。" };
        const safeName =
          input?.suggestedName?.replace(/[\\/:*?"<>|]/g, "-").trim() ||
          "optimized-resume";
        const mainWindow = deps.getMainWindow();
        const options = {
          title: "保存简历分析结果",
          defaultPath: `${safeName}.md`,
          filters: [
            { name: "Markdown", extensions: ["md"] },
            { name: "Text", extensions: ["txt"] },
          ],
        };
        const selection = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options);
        if (selection.canceled || !selection.filePath) {
          return { success: false, canceled: true };
        }
        await fs.promises.writeFile(selection.filePath, content, {
          encoding: "utf8",
          mode: 0o600,
        });
        return { success: true, path: selection.filePath };
      } catch (error) {
        console.error("Failed to save resume result:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "保存失败。",
        };
      }
    },
  );

  ipcMain.handle(
    "save-ai-settings",
    (_event, input: SaveAiSettingsInput) => {
      try {
        return { success: true, settings: deps.saveAiSettings(input || {}) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Save failed",
        };
      }
    },
  );

  const clearApiKey = (_event: unknown, provider?: AiProviderId) => {
    try {
      return { success: true, settings: deps.clearApiKey(provider) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Clear failed",
      };
    }
  };
  ipcMain.handle("clear-api-key", clearApiKey);
  ipcMain.handle("clear-store", clearApiKey);

  // Screenshot trigger handlers
  ipcMain.handle("trigger-screenshot", async () => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      try {
        const screenshotPath = await deps.takeScreenshot();
        const preview = await deps.getImagePreview(screenshotPath);
        mainWindow.webContents.send("screenshot-taken", {
          path: screenshotPath,
          preview,
        });
        return { success: true };
      } catch (error) {
        console.error("Error triggering screenshot:", error);
        return { error: "Failed to trigger screenshot" };
      }
    }
    return { error: "No main window available" };
  });

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await deps.takeScreenshot();
      const preview = await deps.getImagePreview(screenshotPath);
      return { path: screenshotPath, preview };
    } catch (error) {
      console.error("Error taking screenshot:", error);
      return { error: "Failed to take screenshot" };
    }
  });

  // Auth related handlers
  ipcMain.handle("get-pkce-verifier", () => {
    return randomBytes(32).toString("base64url");
  });

  ipcMain.handle("open-external-url", (event, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return shell.openExternal(parsed.toString());
      }
    } catch (error) {
      console.error("Invalid external URL:", error);
    }
    throw new Error("Only HTTP and HTTPS URLs can be opened");
  });

  // Subscription handlers
  ipcMain.handle("open-settings-portal", () => {
    return shell.openExternal(deps.accountService.getAccountUrl());
  });
  ipcMain.handle("open-subscription-portal", async (_event, authData) => {
    try {
      const url = deps.accountService.getAccountUrl();
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error("Error opening checkout page:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to open checkout page",
      };
    }
  });

  // Window management handlers
  ipcMain.handle("toggle-window", () => {
    try {
      deps.toggleMainWindow();
      return { success: true };
    } catch (error) {
      console.error("Error toggling window:", error);
      return { error: "Failed to toggle window" };
    }
  });

  ipcMain.handle("reset-queues", async () => {
    try {
      deps.clearQueues();
      return { success: true };
    } catch (error) {
      console.error("Error resetting queues:", error);
      return { error: "Failed to reset queues" };
    }
  });

  // Process screenshot handlers
  ipcMain.handle("trigger-process-screenshots", async () => {
    try {
      await deps.processingHelper?.processScreenshots();
      return { success: true };
    } catch (error) {
      console.error("Error processing screenshots:", error);
      return { error: "Failed to process screenshots" };
    }
  });

  // Reset handlers
  ipcMain.handle("trigger-reset", () => {
    try {
      // First cancel any ongoing requests
      deps.processingHelper?.cancelOngoingRequests();

      // Clear all queues immediately
      deps.clearQueues();

      // Reset view to queue
      deps.setView("queue");

      // Get main window and send reset events
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Send reset events in sequence
        mainWindow.webContents.send("reset-view");
        mainWindow.webContents.send("reset");
      }

      return { success: true };
    } catch (error) {
      console.error("Error triggering reset:", error);
      return { error: "Failed to trigger reset" };
    }
  });

  // Window movement handlers
  ipcMain.handle("trigger-move-left", () => {
    try {
      deps.moveWindowLeft();
      return { success: true };
    } catch (error) {
      console.error("Error moving window left:", error);
      return { error: "Failed to move window left" };
    }
  });

  ipcMain.handle("trigger-move-right", () => {
    try {
      deps.moveWindowRight();
      return { success: true };
    } catch (error) {
      console.error("Error moving window right:", error);
      return { error: "Failed to move window right" };
    }
  });

  ipcMain.handle("trigger-move-up", () => {
    try {
      deps.moveWindowUp();
      return { success: true };
    } catch (error) {
      console.error("Error moving window up:", error);
      return { error: "Failed to move window up" };
    }
  });

  ipcMain.handle("trigger-move-down", () => {
    try {
      deps.moveWindowDown();
      return { success: true };
    } catch (error) {
      console.error("Error moving window down:", error);
      return { error: "Failed to move window down" };
    }
  });
}
