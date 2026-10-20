import type { CreditBalanceDetails } from "../../shared/billing";

interface AccountBalanceUser { id: string; credits: number; creditBalance?: CreditBalanceDetails }
interface Dependencies {
  userId: string;
  read: () => Promise<{ success: boolean; user?: AccountBalanceUser }>;
  accept: (user: AccountBalanceUser) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Refreshes authoritative balances; a local clock never deletes credits. */
export function accountBalanceRefresh(deps: Dependencies) {
  let disposed = false;
  let flight: Promise<void> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = deps.cancel ?? clearTimeout;
  const schedule = deps.schedule ?? setTimeout;
  const now = deps.now ?? Date.now;
  function observe(user: AccountBalanceUser) {
    if (disposed || user.id !== deps.userId) return;
    if (timer !== undefined) { cancel(timer); timer = undefined; }
    const next = user.creditBalance?.nextExpiry;
    if (next && Number.isFinite(Date.parse(next))) {
      // Retry no faster than once a minute if server/local clocks disagree.
      timer = schedule(() => { timer = undefined; void refresh(); },
        Math.min(2_147_483_647, Math.max(60_000, Date.parse(next) - now() + 1000)));
    }
  }
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (flight) { dirty = true; return flight; }
    // A completion arriving during a focus read invalidates that read. Join the
    // flight, then do one trailing read for all coalesced changes.
    flight = Promise.resolve().then(async () => {
      try {
        do {
          dirty = false;
          try {
            const result = await deps.read();
            if (!disposed && result.success && result.user?.id === deps.userId) {
              deps.accept(result.user); observe(result.user);
            }
          } catch { /* Keep the last known balance on a network failure. */ }
        } while (dirty && !disposed);
      } finally { flight = null; }
    });
    return flight;
  }
  return { refresh, observe, dispose() { disposed = true; if (timer !== undefined) cancel(timer); } };
}
