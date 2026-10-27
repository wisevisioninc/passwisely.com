/** Public, credential-free transcription contract shared by desktop and token service.
 * Capture transports share these fixed engine choices; callers cannot supply
 * arbitrary model options or upstream origins.
 */
import type { NativeTranscriptionProfileId, TranscriptionProfileId } from "../../shared/captureSession";
export type { TranscriptionProfileId } from "../../shared/captureSession";
export type DeepgramTranscriptionProfileId = NativeTranscriptionProfileId;
export interface TranscriptionProfile {
  id: TranscriptionProfileId;
  label: string;
  language: "en" | "zh";
  provider: "recall" | "deepgram";
  latency: "realtime" | "delayed";
}
export interface TranscriptionSettings { profileId: TranscriptionProfileId }

// Existing installations keep their verified English capture configuration.
export const DEFAULT_TRANSCRIPTION_PROFILE: TranscriptionProfileId = "recall-en";
export const TRANSCRIPTION_PROFILES: readonly Readonly<TranscriptionProfile>[] = [
  { id: "recall-en", label: "English · Recall 实时", language: "en", provider: "recall", latency: "realtime" },
  { id: "deepgram-en", label: "English · Deepgram 实时", language: "en", provider: "deepgram", latency: "realtime" },
  { id: "deepgram-zh", label: "中文 · Deepgram 实时", language: "zh", provider: "deepgram", latency: "realtime" },
  { id: "recall-zh", label: "中文 · Recall 内置（分钟级，实验）", language: "zh", provider: "recall", latency: "delayed" },
];

export function getTranscriptionProfile(value: unknown): TranscriptionProfile | null {
  const profile = TRANSCRIPTION_PROFILES.find(item => item.id === value);
  return profile ? { ...profile } : null;
}

export function getDeepgramTranscriptionProfile(value: unknown): (TranscriptionProfile & { id: DeepgramTranscriptionProfileId }) | null {
  const profile = getTranscriptionProfile(value);
  return profile?.id === "deepgram-en" || profile?.id === "deepgram-zh" ? { ...profile, id: profile.id } : null;
}

/** Provider options have one owner across Recall and native PCM transports. */
export function createDeepgramOptions(id: DeepgramTranscriptionProfileId) {
  const profile = getDeepgramTranscriptionProfile(id);
  if (!profile) throw new Error("Unsupported Deepgram transcription profile.");
  return { model: "nova-3" as const, language: profile.language, interim_results: true, punctuate: true, endpointing: 500 };
}

export function createTranscriptionProvider(id: TranscriptionProfileId) {
  switch (id) {
    case "recall-en": return { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } };
    case "deepgram-en":
    case "deepgram-zh": return { deepgram_streaming: createDeepgramOptions(id) };
    // Recall's generic docs permit this, while Desktop-specific docs still
    // state low-latency-only. Treat acceptance/real output as runtime evidence.
    case "recall-zh": return { recallai_streaming: { mode: "prioritize_accuracy", language_code: "zh" } };
    default: throw new Error("Unsupported transcription profile.");
  }
}
