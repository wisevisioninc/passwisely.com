import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createProductionTsLoader } from '../../desktop-api/tests/helpers/production-typescript.mjs';

// Real PostgreSQL PL/pgSQL in an isolated in-memory WASM database, never a live
// account database. PGlite has one exclusive connection: overlapping calls below
// exercise serialized API replays, NOT independent-connection lock contention.
// Official engine/API: https://pglite.dev/docs/ and https://github.com/electric-sql/pglite
const migrations = new URL('../supabase/migrations/', import.meta.url);
const trial = createProductionTsLoader()(fileURLToPath(new URL('../../shared/billing.ts', import.meta.url))).TRIAL_CREDITS;
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const scalar = async (db, sql, args = []) => Object.values(await one(db, sql, args))[0];
const balance = (db, user) => one(db, 'select * from public.get_credit_balance($1)', [user]);
const consume = (db, user, cost, ref, action = 'test') => one(db, 'select * from public.consume_credits($1,$2,$3,$4)', [user, cost, action, ref]);
const refund = (db, user, debit, amount, ref, action = 'refund') => scalar(db, 'select public.refund_credit_debit($1,$2,$3,$4,$5)', [user, debit, amount, action, ref]);
const complete = (db, purchase, event = `event:${purchase}`, transaction = `transaction:${purchase}`) => scalar(db, 'select public.complete_purchase($1,$2,$3,$4)', [purchase, transaction, event, 'test.paid']);
async function user(db) {
  const id = randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [id, `${id}@example.invalid`]);
  return id;
}
async function purchase(db, owner, legacy = false) {
  const id = randomUUID();
  await db.query(`insert into public.purchases(id,user_id,pack_id,credits,amount_minor,provider,merchant_order_no${legacy ? '' : ',credit_policy,validity_days,entitlement_version'})
    values($1,$2,$3,$4,$5,'alipay',$6${legacy ? '' : ", 'expiring',30,2"})`,
    [id, owner, legacy ? 'starter' : 'pro_monthly_v2', legacy ? 100 : 200, legacy ? 900 : 9900, `PW${id.replaceAll('-', '')}`]);
  return id;
}
async function paid(db, owner) {
  const id = await purchase(db, owner);
  assert.equal(await complete(db, id), 'completed');
  return one(db, 'select * from public.credit_grants where purchase_id=$1', [id]);
}
async function expire(db, grant) {
  await db.query("update public.credit_grants set starts_at=clock_timestamp()-interval '31 days',expires_at=clock_timestamp()-interval '1 day' where id=$1", [grant]);
}

// The existing 0001 pgcrypto installation alone is unavailable in this WASM
// build. PostgreSQL's built-in gen_random_uuid is real; no target 0010 statement
// or credit function is removed/substituted. The auth fixture is a platform seam.
async function baseline(db) {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  for (const name of (await readdir(migrations)).filter(name => /^000[1-9]_.*\.sql$/.test(name)).sort()) {
    let sql = await readFile(new URL(name, migrations), 'utf8');
    if (name.startsWith('0001_')) {
      assert.equal(sql.split('create extension if not exists pgcrypto;').length, 2);
      sql = sql.replace('create extension if not exists pgcrypto;', '');
    }
    await db.exec(sql);
  }
}

