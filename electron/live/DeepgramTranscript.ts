import { createHash } from "node:crypto";
import type { TranscriptSegment } from "./types";

export type NativeAudioSource = "system" | "microphone";
type Row = { id: string; startMs: number; endMs: number };
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** One normalizer belongs to one mono Deepgram socket, whose source is supplied
 * by capture ownership, never guessed from provider text or speaker labels. */
export function createDeepgramTranscriptNormalizer(source: NativeAudioSource) {
  let sequence = 0;
  const active = new Map<string, Row>();
  const retired = new Map<string, Row>();
  const finalized = new Map<string, Row & { hash: string }>();
  const next = (startMs: number, endMs: number): Row => ({ id: `deepgram-${source}-${++sequence}`, startMs, endMs });
  const bound = <T>(values: Map<string, T>, size: number) => {
    while (values.size > size) values.delete(values.keys().next().value as string);
  };
  return {
    beginCaptureEpoch(): void {
      // Finalize was sent before resume. A late final for its old media range
      // still owns the retired row and cannot overwrite a new partial.
      for (const [key, row] of active) if (!retired.has(key)) retired.set(key, row);
      bound(retired, 256);
      active.clear();
    },
    normalize(input: unknown, receivedAt = Date.now()): TranscriptSegment | null {
      const value = object(input);
      if (value?.type !== "Results" || typeof value.is_final !== "boolean" ||
          typeof value.start !== "number" || !Number.isFinite(value.start) || value.start < 0 ||
          typeof value.duration !== "number" || !Number.isFinite(value.duration) || value.duration < 0) return null;
      const startMs = value.start * 1000, endMs = (value.start + value.duration) * 1000;
      if (!Number.isFinite(endMs) || endMs > Number.MAX_SAFE_INTEGER || !Number.isFinite(receivedAt)) return null;
      if (value.channel_index !== undefined && (!Array.isArray(value.channel_index) ||
          value.channel_index.length !== 2 || value.channel_index[0] !== 0 || value.channel_index[1] !== 1)) return null;
      const channel = object(value.channel);
      const alternative = Array.isArray(channel?.alternatives) ? object(channel.alternatives[0]) : null;
      if (typeof alternative?.transcript !== "string") return null;
      // Preserve text inside the transport bound. LiveSessionService owns the
      // smaller retained-text limit and its explicit truncation flag.
      const text = alternative.transcript.trim();
      if (!text || Buffer.byteLength(text) > 64 * 1024) return null;
      const key = String(startMs);
      const previous = finalized.get(key);
      if (!value.is_final && previous) return null;
      const hash = createHash("sha256").update(text).digest("hex");
      if (value.is_final && previous?.hash === hash && previous.endMs === endMs) return null;
      const row = previous || (value.is_final ? retired.get(key) : undefined) || active.get(key) || next(startMs, endMs);
      if (value.is_final) {
        finalized.set(key, { ...row, endMs, hash }); bound(finalized, 2048);
        retired.delete(key);
        if (active.get(key)?.id === row.id) active.delete(key);
      } else { active.set(key, { ...row, endMs }); bound(active, 256); }
      return { id: row.id, text, source, channelId: `native-pcm:${source}`, isFinal: value.is_final,
        receivedAt, startMs, endMs };
    },
  };
}
