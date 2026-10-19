import type { LiveResult } from "./types";

interface Dependencies {
  needsCleanup: () => boolean;
  reset: () => Promise<LiveResult>;
  isDestroyed: () => boolean;
  close: () => void;
  failed: (message: string) => void;
}

/** Keep the owning window available until its native capture has been released. */
export function createCaptureCloseGuard(deps: Dependencies): (event: { preventDefault(): void }) => void {
  let pending = false;
  let releasedClose = false;
  return event => {
    if (releasedClose) { releasedClose = false; return; }
    if (pending) { event.preventDefault(); return; }
    if (!deps.needsCleanup()) return;
    event.preventDefault();
    pending = true;
    void deps.reset().then(result => {
      pending = false;
      if (!result.success) { deps.failed(result.error || "采集资源释放失败，请重试。"); return; }
      if (!deps.isDestroyed()) {
        releasedClose = true;
        deps.close();
      }
    }).catch(error => {
      pending = false;
      deps.failed(error instanceof Error ? error.message : "采集资源释放失败，请重试。");
    });
  };
}
