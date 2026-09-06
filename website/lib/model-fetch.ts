import type { AiProvider } from "@/lib/ai-catalog";

export async function fetchModelProvider(
  provider: AiProvider,
  origin: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  // The DashScope China endpoint can occasionally resolve to an edge that
  // fails its TLS handshake from the Singapore host. Retry network failures
  // against a fresh DNS result while keeping the overall request bounded.
  const attempts = provider === "qwen" ? 3 : 1;
  const attemptTimeout = provider === "qwen" ? Math.min(20_000, timeoutMs) : timeoutMs;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(origin, {
        ...init,
        signal: AbortSignal.timeout(attemptTimeout),
      });
    } catch {
      if (attempt === attempts - 1) return null;
    }
  }
  return null;
}
