import { getTranscriptionProfile, TRANSCRIPTION_PROFILES } from "./transcription";
import type { TranscriptionProfile, TranscriptionProfileId, TranscriptionSettings } from "./transcription";

export type CaptureProvider = "recall-v2" | "native-deepgram";
export interface PublicTranscriptionSettings extends TranscriptionSettings {
  availableProfileIds: TranscriptionProfileId[];
  captureProvider: CaptureProvider;
}
const LEGACY_IDS: readonly TranscriptionProfileId[] = ["recall-en", "deepgram-zh", "recall-zh"];
const NATIVE_IDS: readonly TranscriptionProfileId[] = ["deepgram-en", "deepgram-zh"];
export function captureBackend(platform: string, architecture: string): CaptureProvider {
  return platform === "darwin" && architecture === "x64" ? "native-deepgram" : "recall-v2";
}
export function getAvailableTranscriptionProfiles(input: unknown): TranscriptionProfile[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const value = input as Record<string, unknown>;
  const ids = value.availableProfileIds === undefined ? LEGACY_IDS : value.availableProfileIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > TRANSCRIPTION_PROFILES.length || new Set(ids).size !== ids.length) return [];
  const profiles = Array.from(ids, getTranscriptionProfile);
  return profiles.every(Boolean) ? profiles as TranscriptionProfile[] : [];
}
export function parsePublicTranscriptionSettings(input: unknown): PublicTranscriptionSettings | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const profiles = getAvailableTranscriptionProfiles(input);
  const profile = profiles.find(p => p.id === value.profileId);
  const provider = value.captureProvider === undefined && value.availableProfileIds === undefined ? "recall-v2" : value.captureProvider;
  if (!profile || (provider !== "recall-v2" && provider !== "native-deepgram")) return null;
  if (provider === "native-deepgram" && profiles.some(p => !NATIVE_IDS.includes(p.id))) return null;
  return { profileId: profile.id, availableProfileIds: profiles.map(p => p.id), captureProvider: provider as CaptureProvider };
}
/** Resolve the effective, displayed choice without silently rewriting saved preferences. */
export function publicTranscriptionSettings(saved: TranscriptionSettings, provider: CaptureProvider): PublicTranscriptionSettings {
  const ids = provider === "native-deepgram" ? [...NATIVE_IDS] : TRANSCRIPTION_PROFILES.map(p => p.id);
  const requested = getTranscriptionProfile(saved.profileId);
  const profileId = requested && ids.includes(requested.id) ? requested.id
    : provider === "native-deepgram" && requested?.language === "zh" ? "deepgram-zh"
      : provider === "native-deepgram" ? "deepgram-en" : "recall-en";
  return { profileId, availableProfileIds: ids, captureProvider: provider };
}