test('monthly credit migration and real transaction owners', async t => {
  const db = new PGlite();
  try {
    await baseline(db);
    // Supabase production grants these roles table privileges by default.
    // New ledger tables must explicitly remove them instead of relying on
    // PGlite's otherwise-empty default ACL.
    await db.exec('alter default privileges in schema public grant all on tables to service_role, anon, authenticated');
    const oldUser = await user(db);
    const oldPending = await purchase(db, oldUser, true);
    const oldPaidUser = await user(db);
    const oldPaid = await purchase(db, oldPaidUser, true);
    assert.equal(await complete(db, oldPaid), "completed");
    assert.equal((await balanceLegacy()).credits, 10);
    await consume(db, oldUser, 6, 'legacy:debit');
    await scalar(db, 'select public.refund_credits($1,2,$2,$3)', [oldUser, 'old-refund', 'legacy:debit:refund']);
    async function balanceLegacy() { return one(db, 'select credits from public.profiles where id=$1', [oldUser]); }
    const migration = await readFile(new URL('0010_expiring_credit_grants.sql', migrations), 'utf8');
    await db.exec(migration);

    await t.test('existing permanent balance and old pending order keep their original rights; only new users receive 20', async () => {
      assert.equal((await balance(db, oldUser)).balance, 6);
      assert.equal(await complete(db, oldPending), 'completed');
      assert.deepEqual(await balance(db, oldUser), { balance: 106, permanent_balance: 106, expiring_balance: 0, next_expiry: null });
      assert.equal(await scalar(db, 'select count(*)::int from public.credit_grants where user_id=$1', [oldUser]), 0);
      assert.equal(await complete(db, oldPaid), 'duplicate');
      assert.equal((await balance(db, oldPaidUser)).balance, 110);
      assert.equal(await scalar(db, 'select count(*)::int from public.credit_grants where user_id=$1', [oldPaidUser]), 0);
      const fresh = await user(db);
      assert.equal(trial, 20);
      assert.equal((await balance(db, fresh)).balance, trial);
      assert.equal(await scalar(db, "select amount from public.credit_transactions where reference=$1", [`welcome:${fresh}`]), trial);
      assert.equal(await scalar(db, "select amount from public.credit_transactions where reference=$1", [`welcome:${oldUser}`]), 10);
      // The 2-credit historical refund is linked. A new one cannot return >6 total.
      await assert.rejects(refund(db, oldUser, 'legacy:debit', 5, 'legacy:extra'), /exceeds original debit/);
      assert.equal(await refund(db, oldUser, 'legacy:debit', 4, 'legacy:extra'), 110);
    });

    await t.test('payment creates one exact 30-day grant; duplicate or new callback event never resets expiry', async () => {
      const owner = await user(db), grant = await paid(db, owner);
      const paidAt = await scalar(db, 'select completed_at from public.purchases where id=$1', [grant.purchase_id]);
      assert.equal(new Date(grant.starts_at).getTime(), new Date(paidAt).getTime());
      assert.equal(new Date(grant.expires_at) - new Date(grant.starts_at), 30 * 86400000);
      assert.deepEqual(await balance(db, owner), { balance: 220, permanent_balance: 20, expiring_balance: 200, next_expiry: grant.expires_at });
      assert.equal(await complete(db, grant.purchase_id), 'duplicate');
      assert.equal(await complete(db, grant.purchase_id, 'second-event:' + grant.purchase_id), 'duplicate');
      assert.equal(await scalar(db, 'select count(*)::int from public.credit_grants where purchase_id=$1', [grant.purchase_id]), 1);
      assert.deepEqual(await one(db, 'select * from public.credit_grants where id=$1', [grant.id]), grant);
    });

    await t.test('manual repurchase has an independent grant and does not extend the prior grant', async () => {
      const owner = await user(db), first = await paid(db, owner);
      await db.query("update public.credit_grants set starts_at=starts_at-interval '1 day',expires_at=expires_at-interval '1 day' where id=$1", [first.id]);
      const saved = await one(db, 'select * from public.credit_grants where id=$1', [first.id]);
      const second = await paid(db, owner);
      assert.deepEqual(await one(db, 'select * from public.credit_grants where id=$1', [first.id]), saved);
      assert.ok(new Date(second.expires_at) > new Date(saved.expires_at));
      assert.equal((await balance(db, owner)).balance, 420);
    });

    await t.test('debits use earliest expiry before later grants, then permanent credits', async () => {
      const owner = await user(db), first = await paid(db, owner), second = await paid(db, owner);
      // Make the second purchase expire earlier than the first: order of purchase
      // or UUID is not the consumption policy.
      await db.query("update public.credit_grants set expires_at=expires_at-interval '1 day' where id=$1", [second.id]);
      assert.deepEqual(await consume(db, owner, 230, 'priority:' + owner), { success: true, balance: 190, duplicate: false });
      assert.equal(await scalar(db, 'select remaining_credits from public.credit_grants where id=$1', [second.id]), 0);
      assert.equal(await scalar(db, 'select remaining_credits from public.credit_grants where id=$1', [first.id]), 170);
      assert.equal((await balance(db, owner)).permanent_balance, 20);
      assert.equal((await consume(db, owner, 180, 'permanent:' + owner)).balance, 10);
      assert.equal((await balance(db, owner)).permanent_balance, 10);
    });

    await t.test('partial/full refunds restore original allocations in reverse draw order, without extending expiry', async () => {
      const owner = await user(db), grant = await paid(db, owner), debit = 'mixed:' + owner;
      await consume(db, owner, 205, debit);
      assert.equal(await refund(db, owner, debit, 3, debit + ':r1'), 18);
      assert.equal((await balance(db, owner)).permanent_balance, 18);
      assert.equal(await scalar(db, 'select remaining_credits from public.credit_grants where id=$1', [grant.id]), 0);
      assert.equal(await refund(db, owner, debit, 4, debit + ':r2'), 22);
      assert.equal((await balance(db, owner)).permanent_balance, 20);
      assert.equal(await scalar(db, 'select remaining_credits from public.credit_grants where id=$1', [grant.id]), 2);
      await assert.rejects(refund(db, owner, debit, 199, debit + ':too-much'), /exceeds original debit/);
      assert.equal(await refund(db, owner, debit, 198, debit + ':rest'), 220);
      assert.deepEqual(await scalar(db, 'select expires_at from public.credit_grants where id=$1', [grant.id]), grant.expires_at);
    });

    await t.test('expiry boundary is exclusive and refunds to an expired grant never create permanent/new credits', async () => {
      const owner = await user(db), grant = await paid(db, owner), debit = 'expired:' + owner;
      assert.equal(await scalar(db, 'select balance from public.credit_balance_at($1,(select expires_at from public.credit_grants where id=$2))', [owner, grant.id]), 20);
      assert.equal(await scalar(db, "select balance from public.credit_balance_at($1,(select expires_at from public.credit_grants where id=$2)-interval '1 microsecond')", [owner, grant.id]), 220);
      await consume(db, owner, 10, debit);
      await expire(db, grant.id);
      const expiredAt = await scalar(db, 'select expires_at from public.credit_grants where id=$1', [grant.id]);
      assert.equal(await refund(db, owner, debit, 10, debit + ':refund'), 20);
      assert.deepEqual(await balance(db, owner), { balance: 20, permanent_balance: 20, expiring_balance: 0, next_expiry: null });
      assert.equal(await scalar(db, 'select remaining_credits from public.credit_grants where id=$1', [grant.id]), 200);
      assert.deepEqual(await scalar(db, 'select expires_at from public.credit_grants where id=$1', [grant.id]), expiredAt);
      assert.deepEqual(await consume(db, owner, 21, 'insufficient:' + owner), { success: false, balance: 20, duplicate: false });
    });

    await t.test('duplicate debit/refund return current effective balance and reject changed request identity', async () => {
      const owner = await user(db), grant = await paid(db, owner), debit = 'duplicate:' + owner;
      await consume(db, owner, 50, debit);
      await consume(db, owner, 20, debit + ':other');
      assert.deepEqual(await consume(db, owner, 50, debit), { success: true, balance: 150, duplicate: true });
      await assert.rejects(consume(db, owner, 49, debit), /reference conflicts/);
      await assert.rejects(consume(db, owner, 50, debit, 'other-action'), /reference conflicts/);
      assert.equal(await refund(db, owner, debit, 10, debit + ':r'), 160);
      await consume(db, owner, 5, debit + ':later');
      assert.equal(await refund(db, owner, debit, 10, debit + ':r'), 155);
      await assert.rejects(refund(db, owner, debit, 9, debit + ':r'), /reference conflicts/);
      await expire(db, grant.id);
      assert.equal((await consume(db, owner, 50, debit)).balance, 20);
      assert.equal(await refund(db, owner, debit, 10, debit + ':r'), 20);
    });

    await t.test('cross-user references cannot disclose/reuse another debit or refund', async () => {
      const a = await user(db), b = await user(db), ref = 'owned:' + a;
      await consume(db, a, 5, ref);
      await assert.rejects(consume(db, b, 5, ref), /reference conflicts/);
      await assert.rejects(refund(db, b, ref, 1, ref + ':foreign'), /original credit debit not found/);
      assert.equal((await balance(db, b)).balance, 20);
    });

    await t.test('old refund signature restores monthly allocation safely, and malformed reference is rejected', async () => {
      const owner = await user(db), grant = await paid(db, owner), debit = 'resume-agent:' + owner;
      await consume(db, owner, 5, debit);
      assert.equal(await scalar(db, 'select public.refund_credits($1,5,$2,$3)', [owner, 'legacy-refund', debit + ':refund']), 220);
      assert.equal((await balance(db, owner)).permanent_balance, 20);
      assert.equal(await scalar(db, 'select remaining_credits from public.credit_grants where id=$1', [grant.id]), 200);
      await assert.rejects(scalar(db, 'select public.refund_credits($1,5,$2,$3)', [owner, 'bad', 'not-a-debit']), /must identify/);
    });

    await t.test('payment event or provider transaction reuse across orders rolls back every grant/balance mutation', async () => {
      const a = await user(db), b = await user(db), first = await purchase(db, a), second = await purchase(db, b);
      await complete(db, first, 'shared-event', 'shared-transaction');
      await assert.rejects(complete(db, second, 'shared-event', 'second-transaction'), /event conflicts/);
      await assert.rejects(complete(db, second, 'other-event', 'shared-transaction'), /unique constraint/);
      assert.equal((await balance(db, b)).balance, 20);
      assert.equal(await scalar(db, 'select count(*)::int from public.credit_grants where purchase_id=$1', [second]), 0);
      assert.equal(await scalar(db, 'select status from public.purchases where id=$1', [second]), 'pending');
    });

    await t.test('order snapshot is immutable while provider completion status remains writable', async () => {
      const owner = await user(db), id = await purchase(db, owner);
      await assert.rejects(db.query('update public.purchases set credits=201 where id=$1', [id]), /entitlement is immutable/);
      await assert.rejects(db.query("update public.purchases set credit_policy='permanent',validity_days=null,entitlement_version=1 where id=$1", [id]), /entitlement is immutable/);
      assert.equal(await complete(db, id), 'completed');
      const malformed = randomUUID();
      await assert.rejects(db.query(`insert into public.purchases(id,user_id,pack_id,credits,amount_minor,provider,merchant_order_no,credit_policy,validity_days,entitlement_version) values($1,$2,'pro_monthly_v2',200,9900,'alipay',$3,'expiring',null,2)`, [malformed, owner, 'PW' + malformed]), /check constraint/);
    });

    await t.test('overlapping calls serialized by this engine cannot double-charge or exceed a debit refund', async () => {
      const owner = await user(db), ref = 'overlap:' + owner;
      const debits = await Promise.all([consume(db, owner, 15, ref), consume(db, owner, 15, ref)]);
      assert.equal(debits.filter(row => !row.duplicate).length, 1);
      assert.equal((await balance(db, owner)).balance, 5);
      const refunds = await Promise.allSettled([refund(db, owner, ref, 10, ref + ':r1'), refund(db, owner, ref, 10, ref + ':r2')]);
      assert.equal(refunds.filter(row => row.status === 'fulfilled').length, 1);
      assert.equal(refunds.filter(row => row.status === 'rejected').length, 1);
      assert.equal((await balance(db, owner)).balance, 15);
    });

    await t.test('invalid/insufficient requests leave no transaction or allocation', async () => {
      const owner = await user(db);
      for (const cost of [null, 0, -1, 10001]) await assert.rejects(consume(db, owner, cost, 'invalid:' + cost + owner), /invalid credit request/);
      assert.equal((await consume(db, owner, 21, 'too-large:' + owner)).success, false);
      assert.equal(await scalar(db, "select count(*)::int from public.credit_transactions where user_id=$1 and amount<0", [owner]), 0);
    });

    await t.test('only service-role RPCs can read balance or mutate grants; public private helper and tables are denied', async () => {
      const owner = await user(db);
      for (const role of ['anon', 'authenticated']) {
        await db.exec('set role ' + role);
        try {
          await assert.rejects(balance(db, owner), /permission denied/);
          await assert.rejects(consume(db, owner, 1, 'forbidden'), /permission denied/);
          await assert.rejects(db.query('select * from public.credit_grants'), /permission denied/);
        } finally { await db.exec('reset role'); }
      }
      await db.exec('set role service_role');
      try {
        assert.equal((await balance(db, owner)).balance, 20);
        assert.equal((await consume(db, owner, 1, 'service:' + owner)).balance, 19);
        await assert.rejects(db.query('select * from public.credit_balance_at($1,clock_timestamp())', [owner]), /permission denied/);
        await assert.rejects(db.query('select * from public.credit_grants'), /permission denied/);
        await assert.rejects(db.query('select * from public.credit_debit_allocations'), /permission denied/);
      } finally { await db.exec('reset role'); }
    });

    await t.test('admin available credits uses the same balance owner, and reapplying migration changes no rights', async () => {
      const owner = await user(db), grant = await paid(db, owner);
      const expected = await scalar(db, 'select coalesce(sum(b.balance),0)::int from public.profiles p cross join lateral public.get_credit_balance(p.id) b');
      assert.equal((await scalar(db, 'select public.admin_statistics()')).available_credits, expected);
      const before = await balance(db, owner);
      await db.exec(migration);
      assert.deepEqual(await balance(db, owner), before);
      assert.deepEqual(await scalar(db, 'select expires_at from public.credit_grants where id=$1', [grant.id]), grant.expires_at);
      assert.equal((await balance(db, oldUser)).balance, 110);
    });

    await t.test('auth account deletion cascades owned grants/allocations without orphan restrictions', async () => {
      const owner = await user(db), grant = await paid(db, owner);
      await consume(db, owner, 1, 'delete:' + owner);
      await db.query('delete from auth.users where id=$1', [owner]);
      assert.equal(await scalar(db, 'select count(*)::int from public.credit_grants where id=$1', [grant.id]), 0);
      assert.equal(await scalar(db, 'select count(*)::int from public.credit_debit_allocations where debit_reference=$1', ['delete:' + owner]), 0);
    });
  } finally { await db.close(); }
});
