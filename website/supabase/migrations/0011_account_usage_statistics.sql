begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Read-only aggregation on the existing owners. The relay's event reference is
-- unique, including the 0005 debit backfill; never join it to ledger rows before
-- aggregation. Billing totals come exclusively from the ledger, including
-- linked refunds by their posting date. Welcome/purchase credits are not usage.
create or replace function public.account_usage_statistics(
  p_user_id uuid,
  p_days integer,
  p_as_of timestamptz,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  starts_at timestamptz;
  result jsonb;
begin
  if p_user_id is null or p_days is null or p_days not in (7, 30)
    or p_as_of is null or not isfinite(p_as_of)
    or p_limit is null or p_limit < 1 or p_limit > 20
    or ((p_before_created_at is null) <> (p_before_id is null)) then
    raise exception 'invalid account usage query';
  end if;
  starts_at := (date_trunc('day', p_as_of at time zone 'UTC') - (p_days - 1) * interval '1 day') at time zone 'UTC';
  if p_before_created_at is not null and
    (not isfinite(p_before_created_at) or p_before_created_at < starts_at or p_before_created_at > p_as_of) then
    raise exception 'invalid account usage cursor';
  end if;
  with dates as (
    select (starts_at at time zone 'UTC')::date + day as date
    from generate_series(0, p_days - 1) day
  ), event_days as (
    select (u.created_at at time zone 'UTC')::date as date,
      count(*) as requests,
      sum(u.prompt_tokens)::bigint as prompt_tokens,
      sum(u.completion_tokens)::bigint as completion_tokens
    from public.usage_events u
    where u.user_id = p_user_id and u.created_at >= starts_at and u.created_at <= p_as_of
    group by 1
  ), credit_days as (
    select (t.created_at at time zone 'UTC')::date as date,
      sum(case when t.amount < 0 then -t.amount::bigint else 0 end) as debited,
      sum(case when t.amount > 0 and t.refund_debit_reference is not null then t.amount::bigint else 0 end) as refunded
    from public.credit_transactions t
    where t.user_id = p_user_id and t.created_at >= starts_at and t.created_at <= p_as_of
    group by 1
  ), daily as (
    select d.date, coalesce(e.requests, 0) as requests,
      coalesce(e.prompt_tokens, 0) as prompt_tokens,
      coalesce(e.completion_tokens, 0) as completion_tokens,
      coalesce(c.debited, 0) as debited, coalesce(c.refunded, 0) as refunded
    from dates d left join event_days e using (date) left join credit_days c using (date)
  ), recent as (
    select u.* from public.usage_events u
    where u.user_id = p_user_id and u.created_at >= starts_at and u.created_at <= p_as_of
      and (p_before_created_at is null or (u.created_at, u.id) < (p_before_created_at, p_before_id))
    order by u.created_at desc, u.id desc limit (p_limit + 1)
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
      'recordedRequests', sum(requests), 'promptTokens', sum(prompt_tokens), 'completionTokens', sum(completion_tokens),
      'totalTokens', sum(prompt_tokens + completion_tokens),
      'creditsDebited', sum(debited), 'creditsRefunded', sum(refunded), 'netCreditsUsed', sum(debited - refunded)
    ) from daily),
    'daily', (select jsonb_agg(jsonb_build_object(
      'date', date, 'recordedRequests', requests, 'promptTokens', prompt_tokens, 'completionTokens', completion_tokens,
      'totalTokens', prompt_tokens + completion_tokens,
      'creditsDebited', debited, 'creditsRefunded', refunded, 'netCreditsUsed', debited - refunded
    ) order by date) from daily),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'action', action, 'provider', provider, 'model', model,
      'promptTokens', prompt_tokens, 'completionTokens', completion_tokens,
      'totalTokens', prompt_tokens::bigint + completion_tokens::bigint, 'recordedCredits', credits,
      'createdAt', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) order by created_at desc, id desc), '[]'::jsonb) from recent)
  ) into result;
  return result;
end;
$$;

-- user_id is supplied only by the authenticated API owner. There is deliberately
-- no direct authenticated/anon access to this security-definer function.
revoke execute on function public.account_usage_statistics(uuid, integer, timestamptz, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.account_usage_statistics(uuid, integer, timestamptz, timestamptz, uuid, integer) to service_role;
commit;
