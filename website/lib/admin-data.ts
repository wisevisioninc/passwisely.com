import type { HostHealth, ServiceHealth } from "@/lib/admin-health";
import { adminRest, adminRpc } from "@/lib/supabase";

export interface DailyUsage {
  date: string;
  newUsers: number;
  users: number;
  requests: number;
  credits: number;
  tokens: number;
  revenue: number;
  orders: number;
}

export interface CountBreakdown {
  label: string;
  value: number;
}

export interface PaymentBreakdown {
  label: string;
  attempts: number;
  completed: number;
  revenue: number;
}

export interface RequestMinute {
  minute: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
}

export interface RoutePerformance {
  label: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
}

export interface DownloadBreakdown {
  label: string;
  total: number;
  today: number;
  sevenDays: number;
}

export interface DownloadPerformance {
  platform: string;
  status: "healthy" | "down";
  objectBytes: number;
  headLatencyMs: number;
  ttfbMs: number;
  sampleBytes: number;
  transferMs: number;
  throughputBps: number;
  estimatedSeconds: number;
  httpStatus: number;
  createdAt: string;
}

export interface AdminStats {
  generatedAt: string;
  totalUsers: number;
  activeUsers: number;
  newUsersToday: number;
  newUsers7d: number;
  newUsers30d: number;
  dau: number;
  wau: number;
  mau: number;
  onlineSessions: number;
  requestsToday: number;
  requests7d: number;
  requests30d: number;
  creditsToday: number;
  credits7d: number;
  credits30d: number;
  availableCredits: number;
  tokensToday: number;
  tokens7d: number;
  tokens30d: number;
  totalTokens: number;
  revenueToday: number;
  revenue7d: number;
  revenue30d: number;
  totalRevenue: number;
  completedOrders30d: number;
  pendingOrders: number;
  failedOrders30d: number;
  payingUsers30d: number;
  paymentSuccessRate30d: number;
  resumeDocuments: number;
  resumeRuns30d: number;
  daily: DailyUsage[];
  actionBreakdown: CountBreakdown[];
  providerBreakdown: CountBreakdown[];
  paymentBreakdown: PaymentBreakdown[];
  qpsCurrent: number;
  qpsPeak1h: number;
  requests5m: number;
  avgLatencyMs5m: number;
  maxLatencyMs5m: number;
  errorRate5m: number;
  downloadsToday: number;
  downloads7d: number;
  downloadsTotal: number;
  requestSeries: RequestMinute[];
  routeBreakdown: RoutePerformance[];
  downloadBreakdown: DownloadBreakdown[];
  downloadPerformance: DownloadPerformance[];
  services: ServiceHealth[];
  host: HostHealth | null;
}

type JsonRow = Record<string, unknown>;

function number(row: JsonRow, key: string): number {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
}

function countBreakdown(value: unknown): CountBreakdown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as JsonRow;
    return { label: String(row.label || "other"), value: number(row, "value") };
  });
}

