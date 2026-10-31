import { spawn } from "node:child_process";
import { release } from "node:os";
import path from "node:path";
import type { CaptureStatus } from "./types";
import type { AudioCapture, AudioPermissionOptions, AudioPermissionSnapshot, CaptureCallbacks, CaptureSession, NativeCaptureSession } from "./captureContracts";
import { createDeepgramTranscriptNormalizer } from "./DeepgramTranscript";
import type { NativeAudioSource } from "./DeepgramTranscript";

const SOURCES: readonly NativeAudioSource[] = ["system", "microphone"];
const DEADLINE_MS = 15_000;
const PREPARE_DEADLINE_MS = 60_000;
const MAX_LINE_BYTES = 64 * 1024;
// Four seconds of 16kHz mono S16LE per source, independently bounded in the
// application queue and ws transport. Overload fails instead of losing audio.
const MAX_AUDIO_BYTES = 128_000;
const OPEN = 1;
interface Events {
  on(event: string, callback: (...args: any[]) => void): unknown;
  removeListener(event: string, callback: (...args: any[]) => void): unknown;
}
export interface NativePcmChild extends Events {
  stdin: Events & { write(data: string, callback?: (error?: Error | null) => void): boolean; writableLength?: number };
  stdout: Events;
  stderr: Events;
  kill(signal?: NodeJS.Signals): boolean;
}
export interface NativePcmSocket extends Events {
  readyState: number;
  bufferedAmount: number;
  send(data: string | Buffer, callback?: (error?: Error) => void): void;
  terminate(): void;
}
export interface NativeCaptureHost { platform: string; arch: string; release: string }
interface Clock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(timer: unknown): void;
}
export interface NativePcmCaptureOptions {
  helperPath: string;
  host?: NativeCaptureHost;
  spawnHelper?: (helperPath: string) => NativePcmChild;
  createSocket?: (url: string, options: { headers: { Authorization: string }; maxPayload: number;
    handshakeTimeout: number; perMessageDeflate: false }, source: NativeAudioSource) => NativePcmSocket;
  clock?: Clock;
  now?: () => number;
}
const clock: Clock = {
  setTimeout: (callback, ms) => { const timer = setTimeout(callback, ms); timer.unref?.(); return timer; },
  clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => { const timer = setInterval(callback, ms); timer.unref?.(); return timer; },
  clearInterval: timer => clearInterval(timer as ReturnType<typeof setInterval>),
};
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  // Some native events can reject a waiter synchronously, before its caller
  // attaches Promise.all. Keep that rejection handled without changing it.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
type Deferred = ReturnType<typeof deferred>;
type Channel = { source: NativeAudioSource; socket: NativePcmSocket; opened: Deferred; closed: Deferred;
  isClosed: boolean; closingRequested: boolean; normalizer: ReturnType<typeof createDeepgramTranscriptNormalizer> };
type Run = { child?: NativePcmChild; childClosed: boolean; childDone: Deferred; channels: Map<NativeAudioSource, Channel>;
  queues: Record<NativeAudioSource, Buffer[]>; bytes: Record<NativeAudioSource, number>; line: Buffer; helperRecording: boolean; helperEnded: boolean;
  waiter?: { state: string; done: Deferred }; drain?: Deferred; cleanup?: Promise<void>; fatal?: Error;
  stopping: boolean; prepared: boolean; started: boolean; keepalive?: unknown; pump?: unknown; killTimer?: unknown;
  listeners: Array<{ target: Events; event: string; callback: (...args: any[]) => void }> };
