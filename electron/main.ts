import { PermissionService } from "./PermissionService";
import { initializePermissionIpc } from "./permissionsIpc";
import * as dotenv from "dotenv";
import { app, BrowserWindow, nativeImage, screen, shell, systemPreferences } from "electron";
import fs from "node:fs";
import path from "path";
import { initAutoUpdater } from "./autoUpdater";
import { initializeIpcHandlers } from "./ipcHandlers";
import { ProcessingHelper } from "./ProcessingHelper";
import { ScreenshotHelper } from "./ScreenshotHelper";
import {
  PublicSettings,
  SaveAiSettingsInput,
  SettingsStore,
} from "./settings";
import { AI_PROVIDERS, AiProviderId } from "./aiProviders";
import { ShortcutsHelper } from "./shortcuts";
import { createCaptureCloseGuard } from "./live/WindowCloseGuard";
import { createAuthenticationLossHandler } from "./live/AuthenticationLoss";
import { AccountService } from "./account";
import { initializeWindowControls, isAuthWindow } from "./windowControls";
import { WindowCaptureProtection } from "./WindowCaptureProtection";
import { WindowVisibilityController, WindowVisibilityCleanupError } from "./WindowVisibility";
import { LiveSessionService } from "./live/LiveSessionService";
import { RecallCapture } from "./live/RecallCapture";
import { NativePcmCapture } from "./live/NativePcmCapture";
import { captureBackend, publicTranscriptionSettings } from "./live/CaptureSelection";
import { initializeLiveIpc } from "./live/ipc";
import { OverlayWindowController, initializeOverlayIpc } from "./live/OverlayWindow";
import type { LiveShortcutAction } from "./live/overlayTypes";
import { MAX_SCREENSHOTS } from "./screenshotLimits";
import { getRecallPermissionApiUrl } from "./serviceEndpoints";

// Constants
const isDev = !app.isPackaged;
const PROTOCOL = "passwisely";

// Application State
const state = {
  // Window management properties
  mainWindow: null as BrowserWindow | null,
  windowVisibility: null as WindowVisibilityController | null,
  windowPosition: null as { x: number; y: number } | null,
  windowSize: null as { width: number; height: number } | null,
  screenWidth: 0,
  screenHeight: 0,
  step: 0,
  currentX: 0,
  currentY: 0,

  // Application helpers
  screenshotHelper: null as ScreenshotHelper | null,
  shortcutsHelper: null as ShortcutsHelper | null,
  processingHelper: null as ProcessingHelper | null,
  settingsStore: null as SettingsStore | null,
  accountService: null as AccountService | null,
  liveSession: null as LiveSessionService | null,
  liveWorkspace: true,

  // View and state management
  view: "queue" as "queue" | "solutions" | "debug",
  problemInfo: null as any,
  query: null as any,
  hasDebugged: false,

  // Processing events
  PROCESSING_EVENTS: {
    UNAUTHORIZED: "processing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",
    OUT_OF_CREDITS: "out-of-credits",
    API_KEY_INVALID: "processing-api-key-invalid",
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error",
  } as const,
};

const overlayWindow = new OverlayWindowController(getMainWindow);
function applyWorkspaceWindow(): void {
  overlayWindow.setLive(state.liveWorkspace && !isAuthWindow());
  state.shortcutsHelper?.refreshGlobalShortcuts();
}
function sendLiveShortcut(action: LiveShortcutAction): void {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) window.webContents.send("live-shortcut", action);
}
function notifyScreenshotQueueChanged(): void {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) window.webContents.send("screenshots-changed");
}

