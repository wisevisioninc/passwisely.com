import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../../src/lib/accountBalanceRefresh.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
new Function("module", "exports", js)(module, module.exports);
const { accountBalanceRefresh } = module.exports;

test("balance refresh joins concurrent events and ignores another account or a disposed session", async () => {
  let resolve, reads = 0;
  const accepted = [];
  const refresh = accountBalanceRefresh({ userId: "a", read: () => { reads++; return new Promise(r => { resolve = r; }); }, accept: user => accepted.push(user) });
  const first = refresh.refresh();
  assert.equal(first, refresh.refresh());
  await Promise.resolve();
  assert.equal(reads, 1);
  resolve({ success: true, user: { id: "b", credits: 999 } }); await first;
  assert.equal(accepted.length, 0);
  const second = refresh.refresh();
  await Promise.resolve();
  refresh.dispose(); resolve({ success: true, user: { id: "a", credits: 100 } }); await second;
  assert.equal(accepted.length, 0);
});

test("expiry schedules a server read without locally subtracting credits and retains the authoritative result", async () => {
  let callback, delay, reads = 0;
  const accepted = [], cancelled = [];
  const refresh = accountBalanceRefresh({ userId: "a", now: () => Date.parse("2026-01-01T00:00:00Z"),
    schedule: (fn, ms) => { callback = fn; delay = ms; return 1; }, cancel: id => cancelled.push(id),
    read: async () => { reads++; return { success: true, user: { id: "a", credits: 20, creditBalance: { balance: 20, permanentBalance: 20, expiringBalance: 0, nextExpiry: null } } }; },
    accept: user => accepted.push(user),
  });
  refresh.observe({ id: "a", credits: 220, creditBalance: { nextExpiry: "2026-01-01T00:02:00Z" } });
  assert.equal(delay, 121000);
  assert.equal(accepted.length, 0);
  callback(); await refresh.refresh();
  assert.equal(reads, 1);
  assert.equal(accepted[0].credits, 20);
  refresh.observe({ id: "a", credits: 200, creditBalance: { nextExpiry: "2025-01-01T00:00:00Z" } });
  assert.equal(delay, 60000);
  refresh.dispose(); assert.deepEqual(cancelled, [1]);
});

test("transport failure does not invent a zero or reject the renderer event", async () => {
  const refresh = accountBalanceRefresh({ userId: "a", read: async () => { throw new Error("offline"); }, accept: () => assert.fail("no fabricated balance") });
  await refresh.refresh(); refresh.dispose();
});


test("a debit notification during an older account read is followed by a fresh read", async () => {
  const pending = [], accepted = [];
  const refresh = accountBalanceRefresh({ userId: "a", read: () => new Promise(resolve => pending.push(resolve)), accept: user => accepted.push(user.credits) });
  const focus = refresh.refresh(); await Promise.resolve();
  const completion = refresh.refresh();
  assert.equal(completion, focus);
  pending[0]({ success: true, user: { id: "a", credits: 220 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1]({ success: true, user: { id: "a", credits: 216 } });
  await completion;
  assert.deepEqual(accepted, [220, 216]); refresh.dispose();
});
