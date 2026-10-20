import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { buildConversationMessages } from "./ConversationContext";
import { MAX_SCREENSHOTS } from "../screenshotLimits";
import { DEFAULT_TRANSCRIPTION_PROFILE, getTranscriptionProfile } from "./transcription";
import type { TranscriptionProfileId } from "./transcription";
import type { CaptureStatus, LiveAnswer, LiveAskInput, LiveResult, LiveSnapshot, TranscriptSegment } from "./types";

export interface CaptureCallbacks {
  onTranscript: (segment: TranscriptSegment) => void;
  onState: (status: CaptureStatus) => void;
  onError: (message: string) => void;
}
export interface AudioCapture {
  start: (upload: { uploadToken: string; apiUrl: string }) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
}
interface Dependencies {
  support: { supported: boolean; message?: string };
  createCapture: (callbacks: CaptureCallbacks) => AudioCapture;
  createUpload: (sessionId: string, signal: AbortSignal, profileId: TranscriptionProfileId) => Promise<{ uploadToken: string; apiUrl: string; transcriptionProfile?: TranscriptionProfileId }>;
  transcriptionProfile?: () => TranscriptionProfileId;
  stream: (messages: OpenAI.Chat.ChatCompletionMessageParam[], signal: AbortSignal, update: (text: string, model: string) => void) => Promise<OpenAI.Chat.ChatCompletion>;
  pendingScreenshots: () => string[];
  images: (paths: readonly string[], signal: AbortSignal) => Promise<string[]>;
  consumeScreenshots: (paths: readonly string[], signal: AbortSignal) => Promise<LiveResult>;
  language: () => string;
  publish: (snapshot: LiveSnapshot) => void;
}

const MAX_TRANSCRIPT_BYTES = 128 * 1024;
const MAX_SEGMENT_BYTES = 16 * 1024;
const MAX_ANSWER_BYTES = 128 * 1024;
function limitedText(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  let out = "";
  let size = 0;
  for (const char of text) { const n = Buffer.byteLength(char); if (size + n > bytes) break; out += char; size += n; }
  return out;
}
const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试。";

/** Owns capture, transcript and answer lifetimes independently of renderer mounts. */
export class LiveSessionService {
  private revision = 0;
  private generation = 0;
  private captureEpoch = 0;
  private capture: AudioCapture | null = null;
  private starting: AbortController | null = null;
  private answer: AbortController | null = null;
  private clearing: AbortController | null = null;
  private pendingConsumption: Promise<LiveResult> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private control: Promise<LiveResult> | null = null;
  private closed = false;
  private state: LiveSnapshot;

