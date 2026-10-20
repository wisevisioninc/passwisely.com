begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Existing profiles.credits and legacy orders remain permanent. Only new orders
-- explicitly snapshot the expiring policy; changing today's catalog cannot
-- change an already-created order's rights.
alter table public.profiles alter column credits set default 20;
alter table public.purchases
  add column if not exists credit_policy text not null default 'permanent',
  add column if not exists validity_days integer,
  add column if not exists entitlement_version integer not null default 1;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.purchases'::regclass and conname = 'purchases_credit_policy_check') then
    alter table public.purchases add constraint purchases_credit_policy_check check (
      (credit_policy = 'permanent' and validity_days is null and entitlement_version = 1)
      or (credit_policy = 'expiring' and validity_days is not null and validity_days = 30 and entitlement_version = 2)
    );
  end if;
end;
$$;

create or replace function public.protect_purchase_entitlement()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.user_id, new.pack_id, new.credits, new.amount_minor, new.currency,
         new.provider, new.merchant_order_no, new.credit_policy, new.validity_days,
         new.entitlement_version, new.created_at)
     is distinct from
     row(old.user_id, old.pack_id, old.credits, old.amount_minor, old.currency,
         old.provider, old.merchant_order_no, old.credit_policy, old.validity_days,
         old.entitlement_version, old.created_at) then
    raise exception 'purchase entitlement is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_purchase_entitlement on public.purchases;
create trigger protect_purchase_entitlement before update on public.purchases
  for each row execute function public.protect_purchase_entitlement();

alter table public.credit_transactions
  add column if not exists bucket_version integer not null default 1,
  add column if not exists refund_debit_reference text references public.credit_transactions(reference) on delete cascade;
-- Before this migration all debits were permanent. Preserve their existing
-- known refunds so a retry/new refund cannot return more than the original cost.
update public.credit_transactions r
set refund_debit_reference = d.reference
from public.credit_transactions d
where r.refund_debit_reference is null and r.amount > 0 and d.amount < 0
  and r.user_id = d.user_id
  and r.reference ~ ':(refund|settlement)$'
  and d.reference = regexp_replace(r.reference, ':(refund|settlement)$', '');

alter table public.webhook_events
  add column if not exists purchase_id uuid references public.purchases(id) on delete set null,
  add column if not exists provider_transaction_id text;

create table if not exists public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_id uuid not null unique references public.purchases(id) on delete cascade,
  granted_credits integer not null check (granted_credits > 0),
  remaining_credits integer not null check (remaining_credits >= 0 and remaining_credits <= granted_credits),
  starts_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > starts_at),
  created_at timestamptz not null default now()
);
create index if not exists credit_grants_available_idx
  on public.credit_grants(user_id, expires_at, id) where remaining_credits > 0;

create table if not exists public.credit_debit_allocations (
  id bigint generated always as identity primary key,
  debit_reference text not null references public.credit_transactions(reference) on delete cascade,
  grant_id uuid references public.credit_grants(id) on delete cascade,
  amount integer not null check (amount > 0),
  refunded_amount integer not null default 0 check (refunded_amount >= 0 and refunded_amount <= amount),
  unique(debit_reference, grant_id)
);
create unique index if not exists credit_debit_allocations_permanent_unique
  on public.credit_debit_allocations(debit_reference) where grant_id is null;
create index if not exists credit_transactions_refund_debit_idx
  on public.credit_transactions(refund_debit_reference) where refund_debit_reference is not null;

-- The only interpretation of effective balance/expiry. Transaction owners pass
-- one DB timestamp captured AFTER acquiring the per-user lock. Public reads use
-- the same owner, with no expiry job or client-side aggregation required.
create or replace function public.credit_balance_at(p_user_id uuid, p_at timestamptz)
returns table(balance integer, permanent_balance integer, expiring_balance integer, next_expiry timestamptz)
language sql stable security definer set search_path = '' as $$
  select (p.credits::bigint + coalesce(g.available, 0))::integer,
         p.credits, coalesce(g.available, 0)::integer, g.next_expiry
  from public.profiles p
  left join lateral (
    select sum(c.remaining_credits) as available, min(c.expires_at) as next_expiry
    from public.credit_grants c
    where c.user_id = p.id and c.remaining_credits > 0
      and c.starts_at <= p_at and c.expires_at > p_at
  ) g on true
  where p.id = p_user_id;
