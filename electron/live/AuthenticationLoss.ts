import type { LiveResult } from "./types";

/** Authentication owns cancellation; capture ownership remains in the service. */
export function createAuthenticationLossHandler(deps: {
  cancelRequests(): void;
  notifyUnauthorized(): void;
  reset(): Promise<LiveResult>;
  cleanupFailed(message: string): void;
}): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    if (pending) return pending;
    deps.cancelRequests();
    deps.notifyUnauthorized();
    pending = Promise.resolve().then(() => deps.reset()).then(result => {
      if (!result.success) deps.cleanupFailed(result.error || "音频资源释放失败，请重试。");
    }).catch(error => {
      deps.cleanupFailed(error instanceof Error ? error.message : "音频资源释放失败，请重试。");
    }).finally(() => { pending = null; });
    return pending;
  };
}
