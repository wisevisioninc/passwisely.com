import { env } from "cloudflare:workers";
import { createDeepgramOptions, getDeepgramTranscriptionProfile } from "../../electron/live/transcription";
import type { DeepgramTranscriptionProfileId } from "../../electron/live/transcription";
import type { NativeCaptureSession } from "../../shared/captureSession";
export type { NativeCaptureSession } from "../../shared/captureSession";

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const WS_URL = "wss://api.deepgram.com/v1/listen";
const TOKEN_TTL_SECONDS = 30;
const CACHE_TTL_MS = 5_000;
const CONNECT_MARGIN_MS = 5_000;
const CREATE_INTERVAL_MS = 5_000;
const MAX_SESSIONS = 256;
const MAX_PENDING = 8;
const MAX_RESPONSE_BYTES = 16 * 1024;

export class DeepgramTokenError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "DeepgramTokenError";
  }
}

export function normalizeDeepgramSessionId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}

interface SessionEntry {
  userId: string;
  profile: DeepgramTranscriptionProfileId;
  credentialIdentity: string;
  createdAt: number;
  expiresAt: number;
  pending: boolean;
  result: Promise<NativeCaptureSession>;
}
// Process-local retry deduplication, not a durable quota or active-session limit.
// Pending grants keep ownership until the upstream request settles.
const sessions = new Map<string, SessionEntry>();

function configuration(): string {
  const value: unknown = (env as unknown as Record<string, unknown>).DEEPGRAM_API_KEY;
  if (typeof value !== "string" || !value.trim()) {
    throw new DeepgramTokenError(503, "DEEPGRAM_NOT_CONFIGURED", "Real-time audio needs a server-side Deepgram API key. Contact the administrator.");
  }
  return value.trim();
}

async function readGrant(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("Missing grant response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Grant response limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid grant response");
  return value as Record<string, unknown>;
}

function expiry(payload: Record<string, unknown>, apiKey: string, startedAt: number): { token: string; expiresAt: number } {
  const token = payload.access_token;
  // The grant endpoint returns a JWT, never an API key. Inspect only its expiry;
  // authenticity belongs to the fixed HTTPS upstream and Deepgram's handshake.
  if (typeof token !== "string" || token.length > 8_192 || token === apiKey ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid temporary JWT");
  const encoded = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
  const claims: unknown = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
  const exp = claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>).exp : undefined;
  const ttl = payload.expires_in === undefined ? TOKEN_TTL_SECONDS : payload.expires_in;
  if (typeof exp !== "number" || !Number.isSafeInteger(exp) ||
      typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0 || ttl > TOKEN_TTL_SECONDS ||
      exp * 1000 > startedAt + 60_000) throw new Error("Invalid temporary JWT expiry");
  // Starting the clock before fetch is conservative about upstream latency.
  const expiresAt = Math.min(exp * 1000, startedAt + ttl * 1000);
  if (expiresAt <= Date.now() + CONNECT_MARGIN_MS) throw new Error("Temporary JWT expires too soon");
  return { token, expiresAt };
}

async function requestGrant(apiKey: string, profile: DeepgramTranscriptionProfileId): Promise<NativeCaptureSession> {
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await fetch(GRANT_URL, {
      method: "POST", redirect: "manual", signal,
      headers: { authorization: `Token ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) {
        throw new DeepgramTokenError(503, "DEEPGRAM_CREDENTIALS_INVALID", "Deepgram rejected the server credentials. The grant API requires a key with Member or higher permissions. Contact the administrator.");
      }
      throw new DeepgramTokenError(502, "DEEPGRAM_UPSTREAM_ERROR", "Deepgram could not prepare real-time transcription. Please try again later.");
    }
    const { token, expiresAt } = expiry(await readGrant(response), apiKey, startedAt);
    const options = createDeepgramOptions(profile);
    return { kind: "native-deepgram", accessToken: token, expiresAt, transcriptionProfile: profile,
      language: options.language, model: options.model, wsUrl: WS_URL };
  } catch (error) {
    if (error instanceof DeepgramTokenError) throw error;
    // Do not expose upstream bodies, tokens, keys or exception messages.
    if (signal.aborted || error instanceof Error && error.name === "TimeoutError") {
      throw new DeepgramTokenError(504, "DEEPGRAM_TIMEOUT", "Deepgram did not prepare real-time transcription in time. Please try again later.");
    }
    throw new DeepgramTokenError(502, "DEEPGRAM_UPSTREAM_ERROR", "Deepgram could not prepare real-time transcription. Please try again later.");
  }
}

/** Grants usage::write for core voice APIs, not management access. Deepgram does
 * not offer STT/model/session-only restrictions on this JWT. The fixed client
 * contract selects STT; an upstream-enforced quota would require a proxy.
 */
export async function createDeepgramSession(userId: string, sessionId: string, profileInput: unknown): Promise<NativeCaptureSession> {
  const normalized = normalizeDeepgramSessionId(sessionId);
  if (!userId || !normalized) throw new DeepgramTokenError(400, "INVALID_SESSION_ID", "A valid sessionId UUID is required.");
  const profile = getDeepgramTranscriptionProfile(profileInput);
  if (!profile) throw new DeepgramTokenError(400, "INVALID_TRANSCRIPTION_PROFILE", "Choose deepgram-en or deepgram-zh for native audio.");
  const apiKey = configuration();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  const credentialIdentity = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  for (const [key, entry] of sessions) {
    if (!entry.pending && (entry.expiresAt <= now || entry.credentialIdentity !== credentialIdentity)) sessions.delete(key);
  }
  const key = JSON.stringify([userId, normalized]);
  const existing = sessions.get(key);
  if (existing) {
    if (existing.profile !== profile.id || existing.credentialIdentity !== credentialIdentity) {
      throw new DeepgramTokenError(409, "DEEPGRAM_SESSION_CONFIG_MISMATCH", "This pending audio session belongs to a different transcription configuration. Try again after it finishes or start a new session.");
    }
    return existing.result;
  }
  let pending = 0;
  for (const entry of sessions.values()) {
    if (entry.pending) pending++;
    if (entry.userId === userId && (entry.pending || now - entry.createdAt < CREATE_INTERVAL_MS)) {
      throw new DeepgramTokenError(429, "DEEPGRAM_SESSION_THROTTLED", "Please wait a few seconds before preparing another audio connection.");
    }
  }
  if (pending >= MAX_PENDING || sessions.size >= MAX_SESSIONS) {
    throw new DeepgramTokenError(429, "DEEPGRAM_SESSION_CAPACITY", "Audio session creation is busy. Please try again later.");
  }
  const result = requestGrant(apiKey, profile.id).then(result => {
    entry.expiresAt = Math.min(Date.now() + CACHE_TTL_MS, result.expiresAt - CONNECT_MARGIN_MS);
    return result;
  }, error => {
    entry.expiresAt = Date.now() + CACHE_TTL_MS;
    throw error;
  }).finally(() => { entry.pending = false; });
  const entry: SessionEntry = { userId, profile: profile.id, credentialIdentity, createdAt: now,
    expiresAt: now + CACHE_TTL_MS, pending: true, result };
  sessions.set(key, entry);
  return result;
}