// Add interfaces for helper classes
export interface IProcessingHelperDeps {
  getScreenshotHelper: () => ScreenshotHelper | null;
  getMainWindow: () => BrowserWindow | null;
  getView: () => "queue" | "solutions" | "debug";
  setView: (view: "queue" | "solutions" | "debug") => void;
  getProblemInfo: () => any;
  setProblemInfo: (info: any) => void;
  getQuery: () => string;
  setQuery: (query: any) => void;
  getScreenshotQueue: () => string[];
  getExtraScreenshotQueue: () => string[];
  clearQueues: () => Promise<{ success: boolean; error?: string }>;
  takeScreenshot: () => Promise<string>;
  getImagePreview: (filepath: string) => Promise<string>;
  deleteScreenshot: (
    path: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setHasDebugged: (value: boolean) => void;
  getHasDebugged: () => boolean;
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS;
  consumeCredits: (
    action: string,
    requestId: string,
  ) => Promise<{ success: boolean; error?: string; credits?: number }>;
  getWiseAccessToken: () => string;
  onAuthenticationFailure?: () => void;
}

export interface IShortcutsHelperDeps {
  isLiveWorkspace: () => boolean;
  canUseShortcuts: () => boolean;
  getMainWindow: () => BrowserWindow | null;
  takeScreenshot: () => Promise<string>;
  getImagePreview: (filepath: string) => Promise<string>;
  processingHelper: ProcessingHelper | null;
  clearQueues: () => Promise<{ success: boolean; error?: string }>;
  setView: (view: "queue" | "solutions" | "debug") => void;
  isVisible: () => boolean;
  toggleMainWindow: () => void;
  moveWindowLeft: () => void;
  moveWindowRight: () => void;
  moveWindowUp: () => void;
  moveWindowDown: () => void;
}

export interface IIpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null;
  setWindowDimensions: (width: number, height: number) => void;
  getScreenshotQueue: () => string[];
  getExtraScreenshotQueue: () => string[];
  deleteScreenshot: (
    path: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getImagePreview: (filepath: string) => Promise<string>;
  processingHelper: ProcessingHelper | null;
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS;
  takeScreenshot: () => Promise<string>;
  getView: () => "queue" | "solutions" | "debug";
  toggleMainWindow: () => void;
  clearQueues: () => Promise<{ success: boolean; error?: string }>;
  setView: (view: "queue" | "solutions" | "debug") => void;
  moveWindowLeft: () => void;
  moveWindowRight: () => void;
  moveWindowUp: () => void;
  moveWindowDown: () => void;
  getAiSettings: () => PublicSettings;
  saveAiSettings: (input: SaveAiSettingsInput) => PublicSettings;
  clearApiKey: (provider?: AiProviderId) => PublicSettings;
  accountService: AccountService;
  liveSession: LiveSessionService;
}

// Initialize helpers
let handleAuthenticationLost: () => Promise<void> = async () => {};
function initializeHelpers() {
  state.settingsStore = new SettingsStore();
  state.accountService = new AccountService(() => { void handleAuthenticationLost(); });
  state.screenshotHelper = new ScreenshotHelper(state.view, () => overlayWindow.getDisplay());
  state.processingHelper = new ProcessingHelper({
    getScreenshotHelper,
    getMainWindow,
    getView,
    setView,
    getProblemInfo,
    setProblemInfo,
    getQuery,
    setQuery,
    getScreenshotQueue,
    getExtraScreenshotQueue,
    clearQueues,
    takeScreenshot,
    getImagePreview,
    deleteScreenshot,
    setHasDebugged,
    getHasDebugged,
    consumeCredits: async (action: string, requestId: string) => {
      const result = await state.accountService!.consumeCredits(action, requestId);
      return {
        success: result.success,
        error: result.error,
        credits: result.user?.credits,
      };
    },
    getWiseAccessToken: () => state.accountService!.getToken(),
    onAuthenticationFailure: () => { void state.accountService!.getAccount(); },
    PROCESSING_EVENTS: state.PROCESSING_EVENTS,
  } as IProcessingHelperDeps);
  state.processingHelper.configure({
    ...state.settingsStore.getRuntimeConfig(),
    wiseAccessToken: state.accountService.getToken(),
  });
  const captureProvider = captureBackend(process.platform, process.arch);
  const nativeAudio = captureProvider === "native-deepgram";
  const effectiveSpeechSettings = () => publicTranscriptionSettings(state.settingsStore!.getTranscriptionSettings(), captureProvider);
  const audioHelper = app.isPackaged
    ? path.join(process.resourcesPath, "audio", "PassWiselyAudioHelper")
    : path.resolve(__dirname, "../build/native-audio", process.arch, "PassWiselyAudioHelper");
  state.liveSession = new LiveSessionService({
    provider: captureProvider,
    support: nativeAudio ? NativePcmCapture.support() : RecallCapture.support(),
    createCapture: callbacks => nativeAudio ? new NativePcmCapture(callbacks, { helperPath: audioHelper }) : new RecallCapture(callbacks),
    createSession: async (id, signal, profileId) => {
      if (!nativeAudio) return { kind: "recall-upload" as const, ...await state.accountService!.createRecallUpload(id, signal, profileId) };
      signal.throwIfAborted();
      return state.accountService!.createNativeCaptureSession(id, signal, profileId);
    },
    transcriptionProfile: () => effectiveSpeechSettings().profileId,
    stream: (messages, signal, update) => state.processingHelper!.streamConversation(messages, signal, update),
    language: () => state.settingsStore!.getResponseLanguage(),
    pendingScreenshots: () => state.screenshotHelper!.getPendingScreenshots(),
    consumeScreenshots: async (paths, signal) => {
      try { return await state.screenshotHelper!.consumeScreenshots(paths, signal); }
      finally { notifyScreenshotQueueChanged(); }
    },
    images: async (paths, signal) => {
      signal.throwIfAborted();
      if (paths.length > MAX_SCREENSHOTS) throw new Error(`一次最多使用 ${MAX_SCREENSHOTS} 张截图。`);
      let total = 0;
      return paths.map(filepath => {
        signal.throwIfAborted();
        if (fs.statSync(filepath).size > 16 * 1024 * 1024) throw new Error("截图超过 16 MB，请重新截取。");
        let image = nativeImage.createFromPath(filepath);
        if (image.isEmpty()) throw new Error("无法读取截图，请重新截取。");
        const size = image.getSize(), scale = Math.min(1, 1280 / size.width, 1280 / size.height);
        if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) });
        const jpeg = image.toJPEG(70);
        total += jpeg.byteLength;
        if (total > 4 * 1024 * 1024) throw new Error("截图总大小过大，请减少附件。");
        return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      });
    },
    publish: snapshot => {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send("live-snapshot", snapshot);
    },
  });
  handleAuthenticationLost = createAuthenticationLossHandler({
    cancelRequests: () => { state.processingHelper?.cancelOngoingRequests(); },
    notifyUnauthorized: () => {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) window.webContents.send(state.PROCESSING_EVENTS.UNAUTHORIZED);
    },
    reset: () => state.liveSession!.reset(),
    cleanupFailed: message => { console.error("Authentication cleanup failed:", message); showMainWindow(); },
  });
  state.shortcutsHelper = new ShortcutsHelper({
    isLiveWorkspace: () => overlayWindow.isLive(),
    canUseShortcuts: () => !isAuthWindow(),
    getMainWindow,
    takeScreenshot,
    getImagePreview,
    processingHelper: state.processingHelper,
    clearQueues,
    setView,
    isVisible: () => state.windowVisibility?.canPresent() ?? false,
    toggleMainWindow,
    moveWindowLeft: () =>
      moveWindowHorizontal((x) =>
        Math.max(-(state.windowSize?.width || 0) / 2, x - state.step),
      ),
    moveWindowRight: () =>
      moveWindowHorizontal((x) =>
        Math.min(
          state.screenWidth - (state.windowSize?.width || 0) / 2,
          x + state.step,
        ),
      ),
    moveWindowUp: () => moveWindowVertical((y) => y - state.step),
    moveWindowDown: () => moveWindowVertical((y) => y + state.step),
  } as IShortcutsHelperDeps);
}

