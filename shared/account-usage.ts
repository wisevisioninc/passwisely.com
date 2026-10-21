export interface UsageTotals {
  recordedRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsDebited: number;
  creditsRefunded: number;
  netCreditsUsed: number;
}
export interface AccountUsageEvent {
  id: string;
  action: string;
  provider: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  recordedCredits: number;
  createdAt: string;
}
export interface AccountUsageReport {
  period: { days: 7 | 30; timeZone: "UTC"; from: string; to: string };
  summary: UsageTotals;
  daily: Array<UsageTotals & { date: string }>;
  recent: { items: AccountUsageEvent[]; nextCursor: string | null };
  coverage: {
    requests: "recorded_events";
    tokens: "reported_only";
    credits: "ledger";
    audioMinutes: false;
  };
}

