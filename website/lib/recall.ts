import { env } from "cloudflare:workers";
import { createTranscriptionProvider, DEFAULT_TRANSCRIPTION_PROFILE, getTranscriptionProfile } from "../../electron/live/transcription";
import type { TranscriptionProfileId } from "../../electron/live/transcription";

const REGIONS = {
  "us-west-2": "https://us-west-2.recall.ai",
  "us-east-1": "https://us-east-1.recall.ai",
  "eu-central-1": "https://eu-central-1.recall.ai",
  "ap-northeast-1": "https://ap-northeast-1.recall.ai",
} as const;

const SESSION_TTL_MS = 60_000;
const CREATE_INTERVAL_MS = 5_000;
const MAX_SESSIONS = 256;
const MAX_PENDING = 8;
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEEPGRAM_CREDENTIALS_ERROR_PREFIX = "Unable to get temporary credentials for deepgram_streaming.";
// Bump when the recording/transcription semantics change, so a cached token
// cannot silently represent an older profile configuration in this process.
const PROFILE_CONFIGURATION_VERSION = 1;

export interface RecallUpload {
  uploadToken: string;
  uploadId: string;
  apiUrl: string;
  transcriptionProfile: TranscriptionProfileId;
}

export class RecallUploadError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RecallUploadError";
  }
}

export function normalizeRecallSessionId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

interface SessionEntry {
  userId: string;
  transcriptionProfile: TranscriptionProfileId;
  apiUrl: string;
  configurationVersion: number;
  configurationFingerprint: string;
  createdAt: number;
  expiresAt: number;
  pending: boolean;
  result: Promise<RecallUpload>;
}

// Short-lived, bounded process-local state. A restart or another worker does not
// share these entries. Never evict a live entry to admit a different session.
const sessions = new Map<string, SessionEntry>();

function configuration(): { apiUrl: string; apiKey: string } {
  const values = env as unknown as Record<string, string | undefined>;
  const apiKey = values.RECALL_API_KEY?.trim() || values.RECALLAI_API_KEY?.trim();
  if (!apiKey) {
    throw new RecallUploadError(503, "RECALL_NOT_CONFIGURED", "Real-time audio needs a server-side Recall API key. Contact the administrator.");
  }
  const region = values.RECALL_API_REGION?.trim() || "us-west-2";
  if (!Object.hasOwn(REGIONS, region)) {
    throw new RecallUploadError(503, "RECALL_REGION_INVALID", "The server Recall region is not supported.");
  }
  return { apiKey, apiUrl: REGIONS[region as keyof typeof REGIONS] };
}

