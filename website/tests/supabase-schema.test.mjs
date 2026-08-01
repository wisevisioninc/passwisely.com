import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/0001_accounts_credits_payments.sql",
  import.meta.url,
);

test("Supabase schema protects account and credit data", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "profiles",
    "desktop_sessions",
    "credit_transactions",
    "purchases",
    "webhook_events",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /create or replace function public\.consume_credits/);
  assert.match(sql, /for update/);
  assert.match(sql, /p_reference/);
  assert.match(sql, /revoke execute on function public\.consume_credits/);
  assert.match(sql, /grant execute on function public\.consume_credits[\s\S]*to service_role/);
});

test("Supabase schema makes payment crediting idempotent", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.complete_purchase/);
  assert.match(sql, /webhook_events/);
  assert.match(sql, /return 'duplicate'/);
  assert.match(sql, /'purchase:' \|\| purchase_row\.id::text/);
});

test("resume agent history is private and versioned", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/0003_resume_agents.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /create table if not exists public\.resume_documents/);
  assert.match(sql, /create table if not exists public\.resume_agent_runs/);
  assert.match(sql, /unique \(user_id, agent, version\)/);
  assert.match(sql, /resume_documents enable row level security/);
  assert.match(sql, /resume_agent_runs enable row level security/);
  assert.match(sql, /revoke all on public\.resume_agent_runs/);
});