// Auth callback handler

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
    path.resolve(process.argv[1]),
  ]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Force Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) app.quit();

async function handleAuthCallback(url: string, win: BrowserWindow | null) {
  try {
    console.log("Auth callback received:", url);
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get("code");

    if (!code) {
      console.error("Missing code in callback URL");
      return;
    }

    if (win) {
      // Send the code to the renderer for PKCE exchange
      win.webContents.send("auth-callback", { code });
    }
  } catch (error) {
    console.error("Error handling auth callback:", error);
  }
}

// A failed initial protection request never publishes a usable main window.
// Keep native resource ownership here until destruction is confirmed.
let mainWindowAwaitingCleanup: BrowserWindow | null = null;
function cleanupFailedMainWindow(): void {
  const window = mainWindowAwaitingCleanup;
  if (!window) return;
  try {
    if (!window.isDestroyed()) window.destroy();
  } finally {
    if (window.isDestroyed() && mainWindowAwaitingCleanup === window) mainWindowAwaitingCleanup = null;
  }
  if (mainWindowAwaitingCleanup === window) throw new Error("Failed main-window cleanup is incomplete; retry before creating another window.");
}

// Window management functions
async function createWindow(): Promise<void> {
  cleanupFailedMainWindow();
  if (state.mainWindow) {
    revealMainWindow();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  state.screenWidth = workArea.width;
  state.screenHeight = workArea.height;
  state.step = 60;
  state.currentX = workArea.x;
  state.currentY = workArea.y + 50;

  const windowSettings: Electron.BrowserWindowConstructorOptions = {
    height: 600,
    width: 600,
    x: state.currentX,
    y: state.currentY,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: isDev
        ? path.join(__dirname, "../dist-electron/preload.js")
        : path.join(__dirname, "preload.js"),
      scrollBounce: true,
    },
    show: false,
    frame: false,
    transparent: true,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    focusable: true,
    skipTaskbar: true,
    // Change window type for better stacking
    type: process.platform === "darwin" ? "panel" : "toolbar",
    paintWhenInitiallyHidden: true,
    titleBarStyle: "hidden",
    enableLargerThanScreen: true,
    movable: true,
    simpleFullscreen: false,
    kiosk: false,
    // Add these new settings
    minimizable: true,
    maximizable: false,
    opacity: 1,
    // Better visual state handling
    visualEffectState: "active",
    // Add these settings
    closable: true,
  };

  // // Prevent accidental closes
  // beforeunload: (e) => {
  //   e.preventDefault()
  //   return false
  // }

  const ownedWindow = new BrowserWindow(windowSettings);
  try {
    // Request capture exclusion before publishing, loading or showing this window.
    new WindowCaptureProtection(ownedWindow);
  } catch (error) {
    mainWindowAwaitingCleanup = ownedWindow;
    ownedWindow.once("closed", () => {
      if (mainWindowAwaitingCleanup === ownedWindow) mainWindowAwaitingCleanup = null;
    });
    try {
      cleanupFailedMainWindow();
    } catch (cleanupError) {
      throw Object.assign(new Error("Capture protection failed; the hidden native window is retained until cleanup succeeds."), { cause: error, cleanupError });
    }
    throw error;
  }
  state.mainWindow = ownedWindow;
  state.windowVisibility = createWindowVisibility(ownedWindow);
  ownedWindow.on("close", createCaptureCloseGuard({
    needsCleanup: () => {
      const session = state.liveSession?.getSnapshot();
      return !!session?.captureNeedsCleanup || session?.captureStatus === "starting";
    },
    reset: () => state.liveSession!.reset(),
    isDestroyed: () => ownedWindow.isDestroyed(),
    close: () => ownedWindow.close(),
    failed: message => { console.error("Audio cleanup failed:", message); showMainWindow(); },
  }));

  // Add this to prevent accidental closing
  // state.mainWindow.on('close', (event) => {
  //   if (state.processingHelper?.isProcessing()) {
  //     event.preventDefault()
  //     return false
  //   }
  // })

  // Configure taskbar/Dock presentation where supported.
  if (process.platform === "win32") {
    // For Windows, we can only use setSkipTaskbar
    state.mainWindow.setSkipTaskbar(true);
  }

  if (process.platform === "darwin") {
    // For macOS, using window type 'panel' already helps, but you may also set:
    state.mainWindow.setSkipTaskbar(true);
  }

  // Ensure window appears above fullscreen applications
  state.mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });

  // Platform specific optimizations
  if (process.platform === "darwin") {
    // macOS specific settings
    state.mainWindow.setWindowButtonVisibility(false);
    app.dock.hide(); // Hide from dock

    // Set window level to always float - using setAlwaysOnTop instead of setWindowLevel
    state.mainWindow.setAlwaysOnTop(true, "floating");
  } else if (process.platform === "win32") {
    // Windows specific settings
    state.mainWindow.setSkipTaskbar(true);
    state.mainWindow.moveTop();
  }

  state.mainWindow.on("closed", () => {
    void state.liveSession?.reset().catch(error => console.error("Session cleanup failed:", error.message));
  });
  state.mainWindow.webContents.on("render-process-gone", () => {
    overlayWindow.setInteractive(false);
    void state.liveSession?.reset().catch(error => console.error("Session cleanup failed:", error.message));
  });
  state.mainWindow.webContents.on("did-start-loading", () => overlayWindow.setInteractive(false));

  // Add more detailed logging for window events
  state.mainWindow.webContents.on("did-finish-load", () => {
    console.log("Window finished loading");
  });
  state.mainWindow.webContents.on(
    "did-fail-load",
    async (event, errorCode, errorDescription) => {
      console.error("Window failed to load:", errorCode, errorDescription);
      if (isDev) {
        // In development, retry loading after a short delay
        console.log("Retrying to load development server...");
        setTimeout(() => {
          state.mainWindow?.loadURL("http://localhost:54321").catch((error) => {
            console.error("Failed to load dev server on retry:", error);
          });
        }, 1000);
      }
    },
  );

  if (isDev) {
    // In development, load from the dev server
    state.mainWindow.loadURL("http://localhost:54321").catch((error) => {
      console.error("Failed to load dev server:", error);
    });
  } else {
    // In production, load from the built files
    console.log(
      "Loading production build:",
      path.join(__dirname, "../dist/index.html"),
    );
    state.mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Configure window behavior
  state.mainWindow.webContents.setZoomFactor(1);
  if (isDev) {
    //state.mainWindow.webContents.openDevTools()
  }
  state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        void shell.openExternal(parsed.toString());
      }
    } catch (error) {
      console.error("Blocked invalid window URL:", error);
    }
    return { action: "deny" };
  });
  state.mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedUrl = isDev
      ? url.startsWith("http://localhost:54321")
      : url.startsWith("file://");
    if (!allowedUrl) event.preventDefault();
  });

  state.mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  state.mainWindow.setAlwaysOnTop(true, "floating", 1);

  // macOS presentation and window-switching behavior
  if (process.platform === "darwin") {
    // Hide the panel from Mission Control; this does not exclude captures.
    state.mainWindow.setHiddenInMissionControl(true);
    state.mainWindow.setWindowButtonVisibility(false);
    state.mainWindow.setBackgroundColor("#00000000");

    // Configure Dock/taskbar presentation; this is separate from capture exclusion.
    state.mainWindow.setSkipTaskbar(true);

    // Disable window shadow
    state.mainWindow.setHasShadow(false);
  }

  // Keep the live renderer updating while its panel is inactive.
  state.mainWindow.webContents.setBackgroundThrottling(false);
  state.mainWindow.webContents.setFrameRate(60);

  // Set up window listeners
  state.mainWindow.on("move", handleWindowMove);
  state.mainWindow.on("resize", handleWindowResize);
  state.mainWindow.on("closed", handleWindowClosed);

  // Initialize window state
  const bounds = state.mainWindow.getBounds();
  state.windowPosition = { x: bounds.x, y: bounds.y };
  state.windowSize = { width: bounds.width, height: bounds.height };
  state.currentX = bounds.x;
  state.currentY = bounds.y;
  applyWorkspaceWindow();
  showMainWindow();
}

