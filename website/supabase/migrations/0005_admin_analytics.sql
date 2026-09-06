begin;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  provider text,
  model text,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  credits integer not null default 0 check (credits >= 0),
  reference text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_created_idx on public.usage_events (created_at desc);
create index if not exists usage_events_user_created_idx on public.usage_events (user_id, created_at desc);

-- Preserve historical request/credit statistics from the ledger. Token totals
-- start being exact once this migration and the updated relay are deployed.
insert into public.usage_events (user_id, action, credits, reference, created_at)
select user_id, type, abs(amount), reference, created_at
from public.credit_transactions
where amount < 0
on conflict (reference) do nothing;

create table if not exists public.admin_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.admin_settings (key, value) values
  ('registration_enabled', 'true'),
  ('support_email', ''),
  ('maintenance_message', '')
on conflict (key) do nothing;

create or replace function public.admin_statistics()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with days as (
    select generate_series(current_date - 6, current_date, interval '1 day')::date as day
  ), daily as (
    select d.day,
      count(distinct u.user_id)::integer as users,
      count(u.id)::integer as requests,
      coalesce(sum(u.credits), 0)::bigint as credits,
      coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)::bigint as tokens
    from days d
    left join public.usage_events u on u.created_at >= d.day and u.created_at < d.day + interval '1 day'
    group by d.day order by d.day
  )
  select jsonb_build_object(
    'total_users', (select count(*) from public.profiles),
    'active_users', (select count(distinct user_id) from public.usage_events),
    'dau', (select count(distinct user_id) from public.usage_events where created_at >= current_date),
    'requests_7d', (select coalesce(sum(requests), 0) from daily),
    'credits_7d', (select coalesce(sum(credits), 0) from daily),
    'tokens_7d', (select coalesce(sum(tokens), 0) from daily),
    'total_tokens', (select coalesce(sum(prompt_tokens + completion_tokens), 0) from public.usage_events),
    'daily', (select jsonb_agg(jsonb_build_object('date', day, 'users', users, 'requests', requests, 'credits', credits, 'tokens', tokens) order by day) from daily)
  );
$$;

alter table public.usage_events enable row level security;
alter table public.admin_settings enable row level security;
revoke all on public.usage_events, public.admin_settings from anon, authenticated;
revoke execute on function public.admin_statistics() from public, anon, authenticated;
grant execute on function public.admin_statistics() to service_role;

commit;