$$;
create or replace function public.get_credit_balance(p_user_id uuid)
returns table(balance integer, permanent_balance integer, expiring_balance integer, next_expiry timestamptz)
language sql volatile security definer set search_path = '' as $$
  select * from public.credit_balance_at(p_user_id, clock_timestamp());
$$;

create or replace function public.consume_credits(
  p_user_id uuid, p_cost integer, p_action text, p_reference text
)
returns table(success boolean, balance integer, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
declare
  permanent integer;
  current_balance integer;
  existing public.credit_transactions%rowtype;
  grant_row public.credit_grants%rowtype;
  outstanding integer;
  taken integer;
  at_time timestamptz;
begin
  if p_cost is null or p_cost <= 0 or p_cost > 10000
     or p_action is null or p_action = '' or p_reference is null or p_reference = '' then
    raise exception 'invalid credit request';
  end if;
  select p.credits into permanent from public.profiles p where p.id = p_user_id for update;
  if not found then raise exception 'profile not found'; end if;
  at_time := clock_timestamp();
  select b.balance into current_balance from public.credit_balance_at(p_user_id, at_time) b;
  select * into existing from public.credit_transactions t where t.reference = p_reference;
  if found then
    if existing.user_id <> p_user_id or existing.amount <> -p_cost
       or existing.type <> p_action or existing.refund_debit_reference is not null then
      raise exception 'credit reference conflicts with another request';
    end if;
    return query select true, current_balance, true;
    return;
  end if;
  if current_balance < p_cost then
    return query select false, current_balance, false;
    return;
  end if;
  insert into public.credit_transactions(user_id, amount, balance_after, type, reference, bucket_version)
    values(p_user_id, -p_cost, current_balance - p_cost, p_action, p_reference, 2);
  outstanding := p_cost;
  for grant_row in
    select * from public.credit_grants g
    where g.user_id = p_user_id and g.remaining_credits > 0
      and g.starts_at <= at_time and g.expires_at > at_time
    order by g.expires_at, g.starts_at, g.id for update
  loop
    exit when outstanding = 0;
    taken := least(outstanding, grant_row.remaining_credits);
    update public.credit_grants set remaining_credits = remaining_credits - taken where id = grant_row.id;
    insert into public.credit_debit_allocations(debit_reference, grant_id, amount)
      values(p_reference, grant_row.id, taken);
    outstanding := outstanding - taken;
  end loop;
  if outstanding > 0 then
    update public.profiles set credits = credits - outstanding, updated_at = at_time where id = p_user_id;
    insert into public.credit_debit_allocations(debit_reference, grant_id, amount)
      values(p_reference, null, outstanding);
  end if;
  return query select true, current_balance - p_cost, false;
end;
$$;

create or replace function public.refund_credit_debit(
  p_user_id uuid, p_debit_reference text, p_amount integer, p_action text, p_reference text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  debit public.credit_transactions%rowtype;
  existing public.credit_transactions%rowtype;
  allocation public.credit_debit_allocations%rowtype;
  at_time timestamptz;
  current_balance integer;
  prior_refunds bigint;
  allocated bigint;
  allocated_refunds bigint;
  outstanding integer;
  restored integer;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 10000
     or p_action is null or p_action = '' or p_reference is null or p_reference = ''
     or p_debit_reference is null or p_debit_reference = '' then
    raise exception 'invalid refund request';
  end if;
  perform 1 from public.profiles p where p.id = p_user_id for update;
  if not found then raise exception 'profile not found'; end if;
  at_time := clock_timestamp();
  select * into debit from public.credit_transactions t where t.reference = p_debit_reference;
  if not found or debit.user_id <> p_user_id or debit.amount >= 0 then
    raise exception 'original credit debit not found';
  end if;
  select * into existing from public.credit_transactions t where t.reference = p_reference;
  if found then
    if existing.user_id <> p_user_id or existing.amount <> p_amount
       or existing.type <> p_action or existing.refund_debit_reference is distinct from p_debit_reference then
      raise exception 'refund reference conflicts with another request';
    end if;
    select b.balance into current_balance from public.credit_balance_at(p_user_id, at_time) b;
    return current_balance;
  end if;
  select coalesce(sum(t.amount), 0) into prior_refunds
    from public.credit_transactions t where t.refund_debit_reference = p_debit_reference;
  if prior_refunds + p_amount > -debit.amount then raise exception 'refund exceeds original debit'; end if;
  if debit.bucket_version = 1 then
    -- Legacy debits only ever used profiles.credits; their original permanence
    -- is preserved without synthesizing a new monthly grant.
    update public.profiles set credits = credits + p_amount, updated_at = at_time where id = p_user_id;
  elsif debit.bucket_version = 2 then
    select coalesce(sum(a.amount),0), coalesce(sum(a.refunded_amount),0)
      into allocated, allocated_refunds from public.credit_debit_allocations a
      where a.debit_reference = p_debit_reference;
    if allocated <> -debit.amount or allocated_refunds <> prior_refunds then
      raise exception 'credit debit allocation mismatch';
    end if;
    outstanding := p_amount;
    -- Reverse the original draw order: partial settlement preserves the
    -- earliest-expiring-first allocation of the final actual charge.
    for allocation in
      select * from public.credit_debit_allocations a
      where a.debit_reference = p_debit_reference and a.refunded_amount < a.amount
      order by a.id desc for update
    loop
      exit when outstanding = 0;
      restored := least(outstanding, allocation.amount - allocation.refunded_amount);
      if allocation.grant_id is null then
        update public.profiles set credits = credits + restored, updated_at = at_time where id = p_user_id;
      else
        update public.credit_grants set remaining_credits = remaining_credits + restored
          where id = allocation.grant_id and user_id = p_user_id;
        if not found then raise exception 'original credit grant not found'; end if;
        -- Expired grants remain expired: neither timestamps nor the permanent
        -- balance are changed by restoring their recorded remaining amount.
      end if;
      update public.credit_debit_allocations set refunded_amount = refunded_amount + restored where id = allocation.id;
      outstanding := outstanding - restored;
    end loop;
    if outstanding <> 0 then raise exception 'credit refund allocation incomplete'; end if;
  else
    raise exception 'unknown credit debit version';
  end if;
  select b.balance into current_balance from public.credit_balance_at(p_user_id, at_time) b;
  insert into public.credit_transactions(user_id, amount, balance_after, type, reference, bucket_version, refund_debit_reference)
    values(p_user_id, p_amount, current_balance, p_action, p_reference, 2, p_debit_reference);
  return current_balance;
end;
$$;

-- Compatibility for the two old Agent callers, including an old runtime kept
-- for deployment rollback. No same-name overload/default-parameter ambiguity.
create or replace function public.refund_credits(
  p_user_id uuid, p_amount integer, p_action text, p_reference text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  debit_reference text;
begin
  if p_reference is null or p_reference !~ ':(refund|settlement)$' then
    raise exception 'refund must identify its original debit';
  end if;
  debit_reference := regexp_replace(p_reference, ':(refund|settlement)$', '');
  return public.refund_credit_debit(p_user_id, debit_reference, p_amount, p_action, p_reference);
end;
$$;

create or replace function public.complete_purchase(
  p_purchase_id uuid, p_transaction_id text, p_event_id text, p_event_type text
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  purchase_row public.purchases%rowtype;
  event_row public.webhook_events%rowtype;
  at_time timestamptz;
  new_balance integer;
begin
  if p_transaction_id is null or p_transaction_id = '' or p_event_id is null or p_event_id = ''
     or p_event_type is null or p_event_type = '' then raise exception 'invalid payment completion'; end if;
  select * into purchase_row from public.purchases where id = p_purchase_id for update;
  if not found then raise exception 'purchase not found'; end if;
  select * into event_row from public.webhook_events where id = p_event_id;
  if found then
    if purchase_row.status <> 'completed' or purchase_row.provider_transaction_id is distinct from p_transaction_id
       or (event_row.purchase_id is not null and event_row.purchase_id <> p_purchase_id)
       or (event_row.provider_transaction_id is not null and event_row.provider_transaction_id <> p_transaction_id)
       or event_row.event_type <> p_event_type then raise exception 'payment event conflicts with another purchase'; end if;
    return 'duplicate';
  end if;
  if purchase_row.status = 'completed' and purchase_row.provider_transaction_id = p_transaction_id then
    insert into public.webhook_events(id,event_type,purchase_id,provider_transaction_id)
      values(p_event_id,p_event_type,p_purchase_id,p_transaction_id);
    return 'duplicate';
  end if;
  if purchase_row.status <> 'pending' then raise exception 'purchase is not payable'; end if;
  perform 1 from public.profiles p where p.id = purchase_row.user_id for update;
  if not found then raise exception 'profile not found'; end if;
  at_time := clock_timestamp();
  if purchase_row.credit_policy = 'permanent' and purchase_row.entitlement_version = 1
     and purchase_row.validity_days is null then
    update public.profiles set credits = credits + purchase_row.credits, updated_at = at_time
      where id = purchase_row.user_id;
  elsif purchase_row.credit_policy = 'expiring' and purchase_row.entitlement_version = 2
        and purchase_row.validity_days = 30 then
    insert into public.credit_grants(user_id,purchase_id,granted_credits,remaining_credits,starts_at,expires_at)
      values(purchase_row.user_id,purchase_row.id,purchase_row.credits,purchase_row.credits,
             at_time,at_time + interval '30 days');
  else raise exception 'unsupported purchase entitlement';
  end if;
  select b.balance into new_balance from public.credit_balance_at(purchase_row.user_id, at_time) b;
  insert into public.credit_transactions(user_id,amount,balance_after,type,reference,bucket_version)
    values(purchase_row.user_id,purchase_row.credits,new_balance,'purchase','purchase:' || purchase_row.id::text,2);
  update public.purchases set status='completed',provider_transaction_id=p_transaction_id,completed_at=at_time
    where id=purchase_row.id;
  insert into public.webhook_events(id,event_type,purchase_id,provider_transaction_id)
    values(p_event_id,p_event_type,p_purchase_id,p_transaction_id);
  return 'completed';
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare requested_locale text;
begin
  requested_locale := case when new.raw_user_meta_data ->> 'locale' = 'en' then 'en' else 'zh' end;
  insert into public.profiles(id,email,locale,credits)
    values(new.id,coalesce(new.email,''),requested_locale,20) on conflict(id) do nothing;
  insert into public.credit_transactions(user_id,amount,balance_after,type,reference)
    values(new.id,20,20,'welcome','welcome:' || new.id::text) on conflict(reference) do nothing;
  return new;
end;
$$;

alter table public.credit_grants enable row level security;
alter table public.credit_debit_allocations enable row level security;
revoke all on public.credit_grants from public,anon,authenticated,service_role;
revoke all on public.credit_debit_allocations from public,anon,authenticated,service_role;
revoke execute on function public.protect_purchase_entitlement() from public,anon,authenticated;
revoke execute on function public.credit_balance_at(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke execute on function public.get_credit_balance(uuid) from public,anon,authenticated;
revoke execute on function public.consume_credits(uuid,integer,text,text) from public,anon,authenticated;
revoke execute on function public.refund_credit_debit(uuid,text,integer,text,text) from public,anon,authenticated;
revoke execute on function public.refund_credits(uuid,integer,text,text) from public,anon,authenticated;
revoke execute on function public.complete_purchase(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.get_credit_balance(uuid) to service_role;
grant execute on function public.consume_credits(uuid,integer,text,text) to service_role;
grant execute on function public.refund_credit_debit(uuid,text,integer,text,text) to service_role;
grant execute on function public.refund_credits(uuid,integer,text,text) to service_role;
grant execute on function public.complete_purchase(uuid,text,text,text) to service_role;

create or replace function public.admin_statistics()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with bounds as (
    select
      timezone('Asia/Shanghai', now())::date as today,
      (timezone('Asia/Shanghai', now())::date at time zone 'Asia/Shanghai') as today_start,
      ((timezone('Asia/Shanghai', now())::date - 6) at time zone 'Asia/Shanghai') as seven_day_start,
      ((timezone('Asia/Shanghai', now())::date - 29) at time zone 'Asia/Shanghai') as thirty_day_start
  ), days as (
    select generate_series(b.today - 13, b.today, interval '1 day')::date as day
    from bounds b
  ), daily as (
    select
      d.day,
      (select count(*) from public.profiles p
        where p.created_at >= d.day at time zone 'Asia/Shanghai'
          and p.created_at < (d.day + 1) at time zone 'Asia/Shanghai')::integer as new_users,
      (select count(distinct u.user_id) from public.usage_events u
        where u.created_at >= d.day at time zone 'Asia/Shanghai'
          and u.created_at < (d.day + 1) at time zone 'Asia/Shanghai')::integer as users,
      (select count(*) from public.usage_events u
        where u.created_at >= d.day at time zone 'Asia/Shanghai'
          and u.created_at < (d.day + 1) at time zone 'Asia/Shanghai')::integer as requests,
      (select coalesce(sum(u.credits), 0) from public.usage_events u
        where u.created_at >= d.day at time zone 'Asia/Shanghai'
          and u.created_at < (d.day + 1) at time zone 'Asia/Shanghai')::bigint as credits,
      (select coalesce(sum(u.prompt_tokens + u.completion_tokens), 0) from public.usage_events u
        where u.created_at >= d.day at time zone 'Asia/Shanghai'
          and u.created_at < (d.day + 1) at time zone 'Asia/Shanghai')::bigint as tokens,
      (select coalesce(sum(p.amount_minor), 0) from public.purchases p
        where p.status = 'completed'
          and p.completed_at >= d.day at time zone 'Asia/Shanghai'
          and p.completed_at < (d.day + 1) at time zone 'Asia/Shanghai')::bigint as revenue,
      (select count(*) from public.purchases p
        where p.status = 'completed'
          and p.completed_at >= d.day at time zone 'Asia/Shanghai'
          and p.completed_at < (d.day + 1) at time zone 'Asia/Shanghai')::integer as orders
    from days d
    order by d.day
  ), action_breakdown as (
    select coalesce(u.action, 'unknown') as label, count(*)::integer as value
    from public.usage_events u, bounds b
    where u.created_at >= b.thirty_day_start
    group by u.action
    order by count(*) desc, u.action
    limit 8
  ), provider_breakdown as (
    select coalesce(u.provider, 'other') as label, count(*)::integer as value
    from public.usage_events u, bounds b
    where u.created_at >= b.thirty_day_start
    group by u.provider
    order by count(*) desc, u.provider
    limit 8
  ), payment_breakdown as (
    select
      p.provider as label,
      count(*)::integer as attempts,
      count(*) filter (where p.status = 'completed')::integer as completed,
      coalesce(sum(p.amount_minor) filter (where p.status = 'completed'), 0)::bigint as revenue
    from public.purchases p, bounds b
    where p.created_at >= b.thirty_day_start
    group by p.provider
    order by count(*) desc, p.provider
  )
  select jsonb_build_object(
    'generated_at', now(),
    'total_users', (select count(*) from public.profiles),
    'active_users', (select count(distinct user_id) from public.usage_events),
    'new_users_today', (select count(*) from public.profiles p, bounds b where p.created_at >= b.today_start),
    'new_users_7d', (select count(*) from public.profiles p, bounds b where p.created_at >= b.seven_day_start),
    'new_users_30d', (select count(*) from public.profiles p, bounds b where p.created_at >= b.thirty_day_start),
    'dau', (select count(distinct u.user_id) from public.usage_events u, bounds b where u.created_at >= b.today_start),
    'wau', (select count(distinct u.user_id) from public.usage_events u, bounds b where u.created_at >= b.seven_day_start),
    'mau', (select count(distinct u.user_id) from public.usage_events u, bounds b where u.created_at >= b.thirty_day_start),
    'online_sessions', (select count(distinct user_id) from public.desktop_sessions where expires_at > now()),
    'requests_today', (select count(*) from public.usage_events u, bounds b where u.created_at >= b.today_start),
    'requests_7d', (select count(*) from public.usage_events u, bounds b where u.created_at >= b.seven_day_start),
    'requests_30d', (select count(*) from public.usage_events u, bounds b where u.created_at >= b.thirty_day_start),
    'credits_today', (select coalesce(sum(u.credits), 0) from public.usage_events u, bounds b where u.created_at >= b.today_start),
    'credits_7d', (select coalesce(sum(u.credits), 0) from public.usage_events u, bounds b where u.created_at >= b.seven_day_start),
    'credits_30d', (select coalesce(sum(u.credits), 0) from public.usage_events u, bounds b where u.created_at >= b.thirty_day_start),
    'available_credits', (select coalesce(sum(b.balance), 0) from public.profiles p cross join lateral public.get_credit_balance(p.id) b),
    'tokens_today', (select coalesce(sum(u.prompt_tokens + u.completion_tokens), 0) from public.usage_events u, bounds b where u.created_at >= b.today_start),
    'tokens_7d', (select coalesce(sum(u.prompt_tokens + u.completion_tokens), 0) from public.usage_events u, bounds b where u.created_at >= b.seven_day_start),
    'tokens_30d', (select coalesce(sum(u.prompt_tokens + u.completion_tokens), 0) from public.usage_events u, bounds b where u.created_at >= b.thirty_day_start),
    'total_tokens', (select coalesce(sum(prompt_tokens + completion_tokens), 0) from public.usage_events),
    'revenue_today', (select coalesce(sum(p.amount_minor), 0) from public.purchases p, bounds b where p.status = 'completed' and p.completed_at >= b.today_start),
    'revenue_7d', (select coalesce(sum(p.amount_minor), 0) from public.purchases p, bounds b where p.status = 'completed' and p.completed_at >= b.seven_day_start),
    'revenue_30d', (select coalesce(sum(p.amount_minor), 0) from public.purchases p, bounds b where p.status = 'completed' and p.completed_at >= b.thirty_day_start),
    'total_revenue', (select coalesce(sum(amount_minor), 0) from public.purchases where status = 'completed'),
    'completed_orders_30d', (select count(*) from public.purchases p, bounds b where p.status = 'completed' and p.completed_at >= b.thirty_day_start),
    'pending_orders', (select count(*) from public.purchases where status in ('pending', 'processing')),
    'failed_orders_30d', (select count(*) from public.purchases p, bounds b where p.status = 'failed' and p.created_at >= b.thirty_day_start),
    'paying_users_30d', (select count(distinct p.user_id) from public.purchases p, bounds b where p.status = 'completed' and p.completed_at >= b.thirty_day_start),
    'payment_success_rate_30d', (
      select case when count(*) filter (where p.status in ('completed', 'failed')) = 0 then 0
        else round(100.0 * count(*) filter (where p.status = 'completed') / count(*) filter (where p.status in ('completed', 'failed')), 1)
      end
      from public.purchases p, bounds b where p.created_at >= b.thirty_day_start
    ),
    'resume_documents', (select count(*) from public.resume_documents),
    'resume_runs_30d', (select count(*) from public.resume_agent_runs r, bounds b where r.created_at >= b.thirty_day_start),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
      'date', day, 'newUsers', new_users, 'users', users, 'requests', requests,
      'credits', credits, 'tokens', tokens, 'revenue', revenue, 'orders', orders
    ) order by day), '[]'::jsonb) from daily),
    'action_breakdown', (select coalesce(jsonb_agg(to_jsonb(action_breakdown)), '[]'::jsonb) from action_breakdown),
    'provider_breakdown', (select coalesce(jsonb_agg(to_jsonb(provider_breakdown)), '[]'::jsonb) from provider_breakdown),
    'payment_breakdown', (select coalesce(jsonb_agg(to_jsonb(payment_breakdown)), '[]'::jsonb) from payment_breakdown)
  );
$$;

revoke execute on function public.admin_statistics() from public, anon, authenticated;
grant execute on function public.admin_statistics() to service_role;


commit;
