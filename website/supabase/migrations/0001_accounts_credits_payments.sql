begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  locale text not null default 'zh' check (locale in ('zh', 'en')),
  credits integer not null default 10 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email));

create table if not exists public.desktop_sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists desktop_sessions_user_id_idx
  on public.desktop_sessions (user_id);
create index if not exists desktop_sessions_expires_at_idx
  on public.desktop_sessions (expires_at);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  balance_after integer not null check (balance_after >= 0),
  type text not null,
  reference text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pack_id text not null,
  credits integer not null check (credits > 0),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null default 'CNY',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  provider text not null check (provider in ('alipay', 'wechat', 'stripe')),
  merchant_order_no text not null unique,
  provider_transaction_id text,
  stripe_session_id text unique,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists purchases_provider_transaction_unique
  on public.purchases (provider, provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists purchases_user_created_idx
  on public.purchases (user_id, created_at desc);

create table if not exists public.webhook_events (
  id text primary key,
  event_type text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_locale text;
begin
  requested_locale := case
    when new.raw_user_meta_data ->> 'locale' = 'en' then 'en'
    else 'zh'
  end;

  insert into public.profiles (id, email, locale, credits)
  values (new.id, coalesce(new.email, ''), requested_locale, 10)
  on conflict (id) do nothing;

  insert into public.credit_transactions
    (user_id, amount, balance_after, type, reference)
  values (new.id, 10, 10, 'welcome', 'welcome:' || new.id::text)
  on conflict (reference) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.consume_credits(
  p_user_id uuid,
  p_cost integer,
  p_action text,
  p_reference text
)
returns table(success boolean, balance integer, duplicate boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_balance integer;
  existing_balance integer;
begin
  if p_cost <= 0 or p_cost > 100 then
    raise exception 'invalid credit cost';
  end if;

  select p.credits into current_balance
  from public.profiles p
  where p.id = p_user_id
  for update;

  if current_balance is null then
    raise exception 'profile not found';
  end if;

  select t.balance_after into existing_balance
  from public.credit_transactions t
  where t.reference = p_reference;

  if existing_balance is not null then
    return query select true, existing_balance, true;
    return;
  end if;

  if current_balance < p_cost then
    return query select false, current_balance, false;
    return;
  end if;

  current_balance := current_balance - p_cost;
  update public.profiles
  set credits = current_balance, updated_at = now()
  where id = p_user_id;

  insert into public.credit_transactions
    (user_id, amount, balance_after, type, reference)
  values (p_user_id, -p_cost, current_balance, p_action, p_reference);

  return query select true, current_balance, false;
end;
$$;

create or replace function public.complete_purchase(
  p_purchase_id uuid,
  p_transaction_id text,
  p_event_id text,
  p_event_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  purchase_row public.purchases%rowtype;
  new_balance integer;
begin
  if exists (select 1 from public.webhook_events where id = p_event_id) then
    return 'duplicate';
  end if;

  select * into purchase_row
  from public.purchases
  where id = p_purchase_id
  for update;

  if purchase_row.id is null then
    raise exception 'purchase not found';
  end if;

  if purchase_row.status = 'completed'
     and purchase_row.provider_transaction_id = p_transaction_id then
    insert into public.webhook_events (id, event_type)
    values (p_event_id, p_event_type)
    on conflict (id) do nothing;
    return 'duplicate';
  end if;

  if purchase_row.status <> 'pending' then
    raise exception 'purchase is not payable: %', purchase_row.status;
  end if;

  update public.profiles
  set credits = credits + purchase_row.credits, updated_at = now()
  where id = purchase_row.user_id
  returning credits into new_balance;

  insert into public.credit_transactions
    (user_id, amount, balance_after, type, reference)
  values (
    purchase_row.user_id,
    purchase_row.credits,
    new_balance,
    'purchase',
    'purchase:' || purchase_row.id::text
  );

  update public.purchases
  set status = 'completed',
      provider_transaction_id = p_transaction_id,
      completed_at = now()
  where id = purchase_row.id;

  insert into public.webhook_events (id, event_type)
  values (p_event_id, p_event_type);

  return 'completed';
end;
$$;

alter table public.profiles enable row level security;
alter table public.desktop_sessions enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.purchases enable row level security;
alter table public.webhook_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "credit_transactions_select_own" on public.credit_transactions;
create policy "credit_transactions_select_own"
  on public.credit_transactions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "purchases_select_own" on public.purchases;
create policy "purchases_select_own"
  on public.purchases for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.desktop_sessions from anon, authenticated;
revoke all on public.webhook_events from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.credit_transactions from anon, authenticated;
revoke insert, update, delete on public.purchases from anon, authenticated;

revoke execute on function public.consume_credits(uuid, integer, text, text)
  from public, anon, authenticated;
revoke execute on function public.complete_purchase(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, integer, text, text)
  to service_role;
grant execute on function public.complete_purchase(uuid, text, text, text)
  to service_role;

commit;
