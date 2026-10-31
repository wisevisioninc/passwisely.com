import type { AudioCapture, AudioPermissionOptions, AudioPermissionSnapshot, CaptureSession } from "./captureContracts";
import { release } from "node:os";
import type { CaptureStatus, TranscriptSegment } from "./types";
import { createRecallTranscriptNormalizer } from "./recallTranscript";

type Sdk = typeof import("@recallai/desktop-sdk").default;
type Callbacks = {
  onTranscript: (segment: TranscriptSegment) => void;
  onState: (status: CaptureStatus) => void;
  onError: (message: string) => void;
};
type EventValue = { window?: { id?: string }; [key: string]: unknown };
type Waiter = { event: string; generation: number; windowId: string; resolve: () => void; reject: (error: Error) => void };
const DEADLINE_MS = 15_000;
const PERMISSION_DEADLINE_MS = 60_000;
class CaptureFailure extends Error {}
class CaptureTimeout extends CaptureFailure {}
const REQUIRED_PERMISSIONS = ["accessibility", "microphone", "system-audio"] as const;
const API_URLS = ["https://us-west-2.recall.ai", "https://us-east-1.recall.ai", "https://eu-central-1.recall.ai", "https://ap-northeast-1.recall.ai"];
type RequiredPermission = typeof REQUIRED_PERMISSIONS[number];
const PERMISSION_STATUSES = ["granted", "not_requested", "denied", "not_installed", "error"] as const;
type PermissionStatus = typeof PERMISSION_STATUSES[number] | "unknown";
type StartPhase = "initializing" | "permissions" | "preparing-source" | "start-command" | "await-start-event" | "recording";
type StartProgress = { phase: StartPhase; commandAcknowledged: boolean; recordingStarted: boolean };

/** Classify native errors into fixed values. Never return native messages,
 * stacks, unknown event types, window IDs, upload tokens or provider credentials.
 */