function handleWindowMove(): void {
  if (!state.mainWindow) return;
  const bounds = state.mainWindow.getBounds();
  state.windowPosition = { x: bounds.x, y: bounds.y };
  state.currentX = bounds.x;
  state.currentY = bounds.y;
  overlayWindow.publishGeometry();
}

function handleWindowResize(): void {
  if (!state.mainWindow) return;
  const bounds = state.mainWindow.getBounds();
  state.windowSize = { width: bounds.width, height: bounds.height };
  overlayWindow.publishGeometry();
}

function handleWindowClosed(): void {
  overlayWindow.reset();
  state.windowVisibility?.dispose();
  state.windowVisibility = null;
  state.mainWindow = null;
  state.windowPosition = null;
  state.windowSize = null;
}

// One owner separates durable Show / Hide intent from temporary capture holds.
function createWindowVisibility(window: BrowserWindow): WindowVisibilityController {
  return new WindowVisibilityController(window, {
    show: () => applyNativeShowMainWindow(window),
    hide: () => applyNativeHideMainWindow(window),
    changed: () => state.shortcutsHelper?.refreshGlobalShortcuts(),
  });
}

function hideMainWindow(): void { state.windowVisibility?.setRequestedVisible(false); }
function showMainWindow(): void { state.windowVisibility?.setRequestedVisible(true); }