export async function getAdminStats(): Promise<AdminStats> {
  const [row, performance] = await Promise.all([
    adminRpc<JsonRow>("admin_statistics", {}),
    adminRpc<JsonRow>("admin_performance_statistics", {}),
  ]);
  const daily = Array.isArray(row.daily)
    ? row.daily.map((item) => {
        const day = item as JsonRow;
        return {
          date: String(day.date || ""),
          newUsers: number(day, "newUsers"),
          users: number(day, "users"),
          requests: number(day, "requests"),
          credits: number(day, "credits"),
          tokens: number(day, "tokens"),
          revenue: number(day, "revenue"),
          orders: number(day, "orders"),
        };
      })
    : [];
  const paymentBreakdown = Array.isArray(row.payment_breakdown)
    ? row.payment_breakdown.map((item) => {
        const payment = item as JsonRow;
        return {
          label: String(payment.label || "other"),
          attempts: number(payment, "attempts"),
          completed: number(payment, "completed"),
          revenue: number(payment, "revenue"),
        };
      })
    : [];
  const requestSeries = Array.isArray(performance.request_series)
    ? performance.request_series.map((item) => {
        const minute = item as JsonRow;
        return {
          minute: String(minute.minute || ""),
          requests: number(minute, "requests"),
          errors: number(minute, "errors"),
          avgLatencyMs: number(minute, "avgLatencyMs"),
        };
      })
    : [];
  const routeBreakdown = Array.isArray(performance.route_breakdown)
    ? performance.route_breakdown.map((item) => {
        const route = item as JsonRow;
        return {
          label: String(route.label || "other"),
          requests: number(route, "requests"),
          errors: number(route, "errors"),
          avgLatencyMs: number(route, "avg_latency_ms"),
        };
      })
    : [];
  const downloadBreakdown = Array.isArray(performance.download_breakdown)
    ? performance.download_breakdown.map((item) => {
        const download = item as JsonRow;
        return {
          label: String(download.label || "other"),
          total: number(download, "total"),
          today: number(download, "today"),
          sevenDays: number(download, "seven_days"),
        };
      })
    : [];
  const downloadPerformance = Array.isArray(performance.download_performance)
    ? performance.download_performance.map((item) => {
        const download = item as JsonRow;
        return {
          platform: String(download.platform || "other"),
          status: download.status === "healthy" ? "healthy" as const : "down" as const,
          objectBytes: number(download, "object_bytes"),
          headLatencyMs: number(download, "head_latency_ms"),
          ttfbMs: number(download, "ttfb_ms"),
          sampleBytes: number(download, "sample_bytes"),
          transferMs: number(download, "transfer_ms"),
          throughputBps: number(download, "throughput_bps"),
          estimatedSeconds: number(download, "estimated_seconds"),
          httpStatus: number(download, "http_status"),
          createdAt: String(download.created_at || ""),
        };
      })
    : [];

  return {
    generatedAt: String(row.generated_at || new Date().toISOString()),
    totalUsers: number(row, "total_users"),
    activeUsers: number(row, "active_users"),
    newUsersToday: number(row, "new_users_today"),
    newUsers7d: number(row, "new_users_7d"),
    newUsers30d: number(row, "new_users_30d"),
    dau: number(row, "dau"),
    wau: number(row, "wau"),
    mau: number(row, "mau"),
    onlineSessions: number(row, "online_sessions"),
    requestsToday: number(row, "requests_today"),
    requests7d: number(row, "requests_7d"),
    requests30d: number(row, "requests_30d"),
    creditsToday: number(row, "credits_today"),
    credits7d: number(row, "credits_7d"),
    credits30d: number(row, "credits_30d"),
    availableCredits: number(row, "available_credits"),
    tokensToday: number(row, "tokens_today"),
    tokens7d: number(row, "tokens_7d"),
    tokens30d: number(row, "tokens_30d"),
    totalTokens: number(row, "total_tokens"),
    revenueToday: number(row, "revenue_today"),
    revenue7d: number(row, "revenue_7d"),
    revenue30d: number(row, "revenue_30d"),
    totalRevenue: number(row, "total_revenue"),
    completedOrders30d: number(row, "completed_orders_30d"),
    pendingOrders: number(row, "pending_orders"),
    failedOrders30d: number(row, "failed_orders_30d"),
    payingUsers30d: number(row, "paying_users_30d"),
    paymentSuccessRate30d: number(row, "payment_success_rate_30d"),
    resumeDocuments: number(row, "resume_documents"),
    resumeRuns30d: number(row, "resume_runs_30d"),
    daily,
    actionBreakdown: countBreakdown(row.action_breakdown),
    providerBreakdown: countBreakdown(row.provider_breakdown),
    paymentBreakdown,
    qpsCurrent: number(performance, "qps_current"),
    qpsPeak1h: number(performance, "qps_peak_1h"),
    requests5m: number(performance, "requests_5m"),
    avgLatencyMs5m: number(performance, "avg_latency_ms_5m"),
    maxLatencyMs5m: number(performance, "max_latency_ms_5m"),
    errorRate5m: number(performance, "error_rate_5m"),
    downloadsToday: number(performance, "downloads_today"),
    downloads7d: number(performance, "downloads_7d"),
    downloadsTotal: number(performance, "downloads_total"),
    requestSeries,
    routeBreakdown,
    downloadBreakdown,
    downloadPerformance,
    services: [],
    host: null,
  };
}

export async function getAdminSettings(): Promise<Record<string, string>> {
  const rows = await adminRest<Array<{ key: string; value: string }>>(
    "admin_settings?select=key,value&order=key.asc",
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

const ALLOWED_SETTINGS = new Set([
  "maintenance_message",
  "support_email",
  "registration_enabled",
]);

export async function saveAdminSettings(
  values: Record<string, unknown>,
): Promise<void> {
  const rows = Object.entries(values)
    .filter(
      ([key, value]) => ALLOWED_SETTINGS.has(key) && typeof value === "string",
    )
    .map(([key, value]) => ({
      key,
      value: String(value).slice(0, 500),
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  await adminRest("admin_settings?on_conflict=key", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
}

export async function recordUsage(input: {
  userId: string;
  action: string;
  provider?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  credits?: number;
  reference: string;
}): Promise<void> {
  await adminRest("usage_events?on_conflict=reference", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: input.userId,
      action: input.action,
      provider: input.provider || null,
      model: input.model || null,
      prompt_tokens: Math.max(0, Math.floor(input.promptTokens || 0)),
      completion_tokens: Math.max(0, Math.floor(input.completionTokens || 0)),
      credits: Math.max(0, Math.floor(input.credits || 0)),
      reference: input.reference,
    }),
  });
}
