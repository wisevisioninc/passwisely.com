import { request as httpsRequest } from "node:https";

export const QWEN_TRANSPORT_PATH = "/internal/qwen/chat/completions";
export const QWEN_ORIGIN = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
export const CONNECT_TIMEOUT_MS = 20_000;
export const TOTAL_TIMEOUT_MS = 90_000;
const MAX_BYTES = 12 * 1024 * 1024;
const RETRYABLE = new Set(["QWEN_CONNECT_TIMEOUT", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ETIMEDOUT"]);

class TransportError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// requestImpl is injectable for deterministic socket lifecycle tests only.
export async function requestQwen(body, authorization, {
  signal,
  totalTimeoutMs = TOTAL_TIMEOUT_MS,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  maxAttempts = 3,
  requestImpl = httpsRequest,
} = {}) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(new TransportError(
    "QWEN_TOTAL_TIMEOUT", "Qwen request exceeded its total time budget.", 504,
  )), Math.min(totalTimeoutMs, TOTAL_TIMEOUT_MS));
  const cancel = () => controller.abort(new TransportError("QWEN_CANCELLED", "Qwen request was cancelled.", 499));
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timings = [];
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (controller.signal.aborted) throw controller.signal.reason;
      try {
        const result = await new Promise((resolve, reject) => {
          let req, socket, connectTimer, settled = false, connected = false;
          const attemptStart = performance.now();
          const timing = { attempt, connectMs: null };
          timings.push(timing);
          const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(connectTimer);
            socket?.removeListener("secureConnect", onConnected);
            controller.signal.removeEventListener("abort", abort);
            timing.elapsedMs = Math.round(performance.now() - attemptStart);
            if (error) {
              error.beforeConnect = !connected;
              timing.errorCode = error.code || "QWEN_NETWORK_ERROR";
              reject(error);
            } else resolve(value);
          };
          const abort = () => {
            const error = controller.signal.reason;
            req?.destroy(error);
            finish(error);
          };
          const onConnected = () => {
            connected = true;
            timing.connectMs = Math.round(performance.now() - attemptStart);
            clearTimeout(connectTimer);
          };
          connectTimer = setTimeout(() => {
            const error = new TransportError("QWEN_CONNECT_TIMEOUT", "Qwen connection timed out (DNS/TCP/TLS).", 504);
            req?.destroy(error);
            finish(error);
          }, Math.min(connectTimeoutMs, CONNECT_TIMEOUT_MS));
          controller.signal.addEventListener("abort", abort, { once: true });
          try {
            req = requestImpl(QWEN_ORIGIN, {
              method: "POST",
              headers: { authorization, "content-type": "application/json", "accept-encoding": "identity", "content-length": Buffer.byteLength(body) },
            }, response => {
              const chunks = [];
              let size = 0;
              response.on("data", chunk => {
                size += chunk.length;
                if (size > MAX_BYTES) {
                  const error = new TransportError("QWEN_RESPONSE_TOO_LARGE", "Qwen response is too large.");
                  req.destroy(error);
                  finish(error);
                } else chunks.push(chunk);
              });
              response.once("error", error => finish(error));
              response.once("aborted", () => finish(new TransportError("QWEN_RESPONSE_ABORTED", "Qwen closed an incomplete response.")));
              response.once("end", () => finish(null, { status: response.statusCode, body: Buffer.concat(chunks) }));
            });
            req.once("error", error => finish(error));
            req.once("socket", assigned => {
              socket = assigned;
              // Pooled TLS connections will not emit secureConnect again.
              if (req.reusedSocket) onConnected();
              else socket.once("secureConnect", onConnected);
            });
            req.end(body);
          } catch (error) { finish(error); }
        });
        return { ...result, attempts: timings, elapsedMs: Math.round(performance.now() - startedAt) };
      } catch (error) {
        // Never repeat a request after TLS connected: it may already be billed.
        // All pre-connect retries share the same total timer, including body read.
        if (controller.signal.aborted || !error.beforeConnect || !RETRYABLE.has(error.code) || attempt === maxAttempts) {
          const failure = error instanceof TransportError ? error : new TransportError("QWEN_NETWORK_ERROR", "Unable to complete the Qwen connection or response.");
          failure.attempts = timings;
          throw failure;
        }
      }
    }
  } finally {
    clearTimeout(totalTimer);
    signal?.removeEventListener("abort", cancel);
  }
}

// Only mounted on the existing loopback health listener. No arbitrary URL,
// redirects, client cookies, Supabase session or server-owned API key here.
export async function handleQwenTransport(request, response, transport = requestQwen) {
  const send = (status, body, headers = {}) => {
    if (!response.destroyed) {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
      response.end(body);
    }
  };
  if (request.method !== "POST") return send(405, '{"error":{"message":"POST required."}}');
  if (!/^Bearer \S+$/.test(request.headers.authorization || "")) return send(401, '{"error":{"message":"Provider authorization required."}}');
  const controller = new AbortController();
  const uploadTimer = setTimeout(() => request.destroy(), CONNECT_TIMEOUT_MS);
  const disconnected = () => { if (!response.writableFinished) controller.abort(); };
  response.once("close", disconnected);
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BYTES) return send(413, '{"error":{"message":"Model request too large."}}');
      chunks.push(chunk);
    }
    clearTimeout(uploadTimer);
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
    if (!body || !/^qwen[\w.-]+$/.test(body.model || "") || !Array.isArray(body.messages)) {
      return send(400, '{"error":{"message":"Invalid Qwen request."}}');
    }
    const requestedBudget = Number(request.headers["x-qwen-total-timeout-ms"]);
    const budget = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.min(requestedBudget, TOTAL_TIMEOUT_MS) : TOTAL_TIMEOUT_MS;
    const result = await transport(JSON.stringify({ ...body, enable_thinking: false, stream: false }), request.headers.authorization, {
      signal: controller.signal, totalTimeoutMs: budget,
    });
    send(result.status, result.body, {
      "x-qwen-attempts": String(result.attempts.length),
      "server-timing": `qwen;dur=${result.elapsedMs},connect;dur=${result.attempts.at(-1).connectMs || 0}`,
    });
  } catch (error) {
    send(error.status || 502, JSON.stringify({ error: { message: error.message, code: error.code || "QWEN_TRANSPORT_ERROR" } }));
  } finally {
    clearTimeout(uploadTimer);
    response.removeListener("close", disconnected);
  }
}
