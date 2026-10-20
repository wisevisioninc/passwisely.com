/** Public, credential-free transcription contract shared by desktop and token service.
 * Recall V2 remains the capture transport for every profile. Engine choices are
 * fixed here; callers cannot supply arbitrary model options or upstream origins.
 */
export type TranscriptionProfileId = "recall-en" | "deepgram-zh" | "recall-zh";
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
  { id: "deepgram-zh", label: "中文 · Deepgram 实时", language: "zh", provider: "deepgram", latency: "realtime" },
  { id: "recall-zh", label: "中文 · Recall 内置（分钟级，实验）", language: "zh", provider: "recall", latency: "delayed" },
];

export function getTranscriptionProfile(value: unknown): TranscriptionProfile | null {
  const profile = TRANSCRIPTION_PROFILES.find(item => item.id === value);
  return profile ? { ...profile } : null;
}

export function createTranscriptionProvider(id: TranscriptionProfileId) {
  switch (id) {
    case "recall-en": return { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } };
    case "deepgram-zh": return { deepgram_streaming: { model: "nova-3", language: "zh", interim_results: true, punctuate: true } };
    // Recall's generic docs permit this, while Desktop-specific docs still
    // state low-latency-only. Treat acceptance/real output as runtime evidence.
    case "recall-zh": return { recallai_streaming: { mode: "prioritize_accuracy", language_code: "zh" } };
    default: throw new Error("Unsupported transcription profile.");
  }
}
