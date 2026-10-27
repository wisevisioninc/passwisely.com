#!/usr/bin/env node
// File replay only. Never imports Electron, opens a microphone, or starts a helper.
import { createHash } from "node:crypto";
import { lstat, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createProductionTsLoader } from "../../../desktop-api/tests/helpers/production-typescript.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const WebSocket = require("ws");
const load = createProductionTsLoader({ env: {} });
const { createDeepgramOptions } = load(path.join(root, "electron/live/transcription.ts"));
const { createDeepgramTranscriptNormalizer } = load(path.join(root, "electron/live/DeepgramTranscript.ts"));
const fixed = { wsUrl: "wss://api.deepgram.com/v1/listen", sampleRate: 16000, channels: 1, sampleBytes: 2 };
const abort = new AbortController();
const deadline = setTimeout(() => abort.abort(new Error("SMOKE_DEADLINE")), 55_000);
const started = performance.now();
const states = [];
const timers = new Set();
const safe = code => Object.assign(new Error(code), { safeCode: code });
const elapsed = () => Math.round(performance.now() - started);
let authorization;
let publicSession;
let tokenPath;
let tokenOwned = false;
let output;

function argumentsFrom(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--token-file", "--system-wav", "--microphone-wav", "--output"].includes(argv[i]) || !argv[i + 1] || values[argv[i]]) throw safe("INVALID_ARGUMENTS");
    values[argv[i]] = path.resolve(argv[i + 1]);
  }
  if (Object.keys(values).length !== 4) throw safe("INVALID_ARGUMENTS");
  return values;
}
async function privateAuthorization(filename) {
  const parent = await lstat(path.dirname(filename)), file = await lstat(filename);
  if (!parent.isDirectory() || parent.isSymbolicLink() || !file.isFile() || file.isSymbolicLink() ||
      parent.uid !== process.getuid() || file.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700 ||
      (file.mode & 0o777) !== 0o600 || file.size > 16 * 1024) throw safe("TOKEN_FILE_NOT_PRIVATE");
  tokenOwned = true;
  const text = await readFile(filename, "utf8");
  await unlink(filename); // Credential persists only in process memory from here.
  const value = JSON.parse(text);
  if (value?.kind !== "native-deepgram" || value.wsUrl !== fixed.wsUrl || value.model !== "nova-3" ||
      !["deepgram-en", "deepgram-zh"].includes(value.transcriptionProfile) ||
      value.language !== (value.transcriptionProfile === "deepgram-zh" ? "zh" : "en") ||
      typeof value.accessToken !== "string" || value.accessToken.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.accessToken) ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() + 1000 || value.expiresAt > Date.now() + 60_000) throw safe("TOKEN_CONTRACT_INVALID");
  return value;
}
async function wav(filename) {
  const file = await lstat(filename);
  if (!file.isFile() || file.size > 2 * 1024 * 1024) throw safe("WAV_FILE_INVALID");
  const bytes = await readFile(filename);
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE" || bytes.readUInt32LE(4) + 8 !== bytes.length) throw safe("WAV_HEADER_INVALID");
  let format, pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
    if (end > bytes.length) throw safe("WAV_CHUNK_INVALID");
    if (kind === "fmt ") { if (format || size < 16) throw safe("WAV_FORMAT_INVALID"); format = bytes.subarray(offset + 8, end); }
    if (kind === "data") { if (pcm) throw safe("WAV_DATA_INVALID"); pcm = bytes.subarray(offset + 8, end); }
    offset = end + (size % 2);
  }
  if (!format || !pcm?.length || pcm.length % 2 || format.readUInt16LE(0) !== 1 || format.readUInt16LE(2) !== 1 ||
      format.readUInt32LE(4) !== 16000 || format.readUInt32LE(8) !== 32000 || format.readUInt16LE(12) !== 2 || format.readUInt16LE(14) !== 16) throw safe("WAV_MUST_BE_MONO_16K_S16LE");
  return { pcm, provenance: { file: path.basename(filename), sha256: createHash("sha256").update(bytes).digest("hex"), durationMs: Math.round(pcm.length / 32), sampleRate: 16000, channels: 1, bits: 16 } };
}
function delay(ms) {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); timers.delete(timer); reject(safe("SMOKE_ABORTED")); };
    const timer = setTimeout(() => { timers.delete(timer); abort.signal.removeEventListener("abort", cancel); resolve(); }, ms);
    timers.add(timer);
    abort.signal.addEventListener("abort", cancel, { once: true });
    if (abort.signal.aborted) cancel();
  });
}
function control(state, type) {
  return new Promise((resolve, reject) => {
    if (state.socket.readyState !== WebSocket.OPEN) return reject(safe("WSS_NOT_OPEN"));
    state.socket.send(JSON.stringify({ type }), { binary: false }, error => {
      if (error) reject(safe("CONTROL_SEND_FAILED"));
      else { state.report.controls[type] = (state.report.controls[type] || 0) + 1; resolve(); }
    });
  });
}
function connect(source, audio) {
  const options = createDeepgramOptions(authorization.transcriptionProfile);
  const url = new URL(fixed.wsUrl);
  for (const [key, value] of Object.entries({ ...options, encoding: "linear16", sample_rate: 16000, channels: 1 })) url.searchParams.set(key, String(value));
  const normalizer = createDeepgramTranscriptNormalizer(source);
  const state = { source, audio, normalizer, epoch: 0, epochs: new Map(), failure: null, closed: false, audioStarted: undefined,
    report: { route: `synthetic-${source}-route`, assignedSource: source, realCaptureVerified: false, input: audio.provenance,
      options: Object.fromEntries(url.searchParams), openedAtMs: null, closeCode: null, sentBytes: 0, audioFrames: 0,
      controls: {}, providerInterims: 0, providerFinals: 0, providerFinalWordTokens: 0, fromFinalizeResponses: 0,
      firstInterimMsFromAudioStart: null, firstFinalMsFromAudioStart: null, segments: [] } };
  states.push(state);
  const socket = new WebSocket(url.href, { headers: { Authorization: `Bearer ${authorization.accessToken}` },
    maxPayload: 64 * 1024, handshakeTimeout: 10_000, perMessageDeflate: false });
  state.socket = socket;
  state.opened = new Promise((resolve, reject) => {
    const fail = code => { state.failure ||= code; reject(safe(code)); };
    socket.once("open", () => { state.report.openedAtMs = elapsed(); resolve(); });
    socket.on("error", () => fail("WSS_ERROR"));
    socket.on("unexpected-response", (_request, response) => { response.resume(); fail(`WSS_HTTP_${response.statusCode}`); socket.terminate(); });
    socket.on("message", (data, binary) => {
      if (binary || data.length > 64 * 1024) { state.failure ||= "WSS_MESSAGE_INVALID"; return; }
      let value;
      try { value = JSON.parse(data.toString()); } catch { state.failure ||= "WSS_JSON_INVALID"; return; }
      if (value.type === "Error") { state.failure ||= "DEEPGRAM_ERROR"; return; }
      if (value.type !== "Results") return;
      if (value.from_finalize === true) state.report.fromFinalizeResponses++;
      const segment = normalizer.normalize(value);
      if (!segment) return;
      if (segment.isFinal) {
        state.report.providerFinals++;
        const words = value.channel?.alternatives?.[0]?.words;
        if (Array.isArray(words) && words.length < 10000) state.report.providerFinalWordTokens += words.length;
      } else state.report.providerInterims++;
      const key = segment.isFinal ? "firstFinalMsFromAudioStart" : "firstInterimMsFromAudioStart";
      if (state.report[key] === null && state.audioStarted !== undefined) state.report[key] = Math.round(performance.now() - state.audioStarted);
      if (!state.epochs.has(segment.id)) state.epochs.set(segment.id, state.epoch);
      state.report.segments.push({ route: state.report.route, ...segment, captureEpoch: state.epochs.get(segment.id), receivedAtRunMs: elapsed() });
      if (state.report.segments.length > 200) state.failure ||= "RESULT_LIMIT";
    });
    socket.on("close", code => { state.closed = true; state.report.closeCode = code; if (state.report.openedAtMs === null) fail("WSS_CLOSED_BEFORE_OPEN"); });
  });
  void state.opened.catch(() => {});
  return state;
}
function healthy(state) {
  abort.signal.throwIfAborted();
  if (state.failure) throw safe(state.failure);
  if (state.socket.readyState !== WebSocket.OPEN) throw safe("WSS_CLOSED_UNEXPECTEDLY");
}
async function replay(state) {
  if (state.audioStarted === undefined) state.audioStarted = performance.now();
  const start = performance.now(), frameBytes = 640;
  for (let offset = 0; offset < state.audio.pcm.length; offset += frameBytes) {
    healthy(state);
    const wait = start + offset / 32 - performance.now();
    if (wait > 0) await delay(wait);
    healthy(state);
    if (state.socket.bufferedAmount > 128000) throw safe("WSS_BACKPRESSURE");
    const chunk = state.audio.pcm.subarray(offset, offset + frameBytes);
    await new Promise((resolve, reject) => state.socket.send(chunk, { binary: true }, error => error ? reject(safe("AUDIO_SEND_FAILED")) : resolve()));
    state.report.sentBytes += chunk.length; state.report.audioFrames++;
  }
  state.report.lastAudioSentAtMs = elapsed();
}
async function untilClosed(state) {
  for (let i = 0; i < 100 && !state.closed; i++) await delay(50);
  if (!state.closed || state.report.closeCode !== 1000) throw safe("CLOSE_NOT_CONFIRMED");
}
let status = "failed", failureCode;
try {
  const args = argumentsFrom(process.argv.slice(2));
  tokenPath = args["--token-file"]; output = args["--output"];
  if (require("ws/package.json").version !== "8.22.0") throw safe("WS_VERSION_UNEXPECTED");
  const [system, microphone] = await Promise.all([wav(args["--system-wav"]), wav(args["--microphone-wav"])]);
  authorization = await privateAuthorization(tokenPath);
  publicSession = { transcriptionProfile: authorization.transcriptionProfile, language: authorization.language, model: authorization.model };
  const channels = [connect("system", system), connect("microphone", microphone)];
  await Promise.all(channels.map(state => state.opened));
  await Promise.all(channels.map(replay));
  await Promise.all(channels.map(state => control(state, "Finalize")));
  const pausedAtMs = elapsed(), bytesBeforePause = channels.map(state => state.report.sentBytes);
  for (let interval = 0; interval < 4; interval++) {
    await Promise.all(channels.map(state => control(state, "KeepAlive")));
    await delay(3000);
    channels.forEach(healthy);
  }
  channels.forEach((state, i) => {
    state.report.pause = { beganAtMs: pausedAtMs, elapsedMs: elapsed() - pausedAtMs, sentAudioBytes: state.report.sentBytes - bytesBeforePause[i], connectionStayedOpen: state.socket.readyState === WebSocket.OPEN };
    state.normalizer.beginCaptureEpoch(); state.epoch++;
  });
  await Promise.all(channels.map(replay));
  await Promise.all(channels.map(state => control(state, "Finalize")));
  await delay(2000);
  channels.forEach(healthy);
  await Promise.all(channels.map(state => control(state, "CloseStream")));
  await Promise.all(channels.map(untilClosed));
  for (const state of channels) {
    if (!state.report.providerInterims || !state.report.providerFinals || state.report.pause.sentAudioBytes !== 0 || !state.report.pause.connectionStayedOpen || state.failure) throw safe("REQUIRED_OBSERVATION_MISSING");
  }
  status = "passed";
} catch (error) {
  failureCode = error?.safeCode || (abort.signal.aborted ? "SMOKE_DEADLINE" : "SMOKE_FAILED");
} finally {
  clearTimeout(deadline);
  abort.abort(safe("CLEANUP"));
  for (const timer of timers) clearTimeout(timer);
  for (const state of states) if (!state.closed) state.socket.terminate();
  if (tokenPath && tokenOwned) await unlink(tokenPath).catch(() => {});
  authorization = undefined;
}
const report = { schemaVersion: 1, kind: "direct-deepgram-synthetic-file-replay", status, ...(failureCode ? { failureCode } : {}),
  createdAt: new Date().toISOString(), durationMs: elapsed(), endpoint: fixed.wsUrl, ...publicSession,
  limitations: ["No microphone capture, system-audio capture, native helper, Electron, permissions or packaged Intel binary was exercised.",
    "Source labels are assigned synthetic routes; they do not prove microphone/system hardware attribution.",
    "First-result timings start at initial PCM transmission and are observations for these fixtures, not service latency guarantees.",
    "providerFinalWordTokens counts provider word entries, not model billing tokens or distinct words."],
  routes: states.map(state => state.report) };
if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
process.stdout.write(JSON.stringify({ status, transcriptionProfile: report.transcriptionProfile, language: report.language, ...(failureCode ? { failureCode } : {}), durationMs: report.durationMs,
  routes: report.routes.map(route => ({ route: route.route, interims: route.providerInterims, finals: route.providerFinals, wordEntries: route.providerFinalWordTokens,
    pauseMs: route.pause?.elapsedMs, audioBytesDuringPause: route.pause?.sentAudioBytes, closeCode: route.closeCode })) }) + "\n");
process.exitCode = status === "passed" ? 0 : 1;
