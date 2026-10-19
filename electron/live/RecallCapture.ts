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
class CaptureFailure extends Error {}
class CaptureTimeout extends CaptureFailure {}
const REQUIRED_PERMISSIONS = ["accessibility", "microphone", "system-audio"] as const;
type RequiredPermission = typeof REQUIRED_PERMISSIONS[number];
const PERMISSION_STATUSES = ["granted", "not_requested", "denied", "not_installed", "error"] as const;
type PermissionStatus = typeof PERMISSION_STATUSES[number] | "unknown";

export class RecallCapture {
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
  private permissions = new Map<RequiredPermission, PermissionStatus>();
  private permissionChanged?: () => void;
  private processExited?: () => void;
  private retiredWindows = new Set<string>();
  private normalizer = createRecallTranscriptNormalizer();
  private finalDrainUntil = 0;

  constructor(private readonly callbacks: Callbacks) {}

  static support(): { supported: boolean; message?: string } {
    if (process.platform === "win32" && process.arch === "x64") return { supported: true };
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

  private async deadline<T>(promise: Promise<T>, description: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([promise, new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CaptureTimeout(`${description}超时（15 秒），请检查系统权限后停止并重试。`)), DEADLINE_MS);
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
      this.permissions.set(event.permission as RequiredPermission, status);
      this.permissionChanged?.();
    });
    this.add("error", event => {
      if (RecallCapture.owner !== this || this.disposed || (event.window && !matched(event))) return;
      const error = this.failure("Recall 音频进程发生错误，请停止会话后重试。");
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
    const missing = REQUIRED_PERMISSIONS.filter(permission => this.permissions.get(permission) !== "granted")
      .map(permission => `${permission}=${this.permissions.get(permission) || "unknown"}`).join("；");
    return new CaptureFailure(`Recall 权限${reason}：${missing || "unknown"}。请在系统设置中确认对应的 PassWisely 权限，停止后重试。`);
  }

  private async ensurePermissions(generation: number): Promise<void> {
    if (process.platform !== "darwin") return;
    const required = REQUIRED_PERMISSIONS;
    for (const permission of required) {
      if (this.permissions.get(permission) !== "granted") {
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
        else if (required.some(permission => ["denied", "error", "not_installed"].includes(this.permissions.get(permission) || ""))) {
          reject(this.permissionFailure("检查未通过"));
        } else if (required.every(permission => this.permissions.get(permission) === "granted")) resolve();
      };
      this.permissionChanged();
    }).finally(() => { this.permissionChanged = undefined; });
  }

  async start(input: { uploadToken: string; apiUrl: string }): Promise<void> {
    const support = RecallCapture.support();
    if (!support.supported) throw this.failure(support.message!);
    if (this.disposed) throw new Error("音频采集器已关闭。");
    if (this.operation || this.nativePending || this.stopping || this.disposing || this.windowId || this.ownsProcess && !this.initialized) throw new Error("请先停止或关闭上一次音频操作。");
    if (RecallCapture.owner && RecallCapture.owner !== this) throw new Error("另一个音频采集器仍持有 Recall 进程，请先关闭它。");
    if (!input.uploadToken || !["https://us-west-2.recall.ai", "https://us-east-1.recall.ai", "https://eu-central-1.recall.ai", "https://ap-northeast-1.recall.ai"].includes(input.apiUrl)) {
      throw this.failure("音频会话凭据或 Recall 区域无效。");
    }
    if (this.initialized && input.apiUrl !== this.initializedApiUrl) throw new Error("Recall 区域已变化，请关闭采集器后重新启动。");
    RecallCapture.owner = this;
    const generation = ++this.generation;
    this.setState("starting");
    this.normalizer = createRecallTranscriptNormalizer();
    const progress: { phase: "initializing" | "permissions" | "recording" } = { phase: "initializing" };
    const work = (async () => {
      if (!this.sdk) {
        const module = require("@recallai/desktop-sdk") as { default?: Sdk } & Sdk;
        this.sdk = module.default || module;
        this.attach();
      }
      if (!this.initialized) {
        this.ownsProcess = true;
        this.permissions.clear();
        await this.command(this.sdk.init({ apiUrl: input.apiUrl, acquirePermissionsOnStartup: [], restartOnError: false, telemetryMode: "off" }));
        this.assertGeneration(generation);
        this.initialized = true;
        this.initializedApiUrl = input.apiUrl;
      }
      progress.phase = "permissions";
      await this.ensurePermissions(generation);
      this.assertGeneration(generation);
      progress.phase = "recording";
      const id = await this.command(this.sdk.prepareDesktopAudioRecording());
      this.assertGeneration(generation);
      if (!id || this.retiredWindows.has(id)) throw new CaptureFailure("Recall 返回了无效或已使用的音频来源，请关闭后重试。");
      this.windowId = id;
      const started = this.waitFor("recording-started", generation);
      // Register the waiter before a native method can synchronously emit an event.
      await Promise.all([Promise.resolve().then(() => this.command(this.sdk!.startRecording({ windowId: id, uploadToken: input.uploadToken }))), started]);
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
        : error instanceof CaptureFailure ? error.message : "Recall 无法启动录音，请检查系统权限并停止后重试。";
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
    ++this.generation;
    this.rejectWaiter("音频采集器正在关闭。");
    this.permissionChanged?.();
    this.setState("stopping");
    try {
      if (this.sdk && this.ownsProcess) {
        const exited = new Promise<void>(resolve => { this.processExited = resolve; });
        // SDK2.0.39 resolves shutdown after its force-kill attempt even without
        // a close event. Only the shutdown event proves that the process exited.
        const requested = Promise.resolve().then(() => this.command(this.sdk!.shutdown())).then(() => exited);
        await this.deadline(Promise.race([exited, requested]), "关闭音频进程");
      }
    } catch (error) {
      if (this.ownsProcess) throw this.failure(error instanceof CaptureFailure ? `${error.message}仍保留资源所有权。` : "Recall 进程未确认退出，仍保留资源所有权，请重试关闭。");
    } finally { this.processExited = undefined; }
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
