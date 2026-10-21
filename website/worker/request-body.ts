// Matches the production Nginx client_max_body_size 16m ingress limit.
export const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;

type RequestBodyFailure =
  | { ok: false; status: 400; code: "INVALID_REQUEST_BODY" }
  | { ok: false; status: 413; code: "REQUEST_BODY_TOO_LARGE" };

export type StableRequestBodyResult =
  | { ok: true; request: Request }
  | RequestBodyFailure;

/** Finish network input before a framework can clone it or return a response. */
export async function stabilizeRequestBody(request: Request): Promise<StableRequestBodyResult> {
  if (request.method === "GET" || request.method === "HEAD" || !request.body) {
    return { ok: true, request };
  }
  if (request.bodyUsed) {
    return { ok: false, status: 400, code: "INVALID_REQUEST_BODY" };
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return { ok: false, status: 400, code: "INVALID_REQUEST_BODY" };
  }

  // A single growing buffer bounds retained storage independently of chunk count.
  let buffer = new Uint8Array(0);
  let size = 0;
  let failure: RequestBodyFailure | null = null;
  let stableBody: Blob | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        failure = { ok: false, status: 400, code: "INVALID_REQUEST_BODY" };
        break;
      }
      if (value.byteLength > MAX_REQUEST_BODY_BYTES - size) {
        failure = { ok: false, status: 413, code: "REQUEST_BODY_TOO_LARGE" };
        break;
      }
      const nextSize = size + value.byteLength;
      if (nextSize > buffer.byteLength) {
        const capacity = Math.min(MAX_REQUEST_BODY_BYTES, Math.max(1024, buffer.byteLength * 2, nextSize));
        const grown = new Uint8Array(capacity);
        grown.set(buffer.subarray(0, size));
        buffer = grown;
      }
      buffer.set(value, size);
      size = nextSize;
    }
    if (!failure) stableBody = new Blob([buffer.subarray(0, size)]);
  } catch {
    failure = { ok: false, status: 400, code: "INVALID_REQUEST_BODY" };
  } finally {
    if (failure) {
      try { await reader.cancel(); } catch { /* Keep the original fixed rejection. */ }
    }
    reader.releaseLock();
  }
  if (failure) return failure;

  try {
    return { ok: true, request: new Request(request, { body: stableBody }) };
  } catch {
    return { ok: false, status: 400, code: "INVALID_REQUEST_BODY" };
  }
}
