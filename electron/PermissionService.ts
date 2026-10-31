import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CapturePermissionId, CapturePermissionItem, CapturePermissionResult, CapturePermissionSnapshot, CapturePermissionStatus } from "./permissionsTypes";
import type { AudioPermissionResult, AudioPermissionSnapshot } from "./live/captureContracts";
import { screenshotFailureMessage } from "./screenshotFailure";

const MEDIA_STATUSES = ["granted", "not-determined", "denied", "restricted", "unknown"] as const;
const MAC_SETTINGS = { screen: "Privacy_ScreenCapture", microphone: "Privacy_Microphone", "system-audio": "Privacy_ScreenCapture", accessibility: "Privacy_Accessibility" } as const;
export interface PermissionServiceDependencies {
  platform: string;
  architecture: string;
  stateDirectory: string;
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
/** OS facts stay separate from retained provider observations and a guide acknowledgement. */
export class PermissionService {
  private acknowledged = false;
  private busy = false;
  private screenRequested = false;
  private screenVerifiedAt?: number;
  private readonly initialScreen: CapturePermissionStatus;
  private readonly marker: string;
  private readonly now: () => number;
  constructor(private readonly deps: PermissionServiceDependencies) {
    this.now = deps.now || Date.now;
    this.marker = path.join(deps.stateDirectory, "capture-permission-guide.json");
    this.initialScreen = this.media("screen");
    try {
      const marker = JSON.parse(fs.readFileSync(this.marker, "utf8"));
      this.acknowledged = marker?.version === 1 && typeof marker.acknowledgedAt === "number" && Number.isFinite(marker.acknowledgedAt);
    } catch { /* Missing or malformed acknowledgement never proves permission. */ }
  }
  private media(type: "screen" | "microphone"): CapturePermissionStatus {
    try {
      const value = this.deps.mediaStatus(type);
      return MEDIA_STATUSES.includes(value as never) ? value as CapturePermissionStatus : "unknown";
    } catch { return "unknown"; }
  }
  snapshot(): CapturePermissionSnapshot {
    const mac = this.deps.platform === "darwin", win = this.deps.platform === "win32";
    const now = this.now(), screen = mac ? this.media("screen") : win ? "not-required" : "unsupported";
    const microphone = mac || win ? this.media("microphone") : "unsupported";
    const capture = this.deps.captureState(), audio = this.deps.audioSnapshot();
    const items: CapturePermissionItem[] = [{
      id: "screen", status: screen, observedAt: mac ? now : this.screenVerifiedAt,
      action: mac || win ? (mac && screen !== "granted" && this.screenRequested ? "settings" : "request") : "none",
      detail: mac ? "用于你主动请求的屏幕截图。系统偏好设置 / 系统设置 → 隐私 → 屏幕录制；新版名称为屏幕与系统音频录制。"
        : win ? (this.screenVerifiedAt ? "本次截图检测已通过。Windows 桌面应用没有 macOS 式的屏幕录制开关。" : "Windows 无需单独授予屏幕录制权限；可点击测试截图检查当前显示器。") : "当前平台尚未提供截图权限引导。",
    }, {
      id: "microphone", status: microphone, observedAt: mac || win ? now : undefined,
      action: mac ? (["denied", "restricted"].includes(microphone) ? "settings" : microphone === "granted" ? "none" : "request") : win ? "settings" : "none",
      detail: mac ? "用于实时转录你的声音。已拒绝时，请在系统偏好设置 / 系统设置 → 隐私 → 麦克风中允许 PassWisely。"
        : win ? "请确认 Windows 设置 → 隐私和安全性 → 麦克风中的麦克风访问及允许桌面应用访问已开启。" : "当前平台不支持麦克风权限检查。",
    }];
    const systemAudio: CapturePermissionItem = {
      id: "system-audio", status: !capture.platformSupported ? "unsupported" : win ? "not-required" : audio?.systemAudio.status || "unknown",
      observedAt: audio?.systemAudio.observedAt,
      action: !capture.platformSupported ? "none" : win ? "settings" : "request",
      detail: !capture.platformSupported ? capture.platformMessage || "当前系统不支持实时音频采集。"
        : win ? "Windows 系统回放音频无需 macOS 式授权；请确认输出设备可用，麦克风全局开关另行检查。"
        : this.deps.architecture === "x64" ? "Intel 语音采集需要 macOS 13+。点击检测将由实际音频程序申请麦克风与屏幕录制权限，不开始录音或上传。"
        : "点击检测将由实际语音程序申请麦克风、系统音频和辅助功能权限，不开始录音或上传。状态时间表示上次实际检查。",
    };
    if (mac && this.deps.architecture === "x64" && ["denied", "restricted"].includes(screen) && capture.platformSupported) {
      systemAudio.status = screen; systemAudio.observedAt = now;
      systemAudio.detail += " 系统音频依赖屏幕录制授权。";
    }
    items.push(systemAudio);
    if (mac && this.deps.architecture === "arm64") {
      let trusted: boolean | undefined;
      try { trusted = this.deps.accessibilityTrusted(); } catch { trusted = undefined; }
      const retained = audio?.accessibility;
      const status = trusted === true ? "granted" : trusted === false && retained && retained.status !== "granted" ? retained.status : "unknown";
      items.push({ id: "accessibility", status,
        action: capture.platformSupported && !["denied", "restricted"].includes(status) ? "request" : "settings",
        observedAt: trusted === true ? now : retained && retained.status !== "granted" ? retained.observedAt : undefined,
        detail: "Apple 芯片的语音采集器需要辅助功能权限。可通过语音权限检测申请，或在隐私 → 辅助功能中允许 PassWisely。" });
    }
    return { platform: mac ? "darwin" : win ? "win32" : "other", architecture: this.deps.architecture,
      firstRun: !this.acknowledged, restartRecommended: mac && this.initialScreen !== "granted" && screen === "granted",
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
  async acknowledge(): Promise<CapturePermissionResult> {
    if (this.busy) return this.result("请等待当前权限操作结束。");
    if (this.acknowledged) return this.result();
    const temporary = `${this.marker}.${randomUUID()}.tmp`;
    let temporaryOwned = false;
    try {
      fs.mkdirSync(this.deps.stateDirectory, { recursive: true });
      if (fs.existsSync(this.marker)) fs.copyFileSync(this.marker, `${this.marker}.${randomUUID()}.backup`, fs.constants.COPYFILE_EXCL);
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      temporaryOwned = true;
      try { fs.writeFileSync(descriptor, JSON.stringify({ version: 1, acknowledgedAt: this.now() }) + "\n"); }
      finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, this.marker); this.acknowledged = true;
      return this.result();
    } catch (failure) {
      if (temporaryOwned) { try { fs.unlinkSync(temporary); } catch { /* Retain an owned temporary if removal fails. */ } }
      return this.result(screenshotFailureMessage(failure));
    }
  }
}