function applyNativeHideMainWindow(mainWindow: BrowserWindow): void {
  if (state.mainWindow !== mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  state.windowPosition = { x: bounds.x, y: bounds.y };
  state.windowSize = { width: bounds.width, height: bounds.height };
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  if (overlayWindow.isLive()) overlayWindow.setInteractive(false);
  mainWindow.hide();
  mainWindow.webContents.send("overlay-visibility", false);
}

function applyNativeShowMainWindow(mainWindow: BrowserWindow): void {
  if (state.mainWindow !== mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  // Showing changes visibility only. The active layout owner may have resized
  // the hidden window (for example, when opening the permission guide).
  // Reapplying an earlier hide snapshot would overwrite that current layout.
  overlayWindow.restoreMousePolicy();
  mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  mainWindow.showInactive();
  overlayWindow.publishGeometry(true);
  mainWindow.webContents.send("overlay-visibility", true);
}

function revealMainWindow(): void {
  const window = state.mainWindow;
  if (!window || window.isDestroyed()) {
    if (window) handleWindowClosed();
    void createWindow().catch(error => console.error("Failed to reveal protected window:", error));
    return;
  }
  showMainWindow();
  if (isAuthWindow() && state.windowVisibility?.canPresent()) window.focus();
}

function toggleMainWindow(): void {
  if (state.mainWindow?.isMinimized()) { revealMainWindow(); return; }
  state.windowVisibility?.isRequestedVisible() ? hideMainWindow() : showMainWindow();
}

// Window movement functions
function moveWindowHorizontal(updateFn: (x: number) => number): void {
  if (overlayWindow.isLive()) { sendLiveShortcut(updateFn(0) < 0 ? "move-left" : "move-right"); return; }
  if (!state.mainWindow) return;
  state.currentX = updateFn(state.currentX);
  state.mainWindow.setPosition(
    Math.round(state.currentX),
    Math.round(state.currentY),
  );
}

function moveWindowVertical(updateFn: (y: number) => number): void {
  if (overlayWindow.isLive()) { sendLiveShortcut(updateFn(0) < 0 ? "move-up" : "move-down"); return; }
  if (!state.mainWindow) return;

  const newY = updateFn(state.currentY);
  // Allow window to go 2/3 off screen in either direction
  const maxUpLimit = (-(state.windowSize?.height || 0) * 2) / 3;
  const maxDownLimit =
    state.screenHeight + ((state.windowSize?.height || 0) * 2) / 3;

  // Log the current state and limits
  console.log({
    newY,
    maxUpLimit,
    maxDownLimit,
    screenHeight: state.screenHeight,
    windowHeight: state.windowSize?.height,
    currentY: state.currentY,
  });

  // Only update if within bounds
  if (newY >= maxUpLimit && newY <= maxDownLimit) {
    state.currentY = newY;
    state.mainWindow.setPosition(
      Math.round(state.currentX),
      Math.round(state.currentY),
    );
  }
}

// Window dimension functions
function setWindowDimensions(width: number, height: number): void {
  if (isAuthWindow() || overlayWindow.isLive() || !Number.isFinite(width) || !Number.isFinite(height)) return;
  const mainWindow = state.mainWindow;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const currentBounds = mainWindow.getBounds();
    const workArea = screen.getDisplayMatching(currentBounds).workArea;
    const maxWidth = Math.min(1120, Math.floor(workArea.width * 0.9));
    const nextWidth = Math.max(320, Math.min(Math.ceil(width + 32), maxWidth));
    const nextHeight = Math.max(
      120,
      Math.min(Math.ceil(height), workArea.height),
    );

    mainWindow.setBounds({
      x: Math.min(
        Math.max(currentBounds.x, workArea.x),
        workArea.x + workArea.width - nextWidth,
      ),
      y: Math.min(
        Math.max(currentBounds.y, workArea.y),
        workArea.y + workArea.height - nextHeight,
      ),
      width: nextWidth,
      height: nextHeight,
    });
  }
}

// Environment setup
function loadEnvVariables() {
  if (isDev) {
    dotenv.config({ path: path.join(process.cwd(), ".env") });
  }
}

// Initialize application
async function initializeApp() {
  try {
    loadEnvVariables();
    initializeHelpers();
    initializeWindowControls(getMainWindow, applyWorkspaceWindow, () => overlayWindow.isLive());
    initializeOverlayIpc(overlayWindow, getMainWindow);
    const refreshOverlayDisplay = () => overlayWindow.refreshDisplay();
    screen.on("display-added", refreshOverlayDisplay);
    screen.on("display-removed", refreshOverlayDisplay);
    screen.on("display-metrics-changed", refreshOverlayDisplay);
    initializeIpcHandlers({
      getMainWindow,
      setWindowDimensions,
      getScreenshotQueue,
      getExtraScreenshotQueue,
      deleteScreenshot,
      getImagePreview,
      processingHelper: state.processingHelper,
      PROCESSING_EVENTS: state.PROCESSING_EVENTS,
      takeScreenshot,
      getView: () => overlayWindow.isLive() ? "queue" : getView(),
      toggleMainWindow,
      clearQueues,
      setView,
      moveWindowLeft: () =>
        moveWindowHorizontal((x) =>
          Math.max(-(state.windowSize?.width || 0) / 2, x - state.step),
        ),
      moveWindowRight: () =>
        moveWindowHorizontal((x) =>
          Math.min(
            state.screenWidth - (state.windowSize?.width || 0) / 2,
            x + state.step,
          ),
        ),
      moveWindowUp: () => moveWindowVertical((y) => y - state.step),
      moveWindowDown: () => moveWindowVertical((y) => y + state.step),
      getAiSettings,
      saveAiSettings,
      clearApiKey,
      accountService: state.accountService!,
      liveSession: state.liveSession!,
    });
    initializeLiveIpc(state.liveSession!, getMainWindow, visible => { state.liveWorkspace = visible; applyWorkspaceWindow(); }, () => {
      if (state.accountService!.getToken()) return true;
      void handleAuthenticationLost();
      return false;
    }, {
      get: () => publicTranscriptionSettings(state.settingsStore!.getTranscriptionSettings(), captureBackend(process.platform, process.arch)),
      save: input => {
        const provider = captureBackend(process.platform, process.arch);
        const available = publicTranscriptionSettings(state.settingsStore!.getTranscriptionSettings(), provider).availableProfileIds;
        if (!available.includes(input.profileId)) throw new Error("当前采集方式不支持此转录引擎，请选择列表中的语音设置。");
        return publicTranscriptionSettings(state.settingsStore!.saveTranscriptionSettings(input), provider);
      },
    });
    const permissions = new PermissionService({
      platform: process.platform, architecture: process.arch,
      mediaStatus: type => systemPreferences.getMediaAccessStatus(type),
      askMicrophone: () => systemPreferences.askForMediaAccess("microphone"),
      accessibilityTrusted: () => systemPreferences.isTrustedAccessibilityClient(false),
      probeScreen: () => state.screenshotHelper!.probeScreenPermission(),
      openSettings: url => shell.openExternal(url),
      audioSnapshot: () => state.liveSession!.getAudioPermissionSnapshot(),
      prepareAudio: options => state.liveSession!.preparePermissions(options),
      captureState: () => state.liveSession!.getSnapshot(),
      recallApiUrl: () => getRecallPermissionApiUrl(),
    });
    try { permissions.startupCheck(); }
    catch { /* Cached startup failure remains available through IPC; manual checks may recover. */ }
    initializePermissionIpc(permissions, getMainWindow, async () => {
      const capture = state.liveSession!.getSnapshot();
      if (capture.captureNeedsCleanup || !["idle", "ended", "error"].includes(capture.captureStatus)) return { success: false, error: "请先结束当前音频采集。" };
      app.relaunch(); app.quit(); return { success: true };
    });
    await createWindow();
    state.shortcutsHelper?.registerGlobalShortcuts();

    // Initialize auto-updater regardless of environment
    initAutoUpdater();
    console.log(
      "Auto-updater initialized in",
      isDev ? "development" : "production",
      "mode",
    );
  } catch (error) {
    console.error("Failed to initialize application:", error);
    app.quit();
  }
}

// Handle the auth callback in development
app.on("open-url", (event, url) => {
  console.log("open-url event received:", url);
  event.preventDefault();
  if (url.startsWith(`${PROTOCOL}://`)) {
    handleAuthCallback(url, state.mainWindow);
  }
});

// Handle the auth callback in production (Windows/Linux)
app.on("second-instance", (_event, commandLine) => {
  console.log("second-instance event received:", commandLine);
  const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (url) {
    handleAuthCallback(url, state.mainWindow);
  }

  revealMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    state.mainWindow = null;
  }
});

