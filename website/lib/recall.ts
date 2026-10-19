import { env } from "cloudflare:workers";

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

export interface RecallUpload {
  uploadToken: string;
  uploadId: string;
  apiUrl: string;
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

async function requestUpload(apiUrl: string, apiKey: string): Promise<RecallUpload> {
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
            provider: { recallai_streaming: { mode: "prioritize_low_latency", language_code: "en" } },
            diarization: { use_separate_streams_when_available: true },
          },
          realtime_endpoints: [{ type: "desktop_sdk_callback", events: ["transcript.data", "transcript.partial_data"] }],
        },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) {
        throw new RecallUploadError(503, "RECALL_CREDENTIALS_INVALID", "Recall rejected the server credentials. Contact the administrator.");
      }
      throw new RecallUploadError(502, "RECALL_UPSTREAM_ERROR", "Recall could not prepare an audio session. Please try a new session later.");
    }
    const payload = await readUpload(response);
    const uploadId = normalizeRecallSessionId(payload.id);
    if (!uploadId || typeof payload.upload_token !== "string" || !payload.upload_token.trim()) {
      throw new Error("Invalid upload response");
    }
    return { uploadId, uploadToken: payload.upload_token, apiUrl };
  } catch (error) {
    if (error instanceof RecallUploadError) throw error;
    // Neither upstream bodies nor exception messages are safe to send to clients.
    if (signal.aborted || (error instanceof Error && error.name === "TimeoutError")) {
      throw new RecallUploadError(504, "RECALL_TIMEOUT", "Recall did not prepare the audio session in time. Please try a new session later.");
    }
    throw new RecallUploadError(502, "RECALL_UPSTREAM_ERROR", "Recall could not prepare an audio session. Please try a new session later.");
  }
}

export function createRecallUpload(userId: string, sessionId: string): Promise<RecallUpload> {
  const normalized = normalizeRecallSessionId(sessionId);
  if (!userId || !normalized) throw new RecallUploadError(400, "INVALID_SESSION_ID", "A valid sessionId UUID is required.");
  const { apiUrl, apiKey } = configuration();
  const now = Date.now();
  for (const [key, entry] of sessions) {
    if (!entry.pending && entry.expiresAt <= now) sessions.delete(key);
  }
  const key = JSON.stringify([userId, normalized]);
  const existing = sessions.get(key);
  if (existing) return existing.result;

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
  const result = requestUpload(apiUrl, apiKey).finally(() => {
    const entry = sessions.get(key);
    if (entry) entry.pending = false;
  });
  sessions.set(key, { userId, createdAt: now, expiresAt: now + SESSION_TTL_MS, pending: true, result });
  return result;
}