const nativeFailures: Record<string, string> = {
  MICROPHONE_PERMISSION_DENIED: "麦克风权限未获准。", SCREEN_PERMISSION_DENIED: "屏幕与系统音频权限未获准。",
  NO_DISPLAY: "未找到可采集的显示器。", MICROPHONE_UNAVAILABLE: "麦克风不可用。", SYSTEM_AUDIO_UNAVAILABLE: "系统音频不可用。",
  AUDIO_CONVERSION_FAILED: "原生音频格式转换失败。", AUDIO_BACKPRESSURE: "原生音频处理速度不足。",
  OUTPUT_BACKPRESSURE: "原生音频输出速度不足。", OUTPUT_CLOSED: "原生音频输出已关闭。",
  CAPTURE_START_FAILED: "原生音频采集启动失败。", CAPTURE_STOP_FAILED: "原生音频采集停止失败。",
  CAPTURE_TIMEOUT: "原生音频操作超时。", PROTOCOL_ERROR: "原生音频协议无效。", INVALID_STATE: "原生音频状态无效。",
  INTERNAL_ERROR: "原生音频采集失败。",
};

/** Owns one native child and two independently attributed ASR streams. Killing a
 * child or terminating a socket is a request, never proof that ownership ended. */
export class NativePcmCapture implements AudioCapture {
  private static owner: NativePcmCapture | null = null;
  private run: Run | null = null;
  private operation?: Promise<void>;
  private stopping?: Promise<void>;
  private disposed = false;
  private status: CaptureStatus = "idle";
  private permissions: AudioPermissionSnapshot = { microphone: { status: "unknown" }, systemAudio: { status: "unknown" } };
  private readonly clock: Clock;
  private readonly now: () => number;