function safeNativeFailure(value: unknown): { cause: string; httpStatus?: number; code?: string } {
  const field = (key: string): string => {
    if (!value || typeof value !== "object") return "";
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && typeof descriptor.value === "string" ? descriptor.value.slice(0, 4096) : "";
  };
  const message = field("message");
  const explicitStatus = /\b(?:HTTP(?:\/[12](?:\.\d)?)?[\s:]+|status(?:\s+code)?[=: ]+)(400|401|403|404|408|409|410|422|429|500|502|503|504)\b/i.exec(message);
  if (explicitStatus) {
    const httpStatus = Number(explicitStatus[1]);
    return { cause: httpStatus === 401 || httpStatus === 403 ? "http-auth" : httpStatus === 429 ? "rate-limit" : httpStatus >= 500 ? "upstream" : "http-request", httpStatus };
  }
  const codes = ["EPIPE", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EACCES", "EPERM"];
  const code = codes.find(code => field("code") === code || new RegExp(`\\b${code}\\b`).test(message));
  if (code) return { cause: ["EACCES", "EPERM"].includes(code) ? "reported-permission" : "network-or-ipc", code };
  if (/\b(?:permission denied|access denied|insufficient permissions)\b/i.test(message)) return { cause: "reported-permission" };
  if (/\b(?:unknown source|unknown window|already recorded|invalid window)\b/i.test(message)) return { cause: "reported-source" };
  if (field("type") === "process") return { cause: "sdk-process" };
  return { cause: "unknown" };
}

export class RecallCapture implements AudioCapture {
  private static owner: RecallCapture | null = null;
  private sdk?: Sdk;
  private initialized = false;
  private initializedApiUrl?: string;
  private ownsProcess = false;
  private disposed = false;
  private windowId?: string;
  private generation = 0;
  private status: CaptureStatus = "idle";
  private operation?: Promise<void>;
  private nativePending?: Promise<unknown>;
  private stopping?: Promise<void>;
  private disposing?: Promise<void>;
  private waiter?: Waiter;
  private listeners: Array<{ event: string; callback: (event: EventValue) => void }> = [];
  private permissions = new Map<RequiredPermission, { status: PermissionStatus; observedAt: number }>();
  private permissionChanged?: () => void;
  private processExited?: () => void;
  private retiredWindows = new Set<string>();
  private normalizer = createRecallTranscriptNormalizer();
  private finalDrainUntil = 0;
  private startProgress?: StartProgress;

  constructor(private readonly callbacks: Callbacks) {}

  static support(): { supported: boolean; message?: string } {
    if (process.platform === "win32" && process.arch === "x64") {
      // Recall requires Windows 10 1803+, whose OS build is 17134. Windows 11
      // also reports kernel 10.0; compare the actual build rather than a label.
      const version = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(release());
      const parts = version?.slice(1).map(Number);
      if (!parts || !parts.every(Number.isSafeInteger)) return { supported: false, message: "无法确认 Windows 系统版本。Recall 音频采集需要 x64 Windows 10 1803（内部版本 17134）或更新版本，请检查系统版本后重试。" };
      if (parts[0] > 10 || parts[0] === 10 && (parts[1] > 0 || parts[2] >= 17134)) return { supported: true };
      return { supported: false, message: "Recall 音频采集需要 x64 Windows 10 1803（内部版本 17134）或更新版本。" };
    }
    if (process.platform === "darwin" && process.arch === "arm64") {
      const [major, minor] = release().split(".").map(Number);
      if (major > 23 || (major === 23 && minor >= 2)) return { supported: true };
      return { supported: false, message: "Recall 纯音频采集需要 macOS 14.2 或更新版本。" };
    }
    return { supported: false, message: "Recall 音频采集支持 Apple Silicon Mac（macOS 14.2+）及 Windows x64。" };
  }

  private setState(status: CaptureStatus): void {
    this.status = status;
    this.callbacks.onState(status);
  }

  private failure(message: string): Error {
    if (!this.disposed) {
      this.setState("error");
      this.callbacks.onError(message);
    }
    return new Error(message);
  }

  private assertGeneration(generation: number): void {
    if (this.disposed || generation !== this.generation) throw new Error("音频操作已取消。");
  }

  private async deadline<T>(promise: Promise<T>, description: string, milliseconds = DEADLINE_MS): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([promise, new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CaptureTimeout(`${description}超时（${milliseconds / 1000} 秒），请检查系统权限后停止并重试。`)), milliseconds);
      })]);
    } finally { clearTimeout(timer!); }
  }

  private add(event: string, callback: (event: EventValue) => void): void {
    this.sdk!.addEventListener(event as Parameters<Sdk["addEventListener"]>[0], callback as never);
    this.listeners.push({ event, callback });
  }

  private async command<T>(promise: Promise<T>): Promise<T> {
    this.nativePending = promise;
    try { return await promise; }
    finally { if (this.nativePending === promise) this.nativePending = undefined; }
  }

  private attach(): void {
    const matched = (event: EventValue) => Boolean(this.windowId && event.window?.id === this.windowId);
    for (const name of ["recording-started", "recording-ended"]) {
      this.add(name, event => {
        if (!matched(event) || this.disposed) return;
        const waiter = this.waiter;
        if (waiter && waiter.event === name && waiter.generation === this.generation && waiter.windowId === this.windowId) {
          if (name === "recording-started" && this.startProgress) this.startProgress.recordingStarted = true;
          this.waiter = undefined;
          waiter.resolve();
          if (name === "recording-started" && this.status === "starting") this.setState("recording");
        }
        if (name === "recording-ended" && this.status !== "stopping") {
          ++this.generation;
          this.rejectWaiter("音频采集已结束。");
          this.retireWindow();
          this.setState("ended");
        }
      });
    }
    this.add("realtime-event", event => {
      if (!matched(event) || this.disposed) return;
      const tailFinal = event.event === "transcript.data" && (
        this.status === "pausing" || this.status === "stopping" || this.status === "resuming" ||
        this.status === "paused" && Date.now() <= this.finalDrainUntil
      );
      if (this.status !== "recording" && !tailFinal) return;
      const segment = this.normalizer.normalize(event);
      if (segment) this.callbacks.onTranscript(segment);
    });
    this.add("permission-status", event => {
      // Permissions and shutdown concern this owned SDK process, not a window.
      if (RecallCapture.owner !== this || this.disposed || !REQUIRED_PERMISSIONS.includes(event.permission as RequiredPermission)) return;
      const status: PermissionStatus = PERMISSION_STATUSES.includes(event.status as typeof PERMISSION_STATUSES[number])
        ? event.status as PermissionStatus : "unknown";
      this.permissions.set(event.permission as RequiredPermission, { status, observedAt: Date.now() });
      this.permissionChanged?.();
    });
    this.add("error", event => {
      if (RecallCapture.owner !== this || this.disposed || (event.window && !matched(event))) return;
      const error = this.failure(`Recall 音频进程发生错误，请停止会话后重试。${this.startProgress ? this.startFailureDetails(event, this.startProgress) : ""}`);
      ++this.generation;
      this.rejectWaiter(error.message);
      this.permissionChanged?.();
    });
    this.add("shutdown", () => {
      if (RecallCapture.owner !== this || this.disposed) return;
      this.initialized = false;
      this.ownsProcess = false;
      this.processExited?.();
      ++this.generation;
      this.rejectWaiter("Recall 音频进程已退出。");
      this.permissionChanged?.();
      if (this.status !== "stopping") this.failure("Recall 音频进程已退出，请停止会话后重试。");
    });
  }

  private rejectWaiter(message: string): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.reject(new Error(message));
  }

  private retireWindow(): void {
    if (this.windowId) this.retiredWindows.add(this.windowId);
    this.windowId = undefined;
  }

  private waitFor(event: string, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.waiter = { event, generation, windowId: this.windowId!, resolve, reject };
    });
  }

  private permissionFailure(reason: string): CaptureFailure {
    const missing = REQUIRED_PERMISSIONS.filter(permission => this.permissions.get(permission)?.status !== "granted")
      .map(permission => `${permission}=${this.permissions.get(permission)?.status || "unknown"}`).join("；");
    return new CaptureFailure(`Recall 权限${reason}：${missing || "unknown"}。请在系统设置中确认对应的 PassWisely 权限，停止后重试。`);
  }

  private startFailureDetails(error: unknown, progress: StartProgress): string {
    const safe = safeNativeFailure(error);
    const permissions = process.platform === "win32" ? "macos-consent-not-required-on-windows"
      : REQUIRED_PERMISSIONS.map(permission => `${permission}=${this.permissions.get(permission)?.status || "unknown"}`).join(",");
    return ` [phase=${progress.phase}; cause=${safe.cause}${safe.httpStatus ? `; http=${safe.httpStatus}` : ""}${safe.code ? `; code=${safe.code}` : ""}; commandAck=${progress.commandAcknowledged}; startedEvent=${progress.recordingStarted}; permissions=${permissions}]`;
  }

  private async ensurePermissions(generation: number): Promise<void> {
    this.assertGeneration(generation);
    if (process.platform !== "darwin") return;
    const required = REQUIRED_PERMISSIONS;
    for (const permission of required) {
      if (this.permissions.get(permission)?.status !== "granted") {
        try { await this.command(this.sdk!.requestPermission(permission)); }
        catch {
          this.assertGeneration(generation);
          throw this.permissionFailure(`请求失败（${permission}）`);
        }
      }
      this.assertGeneration(generation);
    }
    await new Promise<void>((resolve, reject) => {
      this.permissionChanged = () => {
        if (generation !== this.generation || this.disposed) reject(new Error("音频权限申请已取消。"));
        else if (required.some(permission => ["denied", "error", "not_installed"].includes(this.permissions.get(permission)?.status || ""))) {
          reject(this.permissionFailure("检查未通过"));
        } else if (required.every(permission => this.permissions.get(permission)?.status === "granted")) resolve();
      };
      this.permissionChanged();
    }).finally(() => { this.permissionChanged = undefined; });
  }

  getPermissionSnapshot(): AudioPermissionSnapshot {
    // Windows has no corresponding SDK consent flow. This says nothing about
    // the separate Windows microphone privacy switch, checked by the app host.
    if (process.platform === "win32") return {
      microphone: { status: "not-required" }, systemAudio: { status: "not-required" }, accessibility: { status: "not-required" },
    };
    const observation = (permission: RequiredPermission) => ({ ...(this.permissions.get(permission) || { status: "unknown" as const }) });
    return { microphone: observation("microphone"), systemAudio: observation("system-audio"), accessibility: observation("accessibility") };
  }

  private claim(apiUrl: string | undefined): string {
    if (this.disposed) throw new Error("音频采集器已关闭。");
    if (this.operation || this.nativePending || this.stopping || this.disposing || this.windowId || this.ownsProcess && !this.initialized) throw new Error("请先停止或关闭上一次音频操作。");
    if (RecallCapture.owner && RecallCapture.owner !== this) throw new Error("另一个音频采集器仍持有 Recall 进程，请先关闭它。");
    if (typeof apiUrl !== "string" || !API_URLS.includes(apiUrl)) throw this.failure("Recall 区域配置无效或缺失，请检查服务区域配置后重试授权。");
    if (this.initialized && apiUrl !== this.initializedApiUrl) throw new Error("Recall 区域已变化，请关闭采集器后重新启动。");
    RecallCapture.owner = this;
    return apiUrl;
  }

  private async initialize(apiUrl: string, generation: number): Promise<void> {
    this.assertGeneration(generation);
    if (!this.sdk) {
      const module = require("@recallai/desktop-sdk") as { default?: Sdk } & Sdk;
      this.sdk = module.default || module;
      this.attach();
    }
    if (!this.initialized) {
      this.ownsProcess = true;
      this.permissions.clear();
      await this.command(this.sdk.init({ apiUrl, acquirePermissionsOnStartup: [], restartOnError: false, telemetryMode: "off" }));
      this.assertGeneration(generation);
      this.initialized = true;
      this.initializedApiUrl = apiUrl;
    }
  }

  async preparePermissions(signal: AbortSignal, options: AudioPermissionOptions): Promise<void> {
    const support = RecallCapture.support();
    if (!support.supported) throw new Error(support.message);
    if (signal.aborted) throw new Error("音频权限申请已取消。");
    if (this.disposed) throw new Error("音频采集器已关闭。");
    if (process.platform === "win32") return;
    const apiUrl = this.claim(options.recallApiUrl);
    const generation = ++this.generation;
    let rejectAbort!: (error: Error) => void;
    const cancelled = new Promise<void>((_resolve, reject) => { rejectAbort = reject; });
    const abort = () => {
      if (generation === this.generation) { ++this.generation; this.permissionChanged?.(); }
      rejectAbort(new Error("音频权限申请已取消。"));
    };
    signal.addEventListener("abort", abort, { once: true });
    const work = (async () => {
      this.assertGeneration(generation);
      await this.initialize(apiUrl, generation);
      this.assertGeneration(generation);
      await this.ensurePermissions(generation);
      this.assertGeneration(generation);
    })();
    this.operation = work;
    try { await this.deadline(Promise.race([work, cancelled]), "音频权限申请", PERMISSION_DEADLINE_MS); }
    catch (error) {
      if (generation !== this.generation || this.disposed) throw new Error("音频权限申请已取消。");
      ++this.generation; this.permissionChanged?.();
      throw this.failure(error instanceof CaptureTimeout ? this.permissionFailure("检查超时（60 秒）").message
        : error instanceof CaptureFailure ? error.message : "Recall 权限准备失败，请检查系统权限与服务区域配置后重试。");
    } finally {
      signal.removeEventListener("abort", abort);
      // A deadline or cancellation does not settle a native command. Retain it
      // until it completes so dispose cannot race a late native initialization.
      void work.finally(() => { if (this.operation === work) this.operation = undefined; }).catch(() => undefined);
    }
  }

  async start(input: CaptureSession): Promise<void> {
    if (input.kind !== "recall-upload") throw this.failure("Recall 采集器收到不匹配的音频会话。 ");
    const support = RecallCapture.support();
    if (!support.supported) throw this.failure(support.message!);
    if (!input.uploadToken) {
      throw this.failure("音频会话凭据或 Recall 区域无效。");
    }
    this.claim(input.apiUrl);
    const generation = ++this.generation;
    this.setState("starting");
    this.normalizer = createRecallTranscriptNormalizer();
    const progress: StartProgress = { phase: "initializing", commandAcknowledged: false, recordingStarted: false };
    this.startProgress = progress;
    const work = (async () => {
      await this.initialize(input.apiUrl, generation);
      progress.phase = "permissions";
      await this.ensurePermissions(generation);
      this.assertGeneration(generation);
      progress.phase = "preparing-source";
      const id = await this.command(this.sdk!.prepareDesktopAudioRecording());
      this.assertGeneration(generation);
      if (!id || this.retiredWindows.has(id)) throw new CaptureFailure("Recall 返回了无效或已使用的音频来源，请关闭后重试。");
      this.windowId = id;
      progress.phase = "start-command";
      const started = this.waitFor("recording-started", generation);
      // Register the waiter before a native method can synchronously emit an event.
      await Promise.all([Promise.resolve().then(() => this.command(this.sdk!.startRecording({ windowId: id, uploadToken: input.uploadToken }))).then(() => {
        progress.commandAcknowledged = true;
        progress.phase = progress.recordingStarted ? "recording" : "await-start-event";
      }), started]);
      this.assertGeneration(generation);
      if (this.status !== "recording") this.setState("recording");
    })();
    this.operation = work;
    try { await this.deadline(work, "启动录音"); }
    catch (error) {
      if (generation !== this.generation || this.disposed) throw new Error("音频操作已取消。");
      ++this.generation;
      this.rejectWaiter("录音启动已取消。");
      this.permissionChanged?.();
      const message = error instanceof CaptureTimeout && progress.phase === "permissions"
        ? this.permissionFailure("检查超时（15 秒）").message
        : error instanceof CaptureFailure ? `${error.message}${error instanceof CaptureTimeout ? this.startFailureDetails(error, progress) : ""}`
        : `Recall 无法启动录音，请停止后重试。${this.startFailureDetails(error, progress)}`;
      throw this.failure(message);
    } finally {
      // Keep an unfinished operation owned after timeout, until it actually settles.
      void work.finally(() => { if (this.operation === work) this.operation = undefined; }).catch(() => undefined);
    }
  }

  private async change(pausing: boolean): Promise<void> {
    if (this.disposed || !this.sdk || !this.windowId || this.operation) throw new Error("当前没有可操作的音频会话。");
    if (this.status !== (pausing ? "recording" : "paused")) throw new Error("音频会话状态已变化，请稍后重试。");
    const id = this.windowId;
    const generation = this.generation;
    // A provider may deliver a result synchronously from resumeRecording.
    // Its unfinished rows belong to a fresh application capture interval.
    if (!pausing) this.normalizer.beginCaptureEpoch();
    this.setState(pausing ? "pausing" : "resuming");
    if (pausing) this.finalDrainUntil = Date.now() + 2000;
    const work = Promise.resolve().then(() => this.command(pausing ? this.sdk!.pauseRecording({ windowId: id }) : this.sdk!.resumeRecording({ windowId: id }))).then(() => undefined);
    this.operation = work;
    try {
      await this.deadline(work, pausing ? "暂停录音" : "恢复录音");
      this.assertGeneration(generation);
      if (pausing) this.finalDrainUntil = Date.now() + 2000;
      this.setState(pausing ? "paused" : "recording");
    } catch (error) {
      if (generation !== this.generation || this.disposed) throw new Error("音频操作已取消。");
      throw this.failure(error instanceof CaptureFailure ? error.message : "Recall 未能确认暂停或恢复，请停止会话后重试。");
    }
    finally { void work.finally(() => { if (this.operation === work) this.operation = undefined; }).catch(() => undefined); }
  }

  pause(): Promise<void> { return this.change(true); }
  resume(): Promise<void> { return this.change(false); }

  stop(): Promise<void> {
    if (this.disposing) return this.disposing;
    if (this.stopping) return this.stopping;
    const work = this.stopInternal();
    this.stopping = work;
    void work.finally(() => { if (this.stopping === work) this.stopping = undefined; }).catch(() => undefined);
    return work;
  }

  private async stopInternal(): Promise<void> {
    if (this.disposed) return;
    ++this.generation;
    this.rejectWaiter("音频操作已停止。");
    this.permissionChanged?.();
    this.setState("stopping");
    const generation = this.generation;
    const pending = this.operation;
    const work = (async () => {
      if (pending) await pending.catch(() => undefined);
      this.assertGeneration(generation);
      if (this.nativePending) await this.nativePending.catch(() => undefined);
      this.assertGeneration(generation);
      if (this.sdk && this.windowId && this.ownsProcess) {
        const id = this.windowId;
        const ended = this.waitFor("recording-ended", generation);
        await Promise.all([Promise.resolve().then(() => this.command(this.sdk!.stopRecording({ windowId: id }))), ended]);
      }
      this.retireWindow();
      this.assertGeneration(generation);
      this.setState("ended");
    })();
    try {
      await this.deadline(work, "停止录音");
    } catch (error) {
      if (this.disposed || this.disposing) return;
      if (!this.ownsProcess) { this.retireWindow(); this.setState("ended"); return; }
      ++this.generation;
      this.rejectWaiter("停止录音未完成。");
      throw this.failure(error instanceof CaptureFailure ? `${error.message}仍保留采集资源。` : "Recall 未确认录音已停止，仍保留采集资源，请重试关闭。");
    }
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    const work = this.disposeInternal();
    this.disposing = work;
    void work.finally(() => { if (this.disposing === work) this.disposing = undefined; }).catch(() => undefined);
    return work;
  }

  private async disposeInternal(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.rejectWaiter("音频采集器正在关闭。");
    this.permissionChanged?.();
    this.setState("stopping");
    const pending = this.operation;
    let releaseWaiter: (() => void) | undefined;
    const work = (async () => {
      // Native commands can outlive the caller's deadline. A timed-out dispose
      // cannot race late init or issue another shutdown after a newer attempt.
      if (pending) await pending.catch(() => undefined);
      if (this.nativePending) await this.nativePending.catch(() => undefined);
      if (generation !== this.generation) throw new Error("音频关闭操作已取消。");
      if (this.sdk && this.ownsProcess) {
        const exited = new Promise<void>(resolve => { releaseWaiter = resolve; this.processExited = resolve; });
        // SDK2.0.39 resolves shutdown after its force-kill attempt even without
        // close. Require both the command to settle and actual process exit.
        const requested = Promise.resolve().then(() => this.command(this.sdk!.shutdown()));
        await Promise.all([exited, requested]);
      }
    })();
    try {
      await this.deadline(work, "关闭音频进程");
    } catch (error) {
      if (generation === this.generation) ++this.generation;
      if (this.ownsProcess || this.operation || this.nativePending) throw this.failure(error instanceof CaptureFailure ? `${error.message}仍保留资源所有权。` : "Recall 进程未确认退出，仍保留资源所有权，请重试关闭。");
    } finally { if (this.processExited === releaseWaiter) this.processExited = undefined; }
    this.initialized = false;
    this.ownsProcess = false;
    this.retireWindow();
    try {
      while (this.sdk && this.listeners.length) {
        const { event, callback } = this.listeners[0];
        this.sdk.removeEventListener(event as Parameters<Sdk["removeEventListener"]>[0], callback as never);
        this.listeners.shift();
      }
    } catch { throw this.failure("Recall 监听器清理未完成，仍保留资源所有权，请重试关闭。"); }
    this.disposed = true;
    if (RecallCapture.owner === this) RecallCapture.owner = null;
    this.setState("ended");
  }
}
