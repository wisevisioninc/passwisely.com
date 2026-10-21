import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createProductionTsLoader } from "../../desktop-api/tests/helpers/production-typescript.mjs";

const NOW = new Date("2026-10-21T13:00:00.000Z");
const migrations = new URL("../supabase/migrations/", import.meta.url);
const ownerPath = fileURLToPath(new URL("../lib/account-usage.ts", import.meta.url));
const routePath = fileURLToPath(new URL("../app/api/account/usage/route.ts", import.meta.url));
const zero = { recordedRequests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, creditsDebited: 0, creditsRefunded: 0, netCreditsUsed: 0 };
function owner(rpc) { return createProductionTsLoader({ mocks: { "@/lib/supabase": { adminRpc: rpc } } })(ownerPath); }
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  for (const name of (await readdir(migrations)).filter(name => /^00(?:0[1-9]|1[01])_.*\.sql$/.test(name)).sort()) {
    let sql = await readFile(new URL(name, migrations), "utf8");
    // Only the platform's pgcrypto extension installation is unavailable in WASM;
    // PostgreSQL's native gen_random_uuid and the full target migrations run.
    if (name.startsWith("0001_")) sql = sql.replace("create extension if not exists pgcrypto;", "");
    await db.exec(sql);
  }
  return db;
}
async function addUser(db) {
  const id = randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [id, `${id}@example.invalid`]);
  return id;
}
function databaseRpc(db, calls = []) {
  return async (name, args) => {
    assert.equal(name, "account_usage_statistics"); calls.push(args);
    const row = (await db.query("select public.account_usage_statistics($1,$2,$3,$4,$5,$6) as report", [args.p_user_id, args.p_days, args.p_as_of, args.p_before_created_at, args.p_before_id, args.p_limit])).rows[0];
    return row.report;
  };
}
const query = (app, search = "", now = NOW) => app.parseUsageQuery(new URL(`https://example.invalid/api/account/usage${search}`), now);

