import * as dotenv from "dotenv";
import { app, BrowserWindow, screen, shell } from "electron";
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
import { AccountService } from "./account";
import { initializeWindowControls, isAuthWindow } from "./windowControls";

// Constants
const isDev = !app.isPackaged;
const PROTOCOL = "passwisely";

// Application State
const state = {
  // Window management properties
  mainWindow: null as BrowserWindow | null,
  isWindowVisible: false,
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
  clearQueues: () => void;
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
}

export interface IShortcutsHelperDeps {
  getMainWindow: () => BrowserWindow | null;
  takeScreenshot: () => Promise<string>;
  getImagePreview: (filepath: string) => Promise<string>;
  processingHelper: ProcessingHelper | null;
  clearQueues: () => void;
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
  clearQueues: () => void;
  setView: (view: "queue" | "solutions" | "debug") => void;
  moveWindowLeft: () => void;
  moveWindowRight: () => void;
  moveWindowUp: () => void;
  moveWindowDown: () => void;
  getAiSettings: () => PublicSettings;
  saveAiSettings: (input: SaveAiSettingsInput) => PublicSettings;
  clearApiKey: (provider?: AiProviderId) => PublicSettings;
  accountService: AccountService;
}

// Initialize helpers
function initializeHelpers() {
  state.settingsStore = new SettingsStore();
  state.accountService = new AccountService();
  state.screenshotHelper = new ScreenshotHelper(state.view);
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
    PROCESSING_EVENTS: state.PROCESSING_EVENTS,
  } as IProcessingHelperDeps);
  state.processingHelper.configure({
    ...state.settingsStore.getRuntimeConfig(),
    wiseAccessToken: state.accountService.getToken(),
  });
  state.shortcutsHelper = new ShortcutsHelper({
    getMainWindow,
    takeScreenshot,
    getImagePreview,
    processingHelper: state.processingHelper,
    clearQueues,
    setView,
    isVisible: () => state.isWindowVisible,
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

// Window management functions
async function createWindow(): Promise<void> {
  if (state.mainWindow) {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore();
    state.mainWindow.focus();
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
    show: true,
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

  state.mainWindow = new BrowserWindow(windowSettings);

  // Add this to prevent accidental closing
  // state.mainWindow.on('close', (event) => {
  //   if (state.processingHelper?.isProcessing()) {
  //     event.preventDefault()
  //     return false
  //   }
  // })

  // Ensure window does not appear in Alt+Tab (Windows) and similar task switchers
  if (process.platform === "win32") {
    // For Windows, we can only use setSkipTaskbar
    state.mainWindow.setSkipTaskbar(true);
  }

  if (process.platform === "darwin") {
    // For macOS, using window type 'panel' already helps, but you may also set:
    state.mainWindow.setSkipTaskbar(true);
  }

  // Set higher level always-on-top priority
  state.mainWindow.setAlwaysOnTop(true, "screen-saver");

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

  // Additional window settings after creation
  state.mainWindow.moveTop();
  state.mainWindow.focus();

  // Add a periodic check to ensure window stays on top
  const ensureTopMost = () => {
    if (state.mainWindow && !state.mainWindow.isDestroyed() && !state.mainWindow.isMinimized() && state.mainWindow.isVisible()) {
      state.mainWindow.moveTop();
      state.mainWindow.setAlwaysOnTop(true, "screen-saver");
    }
  };

  // Check every 1 second to ensure window stays on top
  const topMostInterval = setInterval(ensureTopMost, 1000);

  // Clear interval when window is closed
  state.mainWindow.on("closed", () => {
    clearInterval(topMostInterval);
  });

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

  // Enhanced screen capture resistance
  state.mainWindow.setContentProtection(true);

  state.mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  state.mainWindow.setAlwaysOnTop(true, "floating", 1);

  // Additional screen capture resistance settings
  if (process.platform === "darwin") {
    // Prevent window from being captured in screenshots
    state.mainWindow.setHiddenInMissionControl(true);
    state.mainWindow.setWindowButtonVisibility(false);
    state.mainWindow.setBackgroundColor("#00000000");

    // Prevent window from being included in window switcher
    state.mainWindow.setSkipTaskbar(true);

    // Disable window shadow
    state.mainWindow.setHasShadow(false);
  }

  // Prevent the window from being captured by screen recording
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
  state.isWindowVisible = true;
}

function handleWindowMove(): void {
  if (!state.mainWindow) return;
  const bounds = state.mainWindow.getBounds();
  state.windowPosition = { x: bounds.x, y: bounds.y };
  state.currentX = bounds.x;
  state.currentY = bounds.y;
}

function handleWindowResize(): void {
  if (!state.mainWindow) return;
  const bounds = state.mainWindow.getBounds();
  state.windowSize = { width: bounds.width, height: bounds.height };
}

function handleWindowClosed(): void {
  state.mainWindow = null;
  state.isWindowVisible = false;
  state.windowPosition = null;
  state.windowSize = null;
}

// Window visibility functions
function hideMainWindow(): void {
  const mainWindow = state.mainWindow;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  state.windowPosition = { x: bounds.x, y: bounds.y };
  state.windowSize = { width: bounds.width, height: bounds.height };
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.setAlwaysOnTop(true, "floating", 1);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setOpacity(0);
  mainWindow.hide();
  state.isWindowVisible = false;
}

function showMainWindow(): void {
  const mainWindow = state.mainWindow;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (state.windowPosition && state.windowSize) {
    mainWindow.setBounds({ ...state.windowPosition, ...state.windowSize });
  }
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
  mainWindow.moveTop();
  mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  mainWindow.setContentProtection(true);
  mainWindow.setOpacity(0);
  mainWindow.showInactive();
  mainWindow.setOpacity(1);
  state.isWindowVisible = true;
}

function toggleMainWindow(): void {
  if (state.mainWindow?.isMinimized()) {
    state.mainWindow.restore();
    state.mainWindow.focus();
    return;
  }
  state.isWindowVisible ? hideMainWindow() : showMainWindow();
}

// Window movement functions
function moveWindowHorizontal(updateFn: (x: number) => number): void {
  if (!state.mainWindow) return;
  state.currentX = updateFn(state.currentX);
  state.mainWindow.setPosition(
    Math.round(state.currentX),
    Math.round(state.currentY),
  );
}

function moveWindowVertical(updateFn: (y: number) => number): void {
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
  if (isAuthWindow()) return;
  const mainWindow = state.mainWindow;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const currentBounds = mainWindow.getBounds();
    const workArea = screen.getDisplayMatching(currentBounds).workArea;
    const maxWidth = Math.floor(workArea.width * 0.5);
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
    initializeWindowControls(getMainWindow);
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
      getView,
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

  // Focus or create the main window
  if (!state.mainWindow) {
    createWindow();
  } else {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore();
    state.mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    state.mainWindow = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (state.mainWindow?.isMinimized()) {
    state.mainWindow.restore();
    state.mainWindow.focus();
  }
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

function clearQueues(): void {
  state.screenshotHelper?.clearQueues();
  state.problemInfo = null;
  state.query = null;
  setView("queue");
}

async function takeScreenshot(): Promise<string> {
  if (!state.mainWindow) throw new Error("No main window available");
  return (
    state.screenshotHelper?.takeScreenshot(
      () => hideMainWindow(),
      () => showMainWindow(),
    ) || ""
  );
}

async function getImagePreview(filepath: string): Promise<string> {
  return state.screenshotHelper?.getImagePreview(filepath) || "";
}

async function deleteScreenshot(
  path: string,
): Promise<{ success: boolean; error?: string }> {
  return (
    state.screenshotHelper?.deleteScreenshot(path) || {
      success: false,
      error: "Screenshot helper not initialized",
    }
  );
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