let finishedShutdown = false;
let shuttingDown = false;
app.on("before-quit", event => {
  if (finishedShutdown || !state.liveSession) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  void state.liveSession.dispose().then(() => {
    finishedShutdown = true;
    app.quit();
  }).catch(error => {
    shuttingDown = false;
    console.error("Audio shutdown failed:", error.message);
    showMainWindow();
  });
});

app.on("activate", () => {
  revealMainWindow();
});

// State getter/setter functions
function getMainWindow(): BrowserWindow | null {
  return state.mainWindow;
}

function getView(): "queue" | "solutions" | "debug" {
  return state.view;
}

function setView(view: "queue" | "solutions" | "debug"): void {
  state.view = view;
  state.screenshotHelper?.setView(view);
}

function getScreenshotHelper(): ScreenshotHelper | null {
  return state.screenshotHelper;
}

function getProblemInfo(): any {
  return state.problemInfo;
}

function setProblemInfo(problemInfo: any): void {
  state.problemInfo = problemInfo;
}

function getQuery(): any {
  return state.query;
}

function setQuery(query: any): void {
  state.query = query;
}

function getScreenshotQueue(): string[] {
  return state.screenshotHelper?.getScreenshotQueue() || [];
}

function getExtraScreenshotQueue(): string[] {
  return state.screenshotHelper?.getExtraScreenshotQueue() || [];
}