// Real SQL with the only mocks at auth/REST transport. This is not production
// Supabase verification; it exercises exact migration, aggregation and ACLs.
test("account usage database owner and authenticated API", async t => {
  const db = await database();
  try {
    const userA = await addUser(db), userB = await addUser(db), empty = await addUser(db);
    const calls = [], app = owner(databaseRpc(db, calls));
    await t.test("empty and zero-filled UTC periods, exact boundary and service-role-only ACL", async () => {
      const result = await app.getAccountUsage(empty, query(app));
      assert.deepEqual(result.summary, zero);
      assert.equal(result.daily.length, 30); assert.equal(result.daily[0].date, "2026-09-22"); assert.equal(result.daily.at(-1).date, "2026-10-21");
      assert.ok(result.daily.every(day => day.totalTokens === 0));
      assert.deepEqual(result.recent, { items: [], nextCursor: null });
      assert.deepEqual(result.coverage, { requests: "recorded_events", tokens: "reported_only", credits: "ledger", audioMinutes: false });
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        await assert.rejects(databaseRpc(db)("account_usage_statistics", calls[0]), /permission denied/);
        await db.exec("reset role");
      }
      await db.exec("set role service_role");
      assert.deepEqual((await app.getAccountUsage(empty, query(app))).summary, zero);
      await db.exec("reset role");
      await db.exec(await readFile(new URL("0011_account_usage_statistics.sql", migrations), "utf8"));
      assert.deepEqual((await app.getAccountUsage(empty, query(app, "?days=7"))).summary, zero);
    });
    await db.query(`insert into public.usage_events(user_id,action,provider,model,prompt_tokens,completion_tokens,credits,reference,created_at)
      select $1,'ai_chat','kimi','kimi-k3',2,3,1,'event-a:'||i,'2026-10-21T12:00:00.123456Z' from generate_series(1,1025) i`, [userA]);
    await db.query(`insert into public.usage_events(user_id,action,prompt_tokens,completion_tokens,reference,created_at) values
      ($1,'before',9999,9999,'before','2026-09-21T23:59:59.999999Z'),
      ($1,'future',9999,9999,'future','2026-10-21T13:00:00.000001Z'),
      ($2,'private-b',9999,9999,'private-reference-b','2026-10-21T12:00:00Z')`, [userA,userB]);
    await db.query(`insert into public.credit_transactions(user_id,amount,balance_after,type,reference,created_at) values
      ($1,-10,20,'ai_chat','old-debit','2026-09-01T12:00:00Z'),
      ($1,-100,20,'ai_chat','event-a:1','2026-10-21T12:00:00Z'),
      ($1,-4,20,'ai_failed','unlogged-failure','2026-10-20T12:00:00Z'),
      ($1,1000,1020,'purchase','purchase-not-usage','2026-10-21T12:00:00Z'),
      ($1,500,1520,'old-unknown-refund','unlinked-positive','2026-10-21T12:00:00Z'),
      ($2,-9999,20,'private-b','private-debit-b','2026-10-21T12:00:00Z')`, [userA,userB]);
    await db.query(`insert into public.credit_transactions(user_id,amount,balance_after,type,reference,created_at,refund_debit_reference) values
      ($1,7,27,'refund','old-debit:refund','2026-10-01T12:00:00Z','old-debit'),
      ($1,90,117,'settlement','event-a:1:settlement','2026-10-21T12:00:00Z','event-a:1')`, [userA]);
    await t.test("complete totals above REST row cap, independent debit/refund ledger and no cross-user leakage", async () => {
      const report = await app.getAccountUsage(userA, query(app));
      assert.deepEqual(report.summary, { recordedRequests: 1025, promptTokens: 2050, completionTokens: 3075, totalTokens: 5125, creditsDebited: 104, creditsRefunded: 97, netCreditsUsed: 7 });
      assert.equal(report.daily.find(day => day.date === "2026-10-01").netCreditsUsed, -7);
      assert.equal(report.daily.find(day => day.date === "2026-10-20").recordedRequests, 0);
      assert.equal(report.daily.find(day => day.date === "2026-10-20").creditsDebited, 4);
      assert.equal(report.recent.items.length, 20); assert.equal(report.recent.items[0].recordedCredits, 1);
      assert.equal(report.recent.items[0].createdAt, "2026-10-21T12:00:00.123456Z");
      assert.ok(!JSON.stringify(report).includes("private-")); assert.ok(!JSON.stringify(report).includes("reference"));
      const week = await app.getAccountUsage(userA, query(app,"?days=7"));
      assert.equal(week.period.from,"2026-10-15T00:00:00.000Z"); assert.equal(week.summary.creditsRefunded,90); assert.equal(week.summary.netCreditsUsed,14);
    });
    await t.test("lossless timestamp/id pagination, pinned period and no duplicates for same-timestamp rows", async () => {
      const seen = new Set(); let cursor = null, pages = 0;
      do {
        const input = query(app, cursor ? `?cursor=${cursor}` : "", new Date(NOW.getTime()+1000));
        const result = await app.getAccountUsage(userA,input);
        for (const item of result.recent.items) { assert.ok(!seen.has(item.id)); seen.add(item.id); }
        assert.equal(result.period.to, new Date(NOW.getTime()+1000).toISOString());
        assert.equal(result.summary.recordedRequests,1026); // future boundary fixture is now in range
        cursor = result.recent.nextCursor; pages++;
        assert.ok(pages <= 52);
      } while (cursor);
      assert.equal(seen.size,1026); assert.equal(pages,52);
    });
    await t.test("API authenticates once, overrides client user id and returns safe unavailable errors", async () => {
      const account = { id:userA,email:"self@example.invalid",locale:"zh",credits:20,creditBalance:{balance:20,permanentBalance:20,expiringBalance:0,nextExpiry:null} };
      let authReads=0, available=true;
      const real = owner(async (...args) => { if (!available) throw new Error("sensitive database transport text"); return databaseRpc(db,calls)(...args); });
      const route = createProductionTsLoader({ mocks: {
        "@/lib/auth": { getApiUser: async () => { authReads++; return account; } },
        "@/lib/account-usage": { ...real, parseUsageQuery: url => real.parseUsageQuery(url,NOW) },
      } })(routePath);
      const response = await route.GET(new Request(`https://example.invalid/api/account/usage?user_id=${userB}`));
      assert.equal(response.status,200); assert.equal(authReads,1); assert.match(response.headers.get("cache-control"),/no-store/);
      const body=await response.json(); assert.equal(body.user.id,userA); assert.equal(body.summary.recordedRequests,1025); assert.equal(calls.at(-1).p_user_id,userA);
      const previousCalls=calls.length;
      for(const createdAt of ["2026-09-31T12:00:00Z", "2026-10-21T13:00:00.000001Z"]) {
        const cursor=Buffer.from(JSON.stringify({version:1,days:30,asOf:NOW.toISOString(),createdAt,id:randomUUID()})).toString("base64url");
        const invalidCursor=await route.GET(new Request(`https://example.invalid/api/account/usage?cursor=${cursor}`));
        assert.equal(invalidCursor.status,400); assert.equal((await invalidCursor.json()).code,"INVALID_USAGE_QUERY");
      }
      assert.equal(calls.length,previousCalls);
      available=false;
      const failure=await route.GET(new Request("https://example.invalid/api/account/usage"));
      assert.equal(failure.status,503); assert.equal((await failure.json()).code,"USAGE_UNAVAILABLE");
      const invalid=await route.GET(new Request("https://example.invalid/api/account/usage?days=365")); assert.equal(invalid.status,400);
      const anonymous=createProductionTsLoader({mocks:{"@/lib/auth":{getApiUser:async()=>null},"@/lib/account-usage":{getAccountUsage:()=>assert.fail("unauthenticated database call"),parseUsageQuery:()=>assert.fail("unauthenticated parse")}}})(routePath);
      const denied=await anonymous.GET(new Request("https://example.invalid/api/account/usage")); assert.equal(denied.status,401);
      for(const result of [response,failure,invalid,denied]) {
        assert.match(result.headers.get("cache-control"),/no-store/); assert.match(result.headers.get("cache-control"),/private/);
        assert.equal(result.headers.get("vary"),"Cookie, Authorization");
      }
    });
    await t.test("database rejects unsupported ranges, cursor pairs and oversized page limits", async () => {
      const args={p_user_id:userA,p_days:30,p_as_of:NOW.toISOString(),p_before_created_at:null,p_before_id:null,p_limit:20};
      for(const mutation of [{p_days:31},{p_days:null},{p_as_of:"infinity"},{p_limit:21},{p_limit:null},{p_before_id:randomUUID()},{p_before_created_at:"2026-09-01T00:00:00Z",p_before_id:randomUUID()}]) {
        await assert.rejects(databaseRpc(db)("account_usage_statistics",{...args,...mutation}),/invalid account usage/);
      }
    });
  } finally { await db.close(); }
});

