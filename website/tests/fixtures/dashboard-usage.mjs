// Synthetic, deterministic data for the local dashboard preview. No real account,
// request text, API credential, payment, or provider interaction is represented.
export const FIXTURE_AS_OF = "2026-10-21T12:00:00.000Z";
export const FIXTURE_SCENARIOS = Object.freeze(["success", "empty", "error", "unauthorized"]);
const DAY_MS = 86_400_000;
const keys = ["recordedRequests", "promptTokens", "completionTokens", "totalTokens", "creditsDebited", "creditsRefunded", "netCreditsUsed"];
const zero = () => Object.fromEntries(keys.map(key => [key, 0]));

export function fixtureUser(scenario = "success") {
  const empty = scenario === "empty";
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "dashboard-preview@example.test",
    locale: "zh",
    credits: empty ? 20 : 164,
    creditBalance: {
      balance: empty ? 20 : 164,
      permanentBalance: 20,
      expiringBalance: empty ? 0 : 144,
      nextExpiry: empty ? null : "2026-11-14T12:00:00.000Z",
    },
  };
}

function events(days, from) {
  return Array.from({ length: 23 }, (_, index) => {
    const day = index % days;
    const at = new Date(from + day * DAY_MS + 9 * 3_600_000 + index * 60_000);
    const promptTokens = index === 4 ? 0 : 210 + index * 37;
    const completionTokens = index === 4 ? 0 : 110 + index * 19;
    return {
      id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      action: ["solve", "follow_up", "chat"][index % 3],
      provider: index === 4 ? null : ["moonshot", "openai", "deepseek"][index % 3],
      model: index === 4 ? null : ["kimi-k2.5", "gpt-4.1", "deepseek-chat"][index % 3],
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      // Event metadata deliberately differs from independent ledger debits.
      recordedCredits: index % 4 === 0 ? 2 : 1,
      createdAt: at.toISOString(),
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function fixtureUsage({ days = 30, scenario = "success", cursor = null } = {}) {
  if (![7, 30].includes(days) || !FIXTURE_SCENARIOS.includes(scenario)) throw new Error("Unknown dashboard fixture.");
  if (cursor !== null && cursor !== `preview-page-2-${days}`) throw new Error("Unknown dashboard fixture cursor.");
  const end = new Date(FIXTURE_AS_OF);
  end.setUTCHours(0, 0, 0, 0);
  const from = end.getTime() - (days - 1) * DAY_MS;
  const items = scenario === "empty" ? [] : events(days, from);
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(from + index * DAY_MS).toISOString().slice(0, 10);
    const dayEvents = items.filter(item => item.createdAt.slice(0, 10) === date);
    const creditsDebited = scenario === "empty" ? 0 : index % 3 === 0 ? 6 : index % 5 === 0 ? 4 : 0;
    const creditsRefunded = scenario !== "empty" && index === 2 ? 9 : 0;
    return {
      ...zero(), date,
      recordedRequests: dayEvents.length,
      promptTokens: dayEvents.reduce((sum, item) => sum + item.promptTokens, 0),
      completionTokens: dayEvents.reduce((sum, item) => sum + item.completionTokens, 0),
      totalTokens: dayEvents.reduce((sum, item) => sum + item.totalTokens, 0),
      creditsDebited,
      creditsRefunded,
      netCreditsUsed: creditsDebited - creditsRefunded,
    };
  });
  const summary = daily.reduce((totals, day) => Object.fromEntries(keys.map(key => [key, totals[key] + day[key]])), zero());
  return {
    user: fixtureUser(scenario),
    period: { days, timeZone: "UTC", from: new Date(from).toISOString(), to: FIXTURE_AS_OF },
    summary,
    daily,
    recent: { items: cursor ? items.slice(20) : items.slice(0, 20), nextCursor: !cursor && items.length > 20 ? `preview-page-2-${days}` : null },
    coverage: { requests: "recorded_events", tokens: "reported_only", credits: "ledger", audioMinutes: false },
  };
}

export function fixtureAccount(scenario = "success") {
  return {
    user: fixtureUser(scenario),
    transactions: scenario === "empty" ? [] : [
      { id: "preview-ledger-refund", amount: 9, balanceAfter: 164, type: "refund", createdAt: 1792580400 },
      { id: "preview-ledger-debit", amount: -6, balanceAfter: 155, type: "consume", createdAt: 1792576800 },
    ],
  };
}