async function clearQueues(): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await state.screenshotHelper?.clearQueues();
    if (!result) return { success: false, error: "Screenshot helper not initialized" };
    if (!result.success) return result;
    state.problemInfo = null;
    state.query = null;
    setView("queue");
    return result;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Screenshot cleanup failed" };
  } finally { notifyScreenshotQueueChanged(); }
}

async function takeScreenshot(): Promise<string> {
  const visibility = state.windowVisibility;
  if (!state.mainWindow || !visibility) throw new Error("No main window available");
  // Acquire before queueing: concurrent pending captures all retain suppression.
  const lease = visibility.suppressForCapture();
  let captureFailed = false, captureError: unknown;
  try {
    return await (state.screenshotHelper?.[overlayWindow.isLive() ? "takeLiveScreenshot" : "takeScreenshot"]() || "");
  } catch (error) { captureFailed = true; captureError = error; throw error; }
  finally {
    try { lease.release(); }
    catch (cleanupError) {
      if (captureFailed) throw new WindowVisibilityCleanupError("Screenshot capture and visibility restoration failed.", captureError, cleanupError);
      throw cleanupError;
    } finally { notifyScreenshotQueueChanged(); }
  }
}

async function getImagePreview(filepath: string): Promise<string> {
  return state.screenshotHelper?.getImagePreview(filepath) || "";
}