test("usage cursor validation and malformed database output fail closed", async () => {
  const app=owner(async()=>{throw new Error("not called")});
  for(const search of ["?days=0","?days=365","?days=7&days=30","?cursor=","?cursor=abc!","?cursor=a&cursor=b"]) assert.equal(query(app,search),null);
  const cursor={version:1,days:30,asOf:NOW.toISOString(),createdAt:"2026-10-21T12:00:00.123456Z",id:randomUUID()};
  const encoded=data=>Buffer.from(JSON.stringify(data)).toString("base64url");
  assert.ok(query(app,`?cursor=${encoded(cursor)}`));
  for(const mutation of [{version:2},{days:7},{asOf:"2026-10-21T13:00:01Z"},{asOf:"2026-10-21T11:00:00Z"},{createdAt:"2026-10-21T14:00:00Z"},{createdAt:"2026-09-01T00:00:00Z"},{id:"not-id"}]) assert.equal(query(app,`?cursor=${encoded({...cursor,...mutation})}`),null);
  for(const createdAt of ["2026-09-31T12:00:00Z","2026-10-21T24:00:00Z","2026-10-21T13:00:00.000001Z"]) {
    assert.equal(query(app,`?cursor=${encoded({...cursor,createdAt})}`),null);
  }
  const precise={...cursor,createdAt:"2026-10-21T12:59:59.999999Z"};
  assert.equal(query(app,`?cursor=${encoded(precise)}`).before.createdAt,precise.createdAt);
  assert.equal(query(app,`?cursor=${encoded({...cursor,asOf:"2026-10-21T13:00:00.000001Z"})}`),null);
  assert.ok(query(app,`?cursor=${encoded({...cursor,asOf:"2026-10-21T12:00:00.000000Z",createdAt:"2026-10-21T11:59:00Z"})}`));
  assert.equal(query(app,`?cursor=${encoded({...cursor,asOf:"2026-10-21T11:59:59.999999Z",createdAt:"2026-10-21T11:59:00Z"})}`),null);
  for(const [year,valid] of [[2024,true],[2025,false]]) {
    const leap={...cursor,asOf:`${year}-03-01T13:00:00.000Z`,createdAt:`${year}-02-29T12:00:00.123456Z`};
    assert.equal(query(app,`?cursor=${encoded(leap)}`,new Date(leap.asOf))!==null,valid);
  }
  const days=Array.from({length:30},(_,i)=>({...zero,date:new Date(Date.parse("2026-09-22T00:00:00Z")+i*86400000).toISOString().slice(0,10)}));
  const good={summary:zero,daily:days,events:[]};
  for(const invalid of [null,{}, {...good,summary:{...zero,creditsDebited:1}}, {...good,summary:{...zero,totalTokens:1}}, {...good,daily:days.slice(1)}, {...good,daily:days.toReversed()}, {...good,events:[{}]}, {...good,summary:{...zero,recordedRequests:Number.MAX_SAFE_INTEGER+1}}]) {
    const bad=owner(async()=>invalid); await assert.rejects(bad.getAccountUsage(randomUUID(),query(bad)),/Invalid account usage response/);
  }
});
