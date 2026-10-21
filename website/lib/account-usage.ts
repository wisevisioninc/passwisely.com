import { adminRpc } from "@/lib/supabase";

import type { AccountUsageReport, AccountUsageEvent, UsageTotals } from "../../shared/account-usage";

const PAGE_SIZE = 20;
const CURSOR_MAX_AGE_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// PostgreSQL microseconds are retained unchanged for lossless keyset pagination.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const DAY_MS = 86_400_000;
type Cursor = { version: 1; days: 7 | 30; asOf: string; createdAt: string; id: string };
export type UsageQuery = { days: 7 | 30; asOf: string; from: string; before: Cursor | null };

function periodStart(asOf: string, days: number): string {
  const date = new Date(asOf);
  date.setUTCHours(0, 0, 0, 0);
  return new Date(date.getTime() - (days - 1) * DAY_MS).toISOString();
}
function parseTimestamp(value: unknown): { source: string; microseconds: bigint } | null {
  if (typeof value !== "string" || !TIMESTAMP.test(value) || value.startsWith("0000-")) return null;
  const seconds = value.slice(0, 19);
  const date = new Date(`${seconds}Z`);
  // Date.parse otherwise normalizes nonexistent dates such as September 31.
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== seconds) return null;
  const fraction = value.slice(19, -1).replace(/^\./, "").padEnd(6, "0");
  return { source: value, microseconds: BigInt(date.getTime()) * BigInt(1000) + BigInt(fraction) };
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function encodeCursor(cursor: Cursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function parseUsageQuery(url: URL, now = new Date()): UsageQuery | null {
  if (url.searchParams.getAll("days").length > 1 || url.searchParams.getAll("cursor").length > 1) return null;
  const requestedDays = url.searchParams.get("days") || "30";
  if (requestedDays !== "7" && requestedDays !== "30") return null;
  const days = Number(requestedDays) as 7 | 30;
  const value = url.searchParams.get("cursor");
  let before: Cursor | null = null;
  if (value !== null) {
    if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
      const decoded: unknown = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/")));
      if (!object(decoded) || decoded.version !== 1 || decoded.days !== days ||
        typeof decoded.id !== "string" || !UUID.test(decoded.id)) return null;
      const asOf = parseTimestamp(decoded.asOf), createdAt = parseTimestamp(decoded.createdAt);
      if (!asOf || !createdAt) return null;
      const age = BigInt(now.getTime()) * BigInt(1000) - asOf.microseconds;
      const start = BigInt(Date.parse(periodStart(asOf.source, days))) * BigInt(1000);
      if (age < BigInt(0) || age > BigInt(CURSOR_MAX_AGE_MS) * BigInt(1000) ||
        createdAt.microseconds > asOf.microseconds || createdAt.microseconds < start) return null;
      before = { version: 1, days, asOf: asOf.source, createdAt: createdAt.source, id: decoded.id };
    } catch { return null; }
  }
  const asOf = before?.asOf || now.toISOString();
  return { days, asOf, from: periodStart(asOf, days), before };
}

function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function totals(value: unknown): value is UsageTotals {
  if (!object(value)) return false;
  return ["recordedRequests", "promptTokens", "completionTokens", "totalTokens", "creditsDebited", "creditsRefunded"].every(key => natural(value[key])) &&
    Number.isSafeInteger(value.netCreditsUsed) && value.netCreditsUsed === Number(value.creditsDebited) - Number(value.creditsRefunded) &&
    value.totalTokens === Number(value.promptTokens) + Number(value.completionTokens);
}
function event(value: unknown): value is AccountUsageEvent {
  return object(value) && typeof value.id === "string" && UUID.test(value.id) && typeof value.action === "string" &&
    (value.provider === null || typeof value.provider === "string") && (value.model === null || typeof value.model === "string") &&
    natural(value.promptTokens) && natural(value.completionTokens) && natural(value.totalTokens) && natural(value.recordedCredits) &&
    value.totalTokens === value.promptTokens + value.completionTokens && parseTimestamp(value.createdAt) !== null;
}

export async function getAccountUsage(userId: string, query: UsageQuery): Promise<AccountUsageReport> {
  const result: unknown = await adminRpc("account_usage_statistics", {
    p_user_id: userId, p_days: query.days, p_as_of: query.asOf,
    p_before_created_at: query.before?.createdAt || null, p_before_id: query.before?.id || null,
    p_limit: PAGE_SIZE,
  });
  if (!object(result) || !totals(result.summary) || !Array.isArray(result.daily) || result.daily.length !== query.days ||
    !Array.isArray(result.events) || result.events.length > PAGE_SIZE + 1 || !result.events.every(event)) {
    throw new Error("Invalid account usage response.");
  }
  const firstDay = Date.parse(query.from);
  for (const [index, day] of result.daily.entries()) {
    if (!totals(day) || !object(day) || day.date !== new Date(firstDay + index * DAY_MS).toISOString().slice(0, 10)) {
      throw new Error("Invalid account usage response.");
    }
  }
  const summary = result.summary;
  const daily = result.daily as AccountUsageReport["daily"];
  for (const key of Object.keys(summary) as Array<keyof UsageTotals>) {
    if (daily.reduce((sum, day) => sum + day[key], 0) !== summary[key]) throw new Error("Invalid account usage response.");
  }
  const items = (result.events as AccountUsageEvent[]).slice(0, PAGE_SIZE);
  const last = items.at(-1);
  return {
    period: { days: query.days, timeZone: "UTC", from: query.from, to: query.asOf }, summary, daily,
    recent: { items, nextCursor: result.events.length > PAGE_SIZE && last ? encodeCursor({ version: 1, days: query.days, asOf: query.asOf, createdAt: last.createdAt, id: last.id }) : null },
    coverage: { requests: "recorded_events", tokens: "reported_only", credits: "ledger", audioMinutes: false },
  };
}
