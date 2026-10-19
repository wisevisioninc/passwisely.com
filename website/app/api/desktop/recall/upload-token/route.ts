import { getApiUser } from "@/lib/auth";
import { createRecallUpload, normalizeRecallSessionId, RecallUploadError } from "@/lib/recall";

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: { "cache-control": "no-store", vary: "Authorization, Cookie" } });
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getApiUser(request);
    if (!user) return json({ error: "Authentication required.", code: "UNAUTHORIZED" }, 401);
    if (Number(request.headers.get("content-length")) > 1024) {
      return json({ error: "The session request is too large.", code: "INVALID_SESSION_REQUEST" }, 413);
    }
    let body: unknown;
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "A valid sessionId UUID is required.", code: "INVALID_SESSION_ID" }, 400);
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          return json({ error: "The session request is too large.", code: "INVALID_SESSION_REQUEST" }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "A valid sessionId UUID is required.", code: "INVALID_SESSION_ID" }, 400);
    } finally { reader.releaseLock(); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "sessionId")) {
      return json({ error: "Only a sessionId UUID is accepted.", code: "INVALID_SESSION_REQUEST" }, 400);
    }
    const sessionId = normalizeRecallSessionId((body as Record<string, unknown>).sessionId);
    if (!sessionId) return json({ error: "A valid sessionId UUID is required.", code: "INVALID_SESSION_ID" }, 400);
    return json(await createRecallUpload(user.id, sessionId));
  } catch (error) {
    if (error instanceof RecallUploadError) return json({ error: error.message, code: error.code }, error.status);
    return json({ error: "Audio session creation is temporarily unavailable.", code: "RECALL_SESSION_UNAVAILABLE" }, 503);
  }
}