async function readUpload(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("Missing response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error("Response limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response");
  return value as Record<string, unknown>;
}

function upstreamMessage(profile: TranscriptionProfileId, message: string): string {
  return profile === "deepgram-zh"
    ? `${message} For Chinese Deepgram transcription, ask the administrator to check the Recall project's default Deepgram transcription credentials and the selected language/model. This may also be a temporary upstream failure; no English fallback was used.`
    : message;
}

async function requestUpload(apiUrl: string, apiKey: string, profile: TranscriptionProfileId, provider: ReturnType<typeof createTranscriptionProvider>): Promise<RecallUpload> {
  const signal = AbortSignal.timeout(15_000);
  try {
    const response = await fetch(`${apiUrl}/api/v1/sdk_upload/`, {
      method: "POST",
      // Workerd supports follow/manual, but rejects redirect: "error" before
      // sending a request. Manual keeps credentials on the selected official
      // origin; the non-2xx check below rejects redirects without following.
      redirect: "manual",
      headers: { authorization: `Token ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      signal,
      body: JSON.stringify({
        recording_config: {
          video_mixed_mp4: null,
          audio_mixed_mp3: {},
          transcript: {
            provider,
            diarization: { use_separate_streams_when_available: true },
          },
          realtime_endpoints: [{ type: "desktop_sdk_callback", events: ["transcript.data", "transcript.partial_data"] }],
        },
      }),
    });
    if (!response.ok) {
      if (response.status === 400 && profile === "deepgram-zh") {
        // Only the observed provider-specific discriminator is actionable.
        // Parse with the existing byte limit; never expose or log its body.
        let errorPayload: Record<string, unknown> | undefined;
        try { errorPayload = await readUpload(response); } catch { /* Invalid or oversized errors keep the generic 502 below. */ }
        if (typeof errorPayload?.transcript === "string" && errorPayload.transcript.startsWith(DEEPGRAM_CREDENTIALS_ERROR_PREFIX)) {
          throw new RecallUploadError(503, "RECALL_DEEPGRAM_CREDENTIALS_UNAVAILABLE", "Recall could not obtain temporary Deepgram credentials. In the Recall transcription dashboard for the same workspace and region as the server's Recall API key, save the Deepgram API Key and matching Project ID and mark that credential as default. Use a Deepgram key with Member, Admin, or Owner access. Adding DEEPGRAM_API_KEY only to the server environment does not register it with Recall. After saving, start a new audio session.");
        }
      } else await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) {
        throw new RecallUploadError(503, "RECALL_CREDENTIALS_INVALID", "Recall rejected the server credentials. Contact the administrator.");
      }
      throw new RecallUploadError(502, "RECALL_UPSTREAM_ERROR", upstreamMessage(profile, "Recall could not prepare the selected audio session. Please try a new session later."));
    }
    const payload = await readUpload(response);
    const uploadId = normalizeRecallSessionId(payload.id);
    if (!uploadId || typeof payload.upload_token !== "string" || !payload.upload_token.trim()) {
      throw new Error("Invalid upload response");
    }
    return { uploadId, uploadToken: payload.upload_token, apiUrl, transcriptionProfile: profile };
  } catch (error) {
    if (error instanceof RecallUploadError) throw error;
    // Neither upstream bodies nor exception messages are safe to send to clients.
    if (signal.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new RecallUploadError(504, "RECALL_TIMEOUT", upstreamMessage(profile, "Recall did not prepare the audio session in time. Please try a new session later."));
    }
    throw new RecallUploadError(502, "RECALL_UPSTREAM_ERROR", upstreamMessage(profile, "Recall could not prepare the selected audio session. Please try a new session later."));
  }
}

export async function createRecallUpload(userId: string, sessionId: string, profileInput: unknown = DEFAULT_TRANSCRIPTION_PROFILE): Promise<RecallUpload> {
  const normalized = normalizeRecallSessionId(sessionId);
  if (!userId || !normalized) throw new RecallUploadError(400, "INVALID_SESSION_ID", "A valid sessionId UUID is required.");
  const profile = getTranscriptionProfile(profileInput);
  if (!profile) throw new RecallUploadError(400, "INVALID_TRANSCRIPTION_PROFILE", "Choose a supported transcriptionProfile.");
  const { apiUrl, apiKey } = configuration();
  const provider = createTranscriptionProvider(profile.id);
  // Fingerprint the exact selected settings once. Include credential identity:
  // rotating to another Recall project must not return an old project's token.
  // The raw key and canonical input are not retained in the session entry,
  // logged, or returned. Web Crypto is available in both Workers and Node.
  const identity = JSON.stringify([PROFILE_CONFIGURATION_VERSION, profile.id, apiUrl, provider, apiKey]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  for (const [key, entry] of sessions) {
    if (!entry.pending && entry.expiresAt <= now) sessions.delete(key);
  }
  const key = JSON.stringify([userId, normalized]);
  const existing = sessions.get(key);
  if (existing) {
    if (existing.configurationFingerprint !== fingerprint) throw new RecallUploadError(409, "RECALL_SESSION_CONFIG_MISMATCH", "This audio session already belongs to a different transcription configuration. Start a new session to change it.");
    return existing.result;
  }

  let pending = 0;
  for (const entry of sessions.values()) {
    if (entry.pending) pending++;
    if (entry.userId === userId && (entry.pending || now - entry.createdAt < CREATE_INTERVAL_MS)) {
      throw new RecallUploadError(429, "RECALL_SESSION_THROTTLED", "Please wait a few seconds before creating another audio session.");
    }
  }
  if (pending >= MAX_PENDING || sessions.size >= MAX_SESSIONS) {
    throw new RecallUploadError(429, "RECALL_SESSION_CAPACITY", "Audio session creation is busy. Please try again later.");
  }
  // Cache failures too: a timeout may still have created an upstream upload.
  const result = requestUpload(apiUrl, apiKey, profile.id, provider).finally(() => {
    const entry = sessions.get(key);
    if (entry) entry.pending = false;
  });
  sessions.set(key, { userId, transcriptionProfile: profile.id, apiUrl, configurationVersion: PROFILE_CONFIGURATION_VERSION, configurationFingerprint: fingerprint, createdAt: now, expiresAt: now + SESSION_TTL_MS, pending: true, result });
  return result;
}