  constructor(private readonly deps: Dependencies) { this.state = this.empty(); }
  private empty(): LiveSnapshot {
    const transcription = getTranscriptionProfile(this.deps.transcriptionProfile?.() || DEFAULT_TRANSCRIPTION_PROFILE);
    if (!transcription) throw new Error("Unknown transcription profile.");
    return { sessionId: randomUUID(), revision: this.revision, provider: "recall-v2", transcription: { ...transcription }, captureStatus: "idle", transcripts: [], answers: [], transcriptTruncated: false, captureNeedsCleanup: false, platformSupported: this.deps.support.supported, platformMessage: this.deps.support.message };
  }
  getSnapshot(): LiveSnapshot { return structuredClone(this.state); }
  private emit(immediate = false): void {
    this.state.revision = ++this.revision;
    if (this.timer && immediate) { clearTimeout(this.timer); this.timer = null; }
    if (immediate) this.deps.publish(this.getSnapshot());
    else if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.deps.publish(this.getSnapshot()); }, 50);
  }
  private receive(segment: TranscriptSegment): void {
    const i = this.state.transcripts.findIndex(x => x.id === segment.id);
    const existing = i >= 0 ? this.state.transcripts[i] : undefined;
    // Revisions stay with the original capture interval, including late finals.
    const item = { ...segment, captureEpoch: existing?.captureEpoch ?? this.captureEpoch, text: limitedText(segment.text, MAX_SEGMENT_BYTES) };
    if (item.text !== segment.text) this.state.transcriptTruncated = true;
    const itemBytes = Buffer.byteLength(JSON.stringify(item));
    if (itemBytes > MAX_SEGMENT_BYTES + 2048) { this.state.transcriptTruncated = true; this.emit(); return; }
    if (!item.text.trim()) return;
    if (i >= 0) {
      const previous = this.state.transcripts[i];
      if (previous.isFinal && (!item.isFinal || previous.text === item.text || previous.receivedAt > item.receivedAt)) return;
      this.state.transcripts[i] = item;
    } else this.state.transcripts.push(item);
    let bytes = this.state.transcripts.reduce((n, x) => n + Buffer.byteLength(JSON.stringify(x)), 0);
    while (this.state.transcripts.length > 500 || bytes > MAX_TRANSCRIPT_BYTES) {
      const removed = this.state.transcripts.shift()!;
      bytes -= Buffer.byteLength(JSON.stringify(removed));
      this.state.transcriptTruncated = true;
    }
    this.emit();
  }
  async start(): Promise<LiveResult> {
    if (this.closed) return { success: false, error: "会话服务已关闭。" };
    if (!this.deps.support.supported) return { success: false, error: this.deps.support.message };
    if (this.capture || this.starting || this.control) return { success: false, error: "请先结束当前采集会话。" };
    this.cancelAnswer();
    this.cancelClear();
    this.state = this.empty();
    this.captureEpoch = 0;
    this.state.captureStatus = "starting";
    this.emit(true);
    const sessionId = this.state.sessionId, generation = ++this.generation;
    const profileId = this.state.transcription!.id;
    const controller = new AbortController();
    this.starting = controller;
    const current = () => sessionId === this.state.sessionId && generation === this.generation && !controller.signal.aborted;
    try {
      const upload = await this.deps.createUpload(sessionId, controller.signal, profileId);
      controller.signal.throwIfAborted();
      if (!current()) return { success: false, error: "启动已取消。" };
      // Older English-only servers may omit this field. Never let a requested
      // Chinese profile silently become a different transcription session.
      if (upload.transcriptionProfile !== profileId &&
          !(profileId === DEFAULT_TRANSCRIPTION_PROFILE && upload.transcriptionProfile === undefined)) {
        throw new Error("转录配置与请求不一致，请检查服务器设置后重试。");
      }
      const capture = this.deps.createCapture({
        onTranscript: segment => { if (current()) this.receive(segment); },
        onState: status => {
          if (!current()) return;
          this.state.captureStatus = status;
          if (status === "recording" && !this.state.startedAt) this.state.startedAt = Date.now();
          if (status === "ended") this.state.endedAt = Date.now();
          this.emit(true);
        },
        onError: error => { if (current()) { this.state.error = error; this.state.captureStatus = "error"; this.emit(true); } },
      });
      this.capture = capture;
      this.state.captureNeedsCleanup = true;
      await capture.start(upload);
      if (!current()) return { success: false, error: "启动已取消。" };
      return { success: true };
    } catch (error) {
      if (current()) { this.state.captureStatus = "error"; this.state.error = message(error); this.emit(true); }
      return { success: false, error: controller.signal.aborted ? "启动已取消。" : message(error) };
    } finally { if (this.starting === controller) this.starting = null; }
  }
  private change(action: "pause" | "resume" | "stop"): Promise<LiveResult> {
    if (this.control) return Promise.resolve({ success: false, error: "上一项采集操作尚未结束。" });
    const task = this.perform(action);
    this.control = task;
    void task.finally(() => { if (this.control === task) this.control = null; });
    return task;
  }
  pause(): Promise<LiveResult> { return this.change("pause"); }
  resume(): Promise<LiveResult> { return this.change("resume"); }
  stop(): Promise<LiveResult> { return this.change("stop"); }
  private async perform(action: "pause" | "resume" | "stop"): Promise<LiveResult> {
    if (action === "stop" && this.starting) this.starting.abort();
    const capture = this.capture;
    if (!capture) {
      if (action !== "stop") return { success: false, error: "当前没有音频采集。" };
      ++this.generation;
      this.state.captureStatus = "ended"; this.state.endedAt = Date.now(); this.emit(true);
      return { success: true };
    }
    if (action === "pause" && this.state.captureStatus !== "recording") return { success: false, error: "仅录制中可以暂停。" };
    if (action === "resume" && this.state.captureStatus !== "paused") return { success: false, error: "当前采集没有暂停。" };
    // Set the barrier before resume can synchronously deliver new transcript.
    // A failed resume attempt remains a conservative presentation boundary.
    if (action === "resume") this.captureEpoch++;
    this.state.captureStatus = action === "pause" ? "pausing" : action === "resume" ? "resuming" : "stopping";
    this.emit(true);
    try {
      if (action === "stop") {
        // Even a rejected start can leave a prepared native source. Shutdown
        // must still be attempted when a stop event can no longer arrive.
        await capture.stop().catch(() => undefined);
        await capture.dispose();
        if (this.capture === capture) this.capture = null;
        this.state.captureNeedsCleanup = false;
        ++this.generation;
        this.state.captureStatus = "ended"; this.state.endedAt = Date.now();
      } else {
        await capture[action]();
        this.state.captureStatus = action === "pause" ? "paused" : "recording";
      }
      this.state.error = undefined; this.emit(true);
      return { success: true };
    } catch (error) {
      // Retain capture ownership after failed cleanup; stop can be retried.
      this.state.captureStatus = "error"; this.state.error = message(error); this.emit(true);
      return { success: false, error: message(error) };
    }
  }
  async ask(input: LiveAskInput): Promise<LiveResult> {
    if (this.closed) return { success: false, error: "会话服务已关闭。" };
    if (this.clearing) return { success: false, error: "正在清理当前对话，请稍后再试。" };
    if (this.answer) return { success: false, error: "请等待当前回答或先停止生成。" };
    if (!input || typeof input.question !== "string" || typeof input.includeScreenshots !== "boolean") return { success: false, error: "无效的问题参数。" };
    if (input.includeScreenshots && this.pendingConsumption) return { success: false, error: "截图正在移至废纸篓，请稍后再试。" };
    const question = input.question.trim();
    if (Buffer.byteLength(question) > 16 * 1024) return { success: false, error: "问题超过 16 KB，请缩短后重试。" };
    const transcripts = structuredClone(this.state.transcripts), answers = structuredClone(this.state.answers);
    const screenshotPaths = input.includeScreenshots ? [...this.deps.pendingScreenshots()] : [];
    if (screenshotPaths.length > MAX_SCREENSHOTS) return { success: false, error: `一次最多使用 ${MAX_SCREENSHOTS} 张截图。` };
    if (!question && !input.includeScreenshots && !transcripts.some(x => x.isFinal)) return { success: false, error: "请先提供问题、截图或最终转录。" };
    const controller = new AbortController(); this.answer = controller;
    const answer: LiveAnswer = { id: randomUUID(), question: question || "根据当前对话和截图回答", text: "", model: "", status: "preparing", createdAt: Date.now(), screenshotCount: 0 };
    this.state.answers.push(answer);
    while (this.state.answers.length > 12) this.state.answers.shift();
    const sessionId = this.state.sessionId;
    this.emit(true);
    void this.generate(answer, sessionId, controller, { question, transcripts, answers, screenshotPaths });
    return { success: true, requestId: answer.id };
  }
  private trimAnswers(): void {
    while (this.state.answers.length > 1 && this.state.answers.reduce((n, x) => n + Buffer.byteLength(x.text), 0) > 512 * 1024) this.state.answers.shift();
  }
  private consume(paths: readonly string[], signal: AbortSignal): Promise<LiveResult> {
    const task = Promise.resolve().then(() => this.deps.consumeScreenshots(paths, signal)).catch(error => ({ success: false, error: message(error) }));
    this.pendingConsumption = task;
    void task.finally(() => { if (this.pendingConsumption === task) this.pendingConsumption = null; });
    return task;
  }
  private async generate(answer: LiveAnswer, sessionId: string, controller: AbortController, context: { question: string; transcripts: TranscriptSegment[]; answers: LiveAnswer[]; screenshotPaths: string[] }): Promise<void> {
    const current = () => this.answer === controller && this.state.sessionId === sessionId;
    let consumption: Promise<LiveResult> | undefined;
    const submitted = () => {
      if (!consumption && context.screenshotPaths.length && current() && !controller.signal.aborted) {
        consumption = this.consume(context.screenshotPaths, controller.signal).then(result => {
          if (current() && !controller.signal.aborted) {
            answer.screenshotCleanupError = result.success ? undefined : result.error || "部分截图未能移至废纸篓，仍保留在待提交队列。";
            this.state.screenshotError = answer.screenshotCleanupError;
            this.emit(true);
          }
          return result;
        });
      }
      return consumption;
    };
    try {
      const images = context.screenshotPaths.length ? await this.deps.images(context.screenshotPaths, controller.signal) : [];
      controller.signal.throwIfAborted();
      if (!current()) return;
      if (images.length !== context.screenshotPaths.length) throw new Error("截图快照处理不完整，待提交截图已保留。请重试。");
      if (!context.question && !images.length && !context.transcripts.some(x => x.isFinal)) throw new Error("没有可用的截图、问题或最终转录。");
      answer.screenshotCount = images.length;
      const built = buildConversationMessages({ ...context, images, responseLanguage: this.deps.language() });
      if (Buffer.byteLength(JSON.stringify(built.messages)) > 11 * 1024 * 1024) throw new Error("上下文超过传输限制，请减少截图或问题长度。");
      answer.contextTruncated = built.truncated || this.state.transcriptTruncated;
      const completion = await this.deps.stream(built.messages, controller.signal, (text, model) => {
        if (!current() || controller.signal.aborted) return;
        if (Buffer.byteLength(text) > MAX_ANSWER_BYTES) { controller.abort(new Error("回答超过 128 KB，已停止。")); return; }
        answer.text = text; answer.model = model; answer.status = "streaming"; this.trimAnswers(); this.emit();
        if (text) submitted();
      });
      // A real content update or successful completion establishes submission.
      // Image preparation/network failures leave the pending snapshot available.
      await submitted();
      controller.signal.throwIfAborted();
      if (!current()) return;
      const finalText = completion.choices[0]?.message?.content || answer.text;
      if (Buffer.byteLength(finalText) > MAX_ANSWER_BYTES) {
        answer.text = limitedText(finalText, MAX_ANSWER_BYTES);
        throw new Error("回答超过 128 KB，内容未完整保留。");
      }
      answer.text = finalText;
      answer.model = completion.model; answer.status = "completed";
      this.trimAnswers();
    } catch (error) {
      if (consumption) await consumption;
      if (!current()) return;
      answer.status = controller.signal.aborted || (error instanceof Error && error.name === "AbortError") ? "cancelled" : "error";
      answer.error = message(error);
    } finally { if (current()) { this.answer = null; this.emit(true); } }
  }
  cancelAnswer(): LiveResult {
    if (this.answer) {
      this.answer.abort(new Error("已停止生成。")); this.answer = null;
      const answer = this.state.answers.find(x => x.status === "preparing" || x.status === "streaming");
      if (answer) { answer.status = "cancelled"; answer.error = "已停止生成，保留已有内容。"; }
      this.emit(true);
    }
    return { success: true };
  }
  clearAnswers(): LiveResult { this.cancelAnswer(); this.state.answers = []; this.emit(true); return { success: true }; }
  private cancelClear(): void { this.clearing?.abort(new Error("清理已取消。")); this.clearing = null; }
  async startOver(): Promise<LiveResult> {
    if (this.closed) return { success: false, error: "会话服务已关闭。" };
    if (this.clearing) return { success: false, error: "正在清理当前对话，请稍后再试。" };
    this.cancelAnswer();
    const sessionId = this.state.sessionId;
    const paths = [...this.deps.pendingScreenshots()];
    const preserveTranscripts = !!this.starting || !!this.control || ["starting", "recording", "pausing", "paused", "resuming", "stopping"].includes(this.state.captureStatus);
    const controller = new AbortController(); this.clearing = controller;
    const current = () => this.clearing === controller && this.state.sessionId === sessionId && !controller.signal.aborted;
    try {
      // Join an already-submitted answer's cleanup before retrying the exact snapshot.
      if (this.pendingConsumption) await this.pendingConsumption;
      if (!current()) return { success: false, error: "清理已取消。" };
      const stillPending = new Set(this.deps.pendingScreenshots());
      const remainingPaths = paths.filter(filePath => stillPending.has(filePath));
      const result = remainingPaths.length ? await this.consume(remainingPaths, controller.signal) : { success: true };
      if (!current()) return { success: false, error: "清理已取消。" };
      if (!result.success) {
        this.state.screenshotError = result.error || "部分截图未能移至废纸篓，仍保留在待提交队列。";
        this.emit(true);
        return { success: false, error: this.state.screenshotError };
      }
      if (preserveTranscripts) { this.state.answers = []; this.state.screenshotError = undefined; }
      else {
        const previous = this.state;
        ++this.generation;
        this.state = this.empty();
        this.state.sessionId = previous.sessionId;
        this.state.transcription = previous.transcription;
        // Clearing conversational context must not release a failed native owner.
        if (previous.captureNeedsCleanup) {
          this.state.captureStatus = previous.captureStatus;
          this.state.captureNeedsCleanup = true;
          this.state.error = previous.error;
          this.state.startedAt = previous.startedAt; this.state.endedAt = previous.endedAt;
        }
      }
      this.emit(true);
      return { success: true };
    } catch (error) {
      if (!current()) return { success: false, error: "清理已取消。" };
      this.state.screenshotError = message(error); this.emit(true);
      return { success: false, error: message(error) };
    } finally { if (this.clearing === controller) this.clearing = null; }
  }
  async reset(): Promise<LiveResult> {
    this.cancelAnswer();
    this.cancelClear();
    if (this.control) await this.control;
    const result = await this.stop();
    if (result.success) { this.state = this.empty(); this.emit(true); }
    return result;
  }
  async dispose(): Promise<void> {
    this.closed = true;
    try {
      this.cancelAnswer(); this.starting?.abort();
      this.cancelClear();
      if (this.control) await this.control;
      const result = await this.stop();
      if (!result.success) throw new Error(result.error);
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    } catch (error) { this.closed = false; throw error; }
  }
}