  constructor(private readonly callbacks: CaptureCallbacks, private readonly options: NativePcmCaptureOptions) {
    this.clock = options.clock || clock;
    this.now = options.now || Date.now;
  }
  static support(host: NativeCaptureHost = { platform: process.platform, arch: process.arch, release: release() }): { supported: boolean; message?: string } {
    const version = /^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$/.exec(host.release);
    if (host.platform === "darwin" && host.arch === "x64" && version && version.slice(1).every(value => Number.isSafeInteger(Number(value))) && Number(version[1]) >= 22) return { supported: true };
    return { supported: false, message: "Intel 原生音频采集需要 Intel Mac 与 macOS 13 或更新版本。" };
  }
  private state(value: CaptureStatus): void { this.status = value; if (!this.disposed) this.callbacks.onState(value); }
  private listen(run: Run, target: Events, event: string, callback: (...args: any[]) => void): void {
    target.on(event, callback); run.listeners.push({ target, event, callback });
  }
  private current(run: Run): boolean { return this.run === run; }
  private assertActive(run: Run): void {
    if (!this.current(run) || run.stopping || this.disposed) throw new Error("音频操作已取消。");
    if (run.fatal) throw run.fatal;
  }
  private async deadline(work: Promise<void>, milliseconds = DEADLINE_MS): Promise<void> {
    let timer: unknown;
    try {
      await Promise.race([work, new Promise<void>((_resolve, reject) => {
        timer = this.clock.setTimeout(() => reject(new Error(`原生音频操作超时（${milliseconds / 1000} 秒）；清理尚未确认完成，请停止后重试。`)), milliseconds);
      })]);
    } finally { this.clock.clearTimeout(timer); }
  }
  private session(input: CaptureSession): NativeCaptureSession {
    if (!input || input.kind !== "native-deepgram" || typeof input.accessToken !== "string" ||
        !input.accessToken.trim() || input.accessToken.length > 8192 || /[\r\n]/.test(input.accessToken) ||
        !Number.isFinite(input.expiresAt) || input.expiresAt <= this.now() || input.model !== "nova-3" ||
        input.wsUrl !== "wss://api.deepgram.com/v1/listen" ||
        !((input.transcriptionProfile === "deepgram-en" && input.language === "en") ||
          (input.transcriptionProfile === "deepgram-zh" && input.language === "zh"))) throw new Error("原生转写会话配置无效或凭据已过期；请重新启动会话。");
    return input;
  }
  getPermissionSnapshot(): AudioPermissionSnapshot {
    return { microphone: { ...this.permissions.microphone }, systemAudio: { ...this.permissions.systemAudio } };
  }
  preparePermissions(signal: AbortSignal, _options: AudioPermissionOptions): Promise<void> {
    // The same owner prepares native permissions and discovers a display. It
    // does not create an ASR socket or send the helper's audio-start command.
    return this.prepare(signal);
  }
  prepare(signal: AbortSignal): Promise<void> {
    if (this.disposed || this.run || this.operation || this.stopping || NativePcmCapture.owner && NativePcmCapture.owner !== this) return Promise.reject(new Error("上一次原生音频采集尚未关闭。"));
    if (signal.aborted) return Promise.reject(new Error("音频操作已取消。"));
    const support = NativePcmCapture.support(this.options.host);
    if (!support.supported) return Promise.reject(new Error(support.message));
    if (!path.isAbsolute(this.options.helperPath) || this.options.helperPath.includes("\0")) return Promise.reject(new Error("原生音频程序路径无效。"));
    this.permissions = { microphone: { status: "unknown" }, systemAudio: { status: "unknown" } };
    const run: Run = { childClosed: false, childDone: deferred(), channels: new Map(), queues: { system: [], microphone: [] },
      bytes: { system: 0, microphone: 0 }, line: Buffer.alloc(0), helperRecording: false, helperEnded: false,
      stopping: false, prepared: false, started: false, listeners: [] };
    this.run = run; NativePcmCapture.owner = this;
    const abort = () => {
      run.fatal ||= new Error("音频操作已取消。");
      this.force(run); void this.cleanup(run);
    };
    signal.addEventListener("abort", abort, { once: true });
    this.state("starting");
    if (signal.aborted) abort();
    const work = (async () => {
      try {
        this.assertActive(run); this.spawnRun(run); this.assertActive(run);
        await this.helper(run, "prepare", "prepared");
        this.assertActive(run); run.prepared = true;
      } catch (error) {
        if (!run.child) { run.childClosed = true; run.childDone.resolve(); }
        else if (run.stopping) this.force(run);
        throw error;
      }
    })();
    this.operation = work;
    void work.finally(() => { if (this.operation === work) this.operation = undefined; }).catch(() => undefined);
    return this.deadline(work, PREPARE_DEADLINE_MS).catch(error => {
      if (!run.stopping) this.fail(run, "原生音频权限或可采集来源准备失败，请检查系统权限后重试。");
      if (String(error?.message).includes("60 秒")) throw error;
      throw run.fatal || new Error("音频操作已取消。");
    }).finally(() => signal.removeEventListener("abort", abort));
  }
  private spawnRun(run: Run): void {
    const child = this.options.spawnHelper ? this.options.spawnHelper(this.options.helperPath)
      : spawn(this.options.helperPath, [], { stdio: ["pipe", "pipe", "pipe"], shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C" } });
    run.child = child;
    this.listen(run, child.stdout, "data", data => this.lines(run, data));
    this.listen(run, child.stderr, "data", () => undefined); // Drain without retaining private native diagnostics.
    this.listen(run, child.stderr, "error", () => this.fail(run, "原生音频诊断通道已关闭。"));
    this.listen(run, child, "error", () => this.fail(run, "原生音频程序无法启动。"));
    this.listen(run, child.stdin, "error", () => this.fail(run, "原生音频控制通道已关闭。"));
    this.listen(run, child.stdout, "error", () => this.fail(run, "原生音频输出通道已关闭。"));
    this.listen(run, child, "close", (code: number | null) => {
      run.childClosed = true; run.childDone.resolve();
      if (run.line.length) this.fail(run, "原生音频输出在完整行之前结束。");
      else if (run.stopping && !run.fatal && (code !== 0 || !run.helperEnded)) this.fail(run, "原生音频停止未获正常退出确认。");
      else if (!run.stopping) this.fail(run, code === 0 ? "原生音频程序意外结束。" : "原生音频程序异常退出。");
    });
  }
  start(input: CaptureSession): Promise<void> {
    const run = this.run;
    if (this.disposed || !run || !run.prepared || run.started || run.stopping || run.fatal || this.operation || this.stopping) return Promise.reject(new Error("原生音频必须先完成权限准备，且上一次操作已经结束。"));
    let session: NativeCaptureSession;
    try { session = this.session(input); } catch (error) { return Promise.reject(error); }
    const work = this.startRun(run, session);
    this.operation = work;
    void work.finally(() => { if (this.operation === work) this.operation = undefined; }).catch(() => undefined);
    return this.deadline(work).catch(error => {
      if (!run.stopping) this.fail(run, "原生音频或实时转写启动失败，请检查权限与网络后停止重试。");
      if (String(error?.message).includes("15 秒")) { this.force(run); throw error; }
      throw run.fatal || new Error("音频操作已取消。");
    });
  }
  private async startRun(run: Run, session: NativeCaptureSession): Promise<void> {
    // Permissions and source discovery completed before the broker minted this
    // short-lived token. Both providers must be ready before native audio starts.
    for (const source of SOURCES) this.connect(run, session, source);
    await Promise.all([...run.channels.values()].map(channel => channel.opened.promise));
    this.assertActive(run);
    await this.helper(run, "start", "recording");
    this.assertActive(run); run.started = true; this.state("recording");
    run.keepalive = this.clock.setInterval(() => {
      for (const channel of run.channels.values()) if (!channel.isClosed && channel.socket.readyState === OPEN) this.send(run, channel, JSON.stringify({ type: "KeepAlive" }));
    }, 3000);
  }
  private connect(run: Run, session: NativeCaptureSession, source: NativeAudioSource): void {
    const url = new URL(session.wsUrl);
    for (const [key, value] of Object.entries({ model: session.model, language: session.language, encoding: "linear16", sample_rate: "16000", channels: "1", interim_results: "true", punctuate: "true", endpointing: "500" })) url.searchParams.set(key, value);
    const options = { headers: { Authorization: `Bearer ${session.accessToken}` }, maxPayload: MAX_LINE_BYTES, handshakeTimeout: DEADLINE_MS, perMessageDeflate: false as const };
    const socket: NativePcmSocket = this.options.createSocket ? this.options.createSocket(url.href, options, source)
      : new (require("ws") as new (url: string, options: unknown) => NativePcmSocket)(url.href, options);
    const channel: Channel = { source, socket, opened: deferred(), closed: deferred(), isClosed: false, closingRequested: false,
      normalizer: createDeepgramTranscriptNormalizer(source) };
    run.channels.set(source, channel);
    this.listen(run, socket, "open", () => {
      if (!this.current(run) || run.stopping) return;
      channel.opened.resolve(); this.drain(run);
    });
    this.listen(run, socket, "message", (data: unknown, binary?: boolean) => this.message(run, channel, data, binary));
    this.listen(run, socket, "error", () => this.fail(run, "Deepgram 实时转写连接失败，请检查网络与转写配置。"));
    this.listen(run, socket, "close", (code: number) => {
      channel.isClosed = true; channel.closed.resolve(); channel.opened.reject(new Error("转写连接已关闭。"));
      if (!run.stopping || !run.fatal && (!channel.closingRequested || code !== 1000)) this.fail(run, "Deepgram 实时转写连接意外关闭。请停止后重新启动会话。");
    });
  }
  private helper(run: Run, command: "prepare" | "start" | "pause" | "resume", state: "prepared" | "recording" | "paused"): Promise<void> {
    const done = deferred(); run.waiter = { state, done };
    return Promise.all([this.command(run, command), done.promise]).then(() => undefined).finally(() => { if (run.waiter?.done === done) run.waiter = undefined; });
  }
  private command(run: Run, command: "prepare" | "start" | "pause" | "resume" | "stop"): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!run.child || run.childClosed || (run.child.stdin.writableLength || 0) > 4096) return reject(new Error("原生音频控制通道不可用。"));
      try { run.child.stdin.write(JSON.stringify({ command }) + "\n", error => error ? reject(new Error("原生音频控制指令未能写入。")) : resolve()); }
      catch { reject(new Error("原生音频控制指令未能写入。")); }
    });
  }
  private lines(run: Run, input: unknown): void {
    if (!this.current(run) || run.fatal) return;
    if (!Buffer.isBuffer(input)) { this.fail(run, "原生音频输出格式无效。"); return; }
    let offset = 0;
    while (offset < input.length && !run.fatal) {
      const end = input.indexOf(10, offset), until = end < 0 ? input.length : end;
      if (run.line.length + until - offset + (end < 0 ? 0 : 1) > MAX_LINE_BYTES) { this.fail(run, "原生音频输出超过行长度限制。"); return; }
      const part = input.subarray(offset, until);
      run.line = run.line.length ? Buffer.concat([run.line, part]) : Buffer.from(part);
      if (end < 0) return;
      const line = run.line; run.line = Buffer.alloc(0); offset = end + 1;
      if (!line.length) continue;
      let event: unknown;
      try { event = JSON.parse(line.toString("utf8")); } catch { this.fail(run, "原生音频输出协议无效。"); return; }
      this.event(run, event);
    }
  }
  private event(run: Run, input: unknown): void {
    if (!input || typeof input !== "object" || Array.isArray(input)) { this.fail(run, "原生音频输出协议无效。"); return; }
    const value = input as Record<string, unknown>;
    if (value.event === "error") {
      const code = typeof value.code === "string" && Object.prototype.hasOwnProperty.call(nativeFailures, value.code) ? value.code : "INTERNAL_ERROR";
      if (code === "MICROPHONE_PERMISSION_DENIED") this.permissions.microphone = { status: "denied", observedAt: this.now() };
      if (code === "SCREEN_PERMISSION_DENIED") this.permissions.systemAudio = { status: "denied", observedAt: this.now() };
      this.fail(run, `${nativeFailures[code]} [native=${code}]`); return;
    }
    if (value.event === "prepared") {
      const waiter = run.waiter;
      if (waiter?.state === "prepared" && !run.stopping && !run.prepared) {
        // The helper emits prepared only after AVAuthorizationAuthorized and
        // CGPreflightScreenCaptureAccess, followed by display discovery.
        const observedAt = this.now();
        this.permissions = { microphone: { status: "granted", observedAt }, systemAudio: { status: "granted", observedAt } };
        waiter.done.resolve();
      }
      else this.fail(run, "原生音频准备状态与请求不一致。");
      return;
    }
    if (value.event === "state" && ["recording", "paused", "ended"].includes(String(value.state))) {
      run.helperRecording = value.state === "recording";
      if (value.state === "ended") run.helperEnded = true;
      const waiter = run.waiter;
      if (waiter && waiter.state === value.state) waiter.done.resolve();
      else if (!run.stopping) { this.fail(run, "原生音频状态与请求不一致。"); }
      return;
    }
    if (value.event !== "audio" || !SOURCES.includes(value.source as NativeAudioSource) || !run.helperRecording ||
        typeof value.audio !== "string" || !value.audio || value.audio.length > MAX_LINE_BYTES ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.audio)) { this.fail(run, "原生音频帧无效。"); return; }
    const bytes = Buffer.from(value.audio, "base64");
    if (!bytes.length || bytes.length % 2 || bytes.toString("base64") !== value.audio) { this.fail(run, "原生音频帧格式无效。"); return; }
    const source = value.source as NativeAudioSource;
    if (run.bytes[source] + bytes.length > MAX_AUDIO_BYTES) { this.fail(run, "实时转写速度不足，音频队列已满。请停止后重试。"); return; }
    run.queues[source].push(bytes); run.bytes[source] += bytes.length;
    this.drain(run);
  }
  private send(run: Run, channel: Channel, data: string | Buffer): boolean {
    if (run.fatal || channel.isClosed || channel.socket.readyState !== OPEN) return false;
    const buffered = channel.socket.bufferedAmount;
    if (!Number.isFinite(buffered) || buffered < 0 || buffered + Buffer.byteLength(data) > MAX_AUDIO_BYTES) { this.fail(run, "实时转写传输队列超过限制。"); return false; }
    try {
      channel.socket.send(data, error => { if (error) this.fail(run, "实时转写音频发送失败。请停止后重试。"); }); return true;
    } catch { this.fail(run, "实时转写音频发送失败。请停止后重试。"); return false; }
  }
  private drain(run: Run): void {
    if (!this.current(run) || run.fatal) return;
    let pending = false;
    for (const channel of run.channels.values()) {
      const source = channel.source;
      while (run.queues[source].length && channel.socket.readyState === OPEN && !run.fatal) {
        const frame = run.queues[source][0];
        const buffered = channel.socket.bufferedAmount;
        if (!Number.isFinite(buffered) || buffered < 0 || buffered > MAX_AUDIO_BYTES) { this.fail(run, "实时转写传输队列超过限制。"); return; }
        if (buffered + frame.length > MAX_AUDIO_BYTES) break;
        if (!this.send(run, channel, frame)) break;
        run.queues[source].shift(); run.bytes[source] -= frame.length;
      }
      pending ||= run.queues[source].length > 0;
    }
    // Before connection, queues still belong to their native source.
    pending ||= SOURCES.some(source => run.queues[source].length > 0);
    if (!pending) { const done = run.drain; run.drain = undefined; done?.resolve(); }
    else if (!run.pump && run.channels.size) run.pump = this.clock.setTimeout(() => { run.pump = undefined; this.drain(run); }, 20);
  }
  private message(run: Run, channel: Channel, data: unknown, binary?: boolean): void {
    if (!this.current(run) || run.fatal || this.disposed) return;
    if (binary === true || !(typeof data === "string" || Buffer.isBuffer(data)) || Buffer.byteLength(data) > MAX_LINE_BYTES) { this.fail(run, "实时转写响应超过限制或格式无效。"); return; }
    let value: any;
    try { value = JSON.parse(data.toString()); } catch { this.fail(run, "实时转写响应格式无效。"); return; }
    if (value?.type === "Error") { this.fail(run, "Deepgram 未能处理实时转写请求。请检查转写配置后重试。"); return; }
    // Filter paused interims before they can alter transcript identity.
    if (value?.type === "Results" && value.is_final === false && !["starting", "recording", "resuming"].includes(this.status)) return;
    const segment = channel.normalizer.normalize(value, this.now());
    if (segment) this.callbacks.onTranscript(segment);
  }
  private waitDrain(run: Run): Promise<void> {
    if (run.fatal || SOURCES.every(source => !run.queues[source].length)) return Promise.resolve();
    const done = run.drain ||= deferred(); this.drain(run); return done.promise;
  }
  private change(pausing: boolean): Promise<void> {
    const run = this.run;
    if (!run || run.stopping || run.fatal || this.disposed || this.operation || this.status !== (pausing ? "recording" : "paused")) return Promise.reject(new Error("当前没有可操作的原生音频会话。"));
    this.state(pausing ? "pausing" : "resuming");
    const work = (async () => {
      if (!pausing) for (const channel of run.channels.values()) channel.normalizer.beginCaptureEpoch();
      await this.helper(run, pausing ? "pause" : "resume", pausing ? "paused" : "recording");
      this.assertActive(run);
      if (pausing) {
        await this.waitDrain(run); this.assertActive(run);
        for (const channel of run.channels.values()) this.send(run, channel, JSON.stringify({ type: "Finalize" }));
      }
      this.assertActive(run); this.state(pausing ? "paused" : "recording");
    })();
    this.operation = work;
    void work.finally(() => { if (this.operation === work) this.operation = undefined; }).catch(() => undefined);
    return this.deadline(work).catch(error => { if (!run.stopping) this.fail(run, "原生音频暂停或恢复未能完成。请停止后重试。"); throw run.fatal || error; });
  }
  pause(): Promise<void> { return this.change(true); }
  resume(): Promise<void> { return this.change(false); }
  private fail(run: Run, message: string): void {
    if (!this.current(run) || run.fatal) return;
    run.fatal = new Error(message); run.waiter?.done.reject(run.fatal);
    for (const channel of run.channels.values()) channel.opened.reject(run.fatal);
    if (!this.disposed) { this.state("error"); this.callbacks.onError(message); }
    this.force(run); void this.cleanup(run);
  }
  private force(run: Run): void {
    run.stopping = true; run.waiter?.done.reject(run.fatal || new Error("音频操作已取消。"));
    this.clock.clearInterval(run.keepalive); this.clock.clearTimeout(run.pump); run.pump = undefined;
    for (const source of SOURCES) { run.queues[source].length = 0; run.bytes[source] = 0; }
    const done = run.drain; run.drain = undefined; done?.resolve();
    for (const channel of run.channels.values()) {
      channel.opened.reject(run.fatal || new Error("音频操作已取消。"));
      if (!channel.isClosed) try { channel.socket.terminate(); } catch { /* Keep ownership until close. */ }
    }
    if (run.child && !run.childClosed) {
      try { run.child.kill("SIGTERM"); } catch { /* Keep ownership until close. */ }
      if (!run.killTimer) run.killTimer = this.clock.setTimeout(() => {
        if (!run.childClosed) try { run.child!.kill("SIGKILL"); } catch { /* Retain the child. */ }
      }, 3000);
    }
  }
  private cleanup(run: Run): Promise<void> {
    if (run.cleanup) return run.cleanup;
    run.stopping = true;
    const done = deferred(); run.cleanup = done.promise;
    void (async () => {
      if (!run.fatal && run.child && !run.childClosed) void this.command(run, "stop").catch(() => { this.fail(run, "原生音频停止指令未能完成。"); });
      await run.childDone.promise;
      await this.waitDrain(run);
      if (!run.fatal) for (const channel of run.channels.values()) {
        this.send(run, channel, JSON.stringify({ type: "Finalize" }));
        channel.closingRequested = true;
        this.send(run, channel, JSON.stringify({ type: "CloseStream" }));
      }
      await Promise.all([...run.channels.values()].map(channel => channel.closed.promise));
      this.clock.clearInterval(run.keepalive); this.clock.clearTimeout(run.pump); this.clock.clearTimeout(run.killTimer);
      for (const listener of run.listeners) listener.target.removeListener(listener.event, listener.callback);
      run.line = Buffer.alloc(0);
      if (this.current(run)) this.run = null;
      if (NativePcmCapture.owner === this) NativePcmCapture.owner = null;
    })().then(done.resolve, done.reject);
    return run.cleanup;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const run = this.run;
    if (!run) return Promise.resolve();
    const work = (async () => {
      const previousFailure = run.fatal, wasStarting = !run.started;
      run.waiter?.done.reject(new Error("音频操作已取消。"));
      if (!run.fatal) this.state("stopping");
      if (!run.started && this.operation && !run.fatal) { run.fatal = new Error("音频操作已取消。"); this.force(run); }
      try { await this.deadline(this.cleanup(run)); }
      catch (error) { run.fatal ||= new Error("原生音频清理尚未完成。"); this.force(run); throw error; }
      if (!wasStarting && run.fatal && run.fatal !== previousFailure) throw run.fatal;
      if (!this.disposed) this.state("ended");
    })();
    this.stopping = work;
    void work.finally(() => { if (this.stopping === work) this.stopping = undefined; }).catch(() => undefined);
    return work;
  }
  dispose(): Promise<void> { this.disposed = true; return this.stop(); }
}
