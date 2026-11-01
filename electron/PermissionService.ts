import type { CapturePermissionId, CapturePermissionItem, CapturePermissionResult, CapturePermissionSnapshot, CapturePermissionStartupCheck, CapturePermissionStatus } from "./permissionsTypes";
import type { AudioPermissionResult, AudioPermissionSnapshot } from "./live/captureContracts";
import { screenshotFailureMessage } from "./screenshotFailure";

const MEDIA_STATUSES = ["granted", "not-determined", "denied", "restricted", "unknown"] as const;
const MISSING_STATUSES: ReadonlySet<CapturePermissionStatus> = new Set(["not-determined", "denied", "restricted", "not-granted"]);
const MAC_SETTINGS = { screen: "Privacy_ScreenCapture", microphone: "Privacy_Microphone", "system-audio": "Privacy_ScreenCapture", accessibility: "Privacy_Accessibility" } as const;
export interface PermissionServiceDependencies {
  platform: string;
  architecture: string;
  mediaStatus: (type: "screen" | "microphone") => unknown;
  askMicrophone: () => Promise<boolean>;
  accessibilityTrusted: () => boolean;
  probeScreen: () => Promise<void>;
  openSettings: (url: string) => Promise<unknown>;
  audioSnapshot: () => AudioPermissionSnapshot | null;
  prepareAudio: (options: { recallApiUrl?: string }) => Promise<AudioPermissionResult>;
  captureState: () => { captureNeedsCleanup: boolean; captureStatus: string; platformSupported: boolean; platformMessage?: string };
  recallApiUrl: () => string | undefined;
  now?: () => number;
}
/** Startup uses current OS facts; provider observations never imply a fresh grant. */
export class PermissionService {
  private busy = false;
  private screenRequested = false;
  private screenVerifiedAt?: number;
  private screenWasMissing = false;
  private startupResult?: { success: true; value: CapturePermissionStartupCheck } | { success: false; error: unknown };
  private readonly now: () => number;
  constructor(private readonly deps: PermissionServiceDependencies) {
    this.now = deps.now || Date.now;
  }
  private media(type: "screen" | "microphone"): CapturePermissionStatus {
    try {
      const value = this.deps.mediaStatus(type);
      return MEDIA_STATUSES.includes(value as never) ? value as CapturePermissionStatus : "unknown";
    } catch { return "unknown"; }
  }
  startupCheck(): CapturePermissionStartupCheck {
    if (!this.startupResult) {
      try {
        const snapshot = this.snapshot();
        const shouldPrompt = snapshot.items.some(item =>
          // Only the screen/microphone/AX OS queries below establish current
          // missing permission. A fresh SDK has no system-audio observation.
          item.id !== "system-audio" &&
          (item.id === "screen" || snapshot.audioSupported) &&
          MISSING_STATUSES.has(item.status));
        this.startupResult = { success: true, value: { shouldPrompt, snapshot } };
      } catch (error) {
        // Cache the failure too: startup IPC rejects without repeating OS reads.
        // Manual snapshots remain independent and may recover later.
        this.startupResult = { success: false, error };
      }
    }
    if (this.startupResult.success === false) throw this.startupResult.error;
    return this.startupResult.value;
  }
  snapshot(): CapturePermissionSnapshot {
    const mac = this.deps.platform === "darwin", win = this.deps.platform === "win32";
    const now = this.now(), screen = mac ? this.media("screen") : win ? "not-required" : "unsupported";
    if (mac && MISSING_STATUSES.has(screen)) this.screenWasMissing = true;
    const microphone = mac || win ? this.media("microphone") : "unsupported";
    const capture = this.deps.captureState(), audio = this.deps.audioSnapshot();
    const items: CapturePermissionItem[] = [{
      id: "screen", status: screen, observedAt: mac ? now : this.screenVerifiedAt,
      action: mac || win ? (mac && screen !== "granted" && this.screenRequested ? "settings" : "request") : "none",
      detail: mac ? "用于截图。在系统设置 → 隐私与安全性 → 屏幕录制中允许 PassWisely。"
        : win ? (this.screenVerifiedAt ? "截图检测已通过。" : "Windows 无需单独授权；可测试截图。") : "当前平台不支持截图权限检查。",
    }, {
      id: "microphone", status: microphone, observedAt: mac || win ? now : undefined,
      action: mac ? (["denied", "restricted"].includes(microphone) ? "settings" : microphone === "granted" ? "none" : "request") : win ? "settings" : "none",
      detail: mac ? "用于转录你的声音。可在系统设置 → 隐私与安全性 → 麦克风中允许。"
        : win ? "在 Windows 麦克风设置中开启“麦克风访问”和“允许桌面应用访问”。" : "当前平台不支持麦克风权限检查。",
    }];
    const systemAudio: CapturePermissionItem = {
      id: "system-audio", status: !capture.platformSupported ? "unsupported" : win ? "not-required" : audio?.systemAudio.status || "unknown",
      observedAt: audio?.systemAudio.observedAt,
      action: !capture.platformSupported ? "none" : win ? "settings" : "request",
      detail: !capture.platformSupported ? capture.platformMessage || "当前系统不支持实时音频采集。"
        : win ? "Windows 无需单独授权；请确认输出设备可用。"
        : "用于转录电脑声音。需要时点击检测并按系统提示授权。",
    };
    if (mac && this.deps.architecture === "x64" && ["denied", "restricted"].includes(screen) && capture.platformSupported) {
      systemAudio.status = screen; systemAudio.observedAt = now;
      systemAudio.detail += " 请先允许屏幕录制。";
    }
    items.push(systemAudio);
    if (mac && this.deps.architecture === "arm64") {
      let trusted: boolean | undefined;
      try {
        const value = this.deps.accessibilityTrusted();
        trusted = typeof value === "boolean" ? value : undefined;
      } catch { trusted = undefined; }
      const status = trusted === true ? "granted" : trusted === false ? "not-granted" : "unknown";
      items.push({ id: "accessibility", status,
        action: !capture.platformSupported || status === "granted" ? "none" : "request",
        observedAt: trusted === undefined ? undefined : now,
        detail: "语音采集需要此权限。可在系统设置 → 隐私与安全性 → 辅助功能中允许。" });
    }
    return { platform: mac ? "darwin" : win ? "win32" : "other", architecture: this.deps.architecture,
      restartRecommended: mac && this.screenWasMissing && screen === "granted",
      audioCheckBusy: this.busy, cleanupRequired: capture.captureNeedsCleanup,
      audioSupported: capture.platformSupported, audioSupportMessage: capture.platformMessage, items };
  }
  private result(error?: string): CapturePermissionResult { return { success: !error, snapshot: this.snapshot(), ...(error ? { error } : {}) }; }
  async request(id: CapturePermissionId): Promise<CapturePermissionResult> {
    if (this.busy) return this.result("上一项权限操作尚未结束。");
    this.busy = true;
    let error: string | undefined;
    try {
      const capture = this.deps.captureState();
      if (capture.captureNeedsCleanup || !["idle", "ended", "error"].includes(capture.captureStatus)) throw new Error("请先停止并释放当前音频采集，再申请权限。");
      if (id === "screen") {
        if (!["darwin", "win32"].includes(this.deps.platform)) throw new Error("当前平台不支持截图检测。");
        this.screenRequested = true;
        await this.deps.probeScreen();
        this.screenVerifiedAt = this.now();
      } else if (id === "microphone") {
        if (this.deps.platform === "darwin" && this.media("microphone") === "not-determined") await this.deps.askMicrophone();
        else if (this.media("microphone") !== "granted" || this.deps.platform === "win32") await this.open(id);
      } else if (id === "system-audio" || id === "accessibility") {
        if (!capture.platformSupported) throw new Error(capture.platformMessage || "当前系统不支持实时音频采集。");
        if (this.deps.platform === "win32") await this.open("system-audio");
        else {
          const result = await this.deps.prepareAudio({ recallApiUrl: this.deps.recallApiUrl() });
          if (!result.success) error = result.error || "语音权限尚未准备好，请检查各项状态。";
        }
      } else throw new Error("无效的权限类型。");
    } catch (failure) { error = screenshotFailureMessage(failure); }
    finally { this.busy = false; }
    return this.result(error);
  }
  private async open(id: CapturePermissionId): Promise<void> {
    const url = this.deps.platform === "darwin" ? `x-apple.systempreferences:com.apple.preference.security?${MAC_SETTINGS[id]}`
      : this.deps.platform === "win32" ? (id === "screen" ? undefined : id === "system-audio" ? "ms-settings:sound" : "ms-settings:privacy-microphone") : undefined;
    if (!url) throw new Error("此平台没有对应的系统权限设置页。");
    await this.deps.openSettings(url);
  }
  async settings(id: CapturePermissionId): Promise<CapturePermissionResult> {
    try { await this.open(id); return this.result(); }
    catch (failure) { return this.result(screenshotFailureMessage(failure)); }
  }
}
