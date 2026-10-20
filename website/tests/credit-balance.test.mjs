import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function application() {
  const source = readFileSync(new URL("../lib/supabase.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", js)(id => {
    assert.equal(id, "cloudflare:workers");
    return { env: { SUPABASE_URL: "https://database.example.test", SUPABASE_ANON_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture-admin" } };
  }, module, module.exports);
  return module.exports;
}
const profile = { id: "account-a", email: "example@example.test", locale: "zh", created_at: "2026-01-01", updated_at: "2026-01-01" };

test("account reads use the ledger effective balance before and after grant expiry", async t => {
  const app = application();
  let expiring = 200;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([String(url), init]);
    if (String(url).includes("/profiles?")) return Response.json([profile]);
    assert.equal(String(url), "https://database.example.test/rest/v1/rpc/get_credit_balance");
    assert.deepEqual(JSON.parse(init.body), { p_user_id: "account-a" });
    return Response.json([{ balance: 20 + expiring, permanent_balance: 20, expiring_balance: expiring, next_expiry: expiring ? "2026-11-20T12:00:00Z" : null }]);
  });
  let result = await app.getProfile("account-a");
  assert.equal(result.credits, 220);
  assert.deepEqual(result.creditBalance, { balance: 220, permanentBalance: 20, expiringBalance: 200, nextExpiry: "2026-11-20T12:00:00Z" });
  assert.ok(!new URL(calls[0][0]).searchParams.get("select").split(",").includes("credits"));
  expiring = 0;
  result = await app.findProfileByEmail(profile.email);
  assert.equal(result.credits, 20);
  assert.equal(result.creditBalance.nextExpiry, null);
});

test("missing profile stays absent and a malformed or unavailable ledger cannot fall back to permanent credits", async t => {
  const app = application();
  let rows = [];
  let balance = [];
  let rpcCalls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (String(url).includes("/profiles?")) return Response.json(rows);
    rpcCalls++; return Response.json(balance);
  });
  assert.equal(await app.getProfile("missing"), null);
  assert.equal(rpcCalls, 0);
  rows = [profile];
  await assert.rejects(app.getProfile(profile.id), /balance is unavailable/);
  for (const value of [null, {}, [null], [{ balance: 900, permanent_balance: 20, expiring_balance: 200, next_expiry: null }], [{ balance: -1, permanent_balance: -1, expiring_balance: 0, next_expiry: null }], [{ balance: 20, permanent_balance: 20, expiring_balance: 0, next_expiry: "invalid" }]]) {
    balance = value;
    await assert.rejects(app.getProfile(profile.id), /Invalid credit balance/);
  }
});
