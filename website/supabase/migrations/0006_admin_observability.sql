begin;

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
    'available_credits', (select coalesce(sum(credits), 0) from public.profiles),
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
