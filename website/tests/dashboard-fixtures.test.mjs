import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_AS_OF, fixtureAccount, fixtureUsage, fixtureUser } from "./fixtures/dashboard-usage.mjs";

function allEvents(days) {
  const first = fixtureUsage({ days });
  if (!first.recent.nextCursor) return first.recent.items;
  const last = fixtureUsage({ days, cursor: first.recent.nextCursor });
  assert.equal(last.recent.nextCursor, null);
  return [...first.recent.items, ...last.recent.items];
}

test("dashboard periods filter one deterministic event and independent ledger history", () => {
  const month = fixtureUsage({ days: 30 });
  const week = fixtureUsage({ days: 7 });
  const monthEvents = allEvents(30);
  assert.equal(month.recent.items.length, 20);
  assert.equal(fixtureUsage({ days: 30, cursor: month.recent.nextCursor }).recent.items.length, 3);
  assert.equal(monthEvents.length, 23);
  assert.equal(new Set(monthEvents.map(item => item.id)).size, 23);
  assert.deepEqual(monthEvents.map(item => item.id).sort(), Array.from({ length: 23 }, (_, index) => `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`));
  assert.deepEqual(monthEvents, [...monthEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)));
  assert.equal(monthEvents.at(-1).createdAt.slice(0, 10), month.period.from.slice(0, 10));
  assert.equal(monthEvents[0].createdAt.slice(0, 10), FIXTURE_AS_OF.slice(0, 10));
  assert(monthEvents.every(item => item.createdAt <= FIXTURE_AS_OF));
  assert.deepEqual(allEvents(7), monthEvents.filter(item => item.createdAt >= week.period.from));
  assert.deepEqual(week.daily, month.daily.filter(day => day.date >= week.period.from.slice(0, 10)));
  assert(week.summary.recordedRequests < month.summary.recordedRequests);
  assert(week.summary.totalTokens < month.summary.totalTokens);

  for (const report of [month, week, fixtureUsage({ days: 30, scenario: "empty" }), fixtureUsage({ days: 7, scenario: "empty" })]) {
    assert.equal(report.daily.length, report.period.days);
    for (const key of Object.keys(report.summary)) assert.equal(report.summary[key], report.daily.reduce((sum, day) => sum + day[key], 0));
    assert.equal(report.summary.totalTokens, report.summary.promptTokens + report.summary.completionTokens);
    assert.equal(report.summary.netCreditsUsed, report.summary.creditsDebited - report.summary.creditsRefunded);
    for (const [index, day] of report.daily.entries()) {
      assert.equal(day.date, new Date(Date.parse(report.period.from) + index * 86_400_000).toISOString().slice(0, 10));
      assert.equal(day.totalTokens, day.promptTokens + day.completionTokens);
      assert.equal(day.netCreditsUsed, day.creditsDebited - day.creditsRefunded);
    }
  }
  const refundDay = week.daily.find(day => day.netCreditsUsed < 0);
  assert(refundDay);
  assert.equal(refundDay.recordedRequests, 0);
  assert.equal(refundDay.totalTokens, 0);
  assert(refundDay.creditsRefunded > 0);
  assert.notEqual(monthEvents.reduce((sum, item) => sum + item.recordedCredits, 0), month.summary.creditsDebited);
  const account = fixtureAccount();
  assert.equal(account.transactions.filter(row => row.amount < 0).reduce((sum, row) => sum - row.amount, 0), month.summary.creditsDebited);
  assert.equal(account.transactions.filter(row => row.amount > 0).reduce((sum, row) => sum + row.amount, 0), month.summary.creditsRefunded);
  assert.equal(account.transactions[0].balanceAfter, account.user.creditBalance.balance);
  assert.deepEqual(fixtureUsage({ days: 30 }), month);
});

test("dashboard fixture boundaries reject unsupported periods, cases, and nonexistent cursors", () => {
  for (const days of [0, 1, 29, 31, "7"]) assert.throws(() => fixtureUsage({ days }), /Unknown dashboard fixture/);
  for (const scenario of ["unknown", "", null]) {
    assert.throws(() => fixtureUsage({ scenario }), /Unknown dashboard fixture/);
    assert.throws(() => fixtureUser(scenario), /Unknown dashboard fixture/);
    assert.throws(() => fixtureAccount(scenario), /Unknown dashboard fixture/);
  }
  for (const cursor of ["", "invalid", "preview-page-2-7", "preview-page-3-30"]) assert.throws(() => fixtureUsage({ cursor }), /Unknown dashboard fixture cursor/);
  assert.throws(() => fixtureUsage({ days: 7, cursor: "preview-page-2-30" }), /Unknown dashboard fixture cursor/);
  assert.throws(() => fixtureUsage({ scenario: "empty", cursor: "preview-page-2-30" }), /Unknown dashboard fixture cursor/);
});