async function deleteScreenshot(
  path: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    return await (state.screenshotHelper?.deleteScreenshot(path) || { success: false, error: "Screenshot helper not initialized" });
  } finally { notifyScreenshotQueueChanged(); }
}

function setHasDebugged(value: boolean): void {
  state.hasDebugged = value;
}

function getHasDebugged(): boolean {
  return state.hasDebugged;
}

function getAiSettings(): PublicSettings {
  if (!state.settingsStore) {
    const providers = AI_PROVIDERS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      hasApiKey: false,
      model: definition.defaultModel,
      baseUrl: definition.defaultBaseUrl,
      supportsVision: definition.defaultSupportsVision,
      supportsJsonMode: definition.supportsJsonMode,
      apiKeyPlaceholder: definition.apiKeyPlaceholder,
      models: definition.defaultKeyViaWise
        ? definition.models.filter(
            (model) => model.id === definition.defaultModel,
          )
        : definition.models,
      route: definition.defaultKeyViaWise ? "wise" : definition.route,
      usesWiseDefaultKey: definition.defaultKeyViaWise === true,
    }));
    const kimi =
      providers.find((provider) => provider.id === "kimi") || providers[0];
    return {
      provider: "kimi",
      responseLanguage: "zh-CN",
      hasApiKey: false,
      model: kimi.model,
      baseUrl: kimi.baseUrl,
      supportsVision: kimi.supportsVision,
      supportsJsonMode: kimi.supportsJsonMode,
      storageSecure: false,
      providers,
    };
  }
  return state.settingsStore.getPublicSettings();
}

function saveAiSettings(input: SaveAiSettingsInput): PublicSettings {
  if (!state.settingsStore) throw new Error("Settings are not initialized");
  const settings = state.settingsStore.save(input);
  state.processingHelper?.configure({
    ...state.settingsStore.getRuntimeConfig(),
    wiseAccessToken: state.accountService?.getToken(),
  });
  return settings;
}

function clearApiKey(provider?: AiProviderId): PublicSettings {
  if (!state.settingsStore) throw new Error("Settings are not initialized");
  const settings = state.settingsStore.clearApiKey(provider);
  state.processingHelper?.configure({
    ...state.settingsStore.getRuntimeConfig(),
    wiseAccessToken: state.accountService?.getToken(),
  });
  return settings;
}

// Export state and functions for other modules
export {
  clearQueues,
  createWindow,
  deleteScreenshot,
  getExtraScreenshotQueue,
  getHasDebugged,
  getImagePreview,
  getMainWindow,
  getProblemInfo,
  getQuery,
  getScreenshotHelper,
  getScreenshotQueue,
  getView,
  handleAuthCallback,
  hideMainWindow,
  moveWindowHorizontal,
  moveWindowVertical,
  setHasDebugged,
  setProblemInfo,
  setQuery,
  setView,
  setWindowDimensions,
  showMainWindow,
  state,
  takeScreenshot,
  toggleMainWindow,
};

app.whenReady().then(initializeApp);
