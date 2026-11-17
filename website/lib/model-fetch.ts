import type { AiProvider } from "@/lib/ai-catalog";

const QWEN_LOOPBACK = "http://127.0.0.1:3013/internal/qwen/chat/completions";
const KIMI_LOOPBACK = "http://127.0.0.1:3013/internal/kimi/chat/completions";
const KIMI_ORIGIN = "https://api.moonshot.cn/v1/chat/completions";

export async function fetchModelProvider(
  provider: AiProvider,
  origin: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const qwen = provider === "qwen";
  // Kimi goes through the same loopback Node process so its Moonshot
  // connections are pooled and pre-opened; workerd reconnects every time.
  const kimi = provider === "kimi" && origin === KIMI_ORIGIN;
  const totalTimeout = qwen ? Math.min(90_000, timeoutMs) : timeoutMs;
  const headers = new Headers(init.headers);
  if (qwen) headers.set("x-qwen-total-timeout-ms", String(totalTimeout));
  if (kimi) headers.set("x-wise-total-timeout-ms", String(Math.min(90_000, totalTimeout)));
  const signal = init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(totalTimeout)])
    : AbortSignal.timeout(totalTimeout);
  // Workerd fetch has no socket/connect timeout hook. The loopback Node
  // transport ends its 20s timer on secureConnect, not on response headers.
  // It owns connection-only retries within ONE shared 90s total budget.
  try {
    return await fetch(qwen ? QWEN_LOOPBACK : kimi ? KIMI_LOOPBACK : origin, { ...init, headers, signal });
  } catch {
    // fetch rejects before any response headers, which in practice means the
    // loopback process is not running; use the direct route rather than fail.
    if (!kimi || signal.aborted) return null;
    try {
      headers.delete("x-wise-total-timeout-ms");
      return await fetch(origin, { ...init, headers, signal });
    } catch {
      return null;
    }
  }
}
