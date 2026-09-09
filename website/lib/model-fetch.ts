import type { AiProvider } from "@/lib/ai-catalog";

export async function fetchModelProvider(
  provider: AiProvider,
  origin: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const qwen = provider === "qwen";
  const totalTimeout = qwen ? Math.min(90_000, timeoutMs) : timeoutMs;
  const headers = new Headers(init.headers);
  if (qwen) headers.set("x-qwen-total-timeout-ms", String(totalTimeout));
  // Workerd fetch has no socket/connect timeout hook. The loopback Node
  // transport ends its 20s timer on secureConnect, not on response headers.
  // It owns connection-only retries within ONE shared 90s total budget.
  try {
    return await fetch(qwen ? "http://127.0.0.1:3013/internal/qwen/chat/completions" : origin, {
      ...init,
      headers,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(totalTimeout)])
        : AbortSignal.timeout(totalTimeout),
    });
  } catch {
    return null;
  }
}
