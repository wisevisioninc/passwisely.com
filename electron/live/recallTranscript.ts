import { createHash } from "node:crypto";
import type { AudioSource, TranscriptSegment } from "./types";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined;
const string = (value: unknown): string | undefined => typeof value === "string" && /\S/.test(value) ? value : undefined;
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const MAX_WORDS = 1024;
const MAX_TEXT = 16_384;
const MAX_SPEAKER = 120;
function display(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let end = limit - 1;
  if (value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--;
  return `${value.slice(0, end)}…`;
}
const relativeMs = (value: unknown): number | undefined => {
  const seconds = object(value)?.relative;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
};

function sourceOf(envelope: ObjectValue, data: ObjectValue, participant: ObjectValue): AudioSource {
  const explicit = string(envelope.source) || string(data.source);
  if (explicit && explicit.length <= 64) {
    const value = explicit.toLowerCase();
    if (["microphone", "mic", "local", "input", "host"].includes(value)) return "microphone";
    if (["system", "system_audio", "system-audio", "speaker", "remote", "output", "guest"].includes(value)) return "system";
    if (value === "unknown") return "unknown";
  }
  if (participant.is_host === true) return "microphone";
  if (participant.is_host === false) return "system";
  if (participant.name === "Host") return "microphone";
  if (participant.name === "Guest") return "system";
  return "unknown";
}

/** One normalizer belongs to one prepared SDK source. Never share speaker state. */
export function createRecallTranscriptNormalizer() {
  let sequence = 0;
  const active = new Map<string, { id: string; identity?: string }>();
  const finalized = new Map<string, { id: string; textHash: string; receivedAt: number }>();
  return {
    normalize(event: unknown, receivedAt = Date.now()): TranscriptSegment | null {
      const outer = object(event);
      if (outer?.event !== "transcript.data" && outer?.event !== "transcript.partial_data") return null;
      const envelope = object(outer.data);
      const data = object(envelope?.data);
      if (!envelope || !data || !Array.isArray(data.words)) return null;
      const words = data.words.slice(0, MAX_WORDS).map(object).filter((word): word is ObjectValue => Boolean(word));
      let text = "";
      let truncated = data.words.length > MAX_WORDS;
      for (const word of words) {
        if (typeof word.text !== "string" || !word.text) continue;
        if (text) text += " ";
        const available = Math.max(0, MAX_TEXT - text.length);
        text += word.text.slice(0, available);
        if (word.text.length > available) { truncated = true; break; }
      }
      text = text.trim();
      if (!text) return null;
      if (truncated) text = display(`${text}…`, MAX_TEXT);
      const textHash = digest(text);
      const participant = object(data.participant) || {};
      const source = sourceOf(envelope, data, participant);
      const rawSpeaker = string(participant.name);
      const speaker = rawSpeaker ? display(rawSpeaker, MAX_SPEAKER) : undefined;
      const rawParticipantId = typeof participant.id === "number" && Number.isFinite(participant.id)
        ? String(participant.id) : string(participant.id);
      const participantId = rawParticipantId && rawParticipantId.length > 200 ? `sha256:${digest(rawParticipantId)}` : rawParticipantId;
      const starts = words.map(word => relativeMs(word.start_timestamp)).filter((v): v is number => v !== undefined);
      const ends = words.map(word => relativeMs(word.end_timestamp)).filter((v): v is number => v !== undefined);
      const startMs = starts.length ? starts.reduce((a, b) => Math.min(a, b)) : undefined;
      const endMs = ends.length ? ends.reduce((a, b) => Math.max(a, b)) : undefined;
      // Use original identity hashes, never truncated display names, for grouping.
      const channel = JSON.stringify([source, rawParticipantId ? ["id", digest(rawParticipantId)] : rawSpeaker ? ["name", digest(rawSpeaker)] : null]);
      // transcript.id is an artifact ID, not an utterance ID. Do not use it here.
      const utterance = string(data.utterance_id) || string(data.utteranceId) || string(envelope.utterance_id);
      const identity = utterance ? `utterance:${digest(utterance)}` : startMs !== undefined ? `start:${startMs}` : undefined;
      const partial = active.get(channel);
      const compatible = partial && (!identity || !partial.identity || partial.identity === identity) ? partial : undefined;
      const key = JSON.stringify([channel, identity || `text:${textHash}`]);
      const previous = finalized.get(key);
      const isFinal = outer.event === "transcript.data";
      // Without utterance IDs/timestamps, only suppress immediate duplicate finals.
      const duplicate = previous && (identity || !compatible && receivedAt - previous.receivedAt < 2000);
      if (!isFinal && duplicate) return null;
      if (duplicate && previous.textHash === textHash) {
        if (isFinal) active.delete(channel);
        return null;
      }
      const id = compatible?.id || (duplicate ? previous.id : undefined) || `recall-${++sequence}`;
      if (isFinal) {
        active.delete(channel);
        finalized.set(key, { id, textHash, receivedAt });
        // Bound deduplication history; older utterances remain in the session owner.
        if (finalized.size > 2048) finalized.delete(finalized.keys().next().value as string);
      } else {
        active.set(channel, { id, identity: identity || compatible?.identity });
        if (active.size > 256) active.delete(active.keys().next().value as string);
      }
      return { id, text, source, speaker, participantId, isFinal, receivedAt, startMs, endMs };
    },
  };
}
