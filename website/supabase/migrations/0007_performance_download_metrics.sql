begin;

create table if not exists public.service_request_minutes (
  bucket timestamptz not null,
  route text not null,
  requests bigint not null default 0 check (requests >= 0),
  errors bigint not null default 0 check (errors >= 0),
  duration_ms_total bigint not null default 0 check (duration_ms_total >= 0),
  max_duration_ms integer not null default 0 check (max_duration_ms >= 0),
  primary key (bucket, route)
);

create index if not exists service_request_minutes_bucket_idx
  on public.service_request_minutes (bucket desc);

create table if not exists public.download_events (
  id bigint generated always as identity primary key,
  platform text not null check (platform in ('mac-arm64', 'mac-x64', 'windows-x64')),
  source text not null default 'website' check (source in ('website', 'direct')),
  created_at timestamptz not null default now()
);

create index if not exists download_events_created_idx
  on public.download_events (created_at desc);
create index if not exists download_events_platform_created_idx
  on public.download_events (platform, created_at desc);

create table if not exists public.download_performance_samples (
  id bigint generated always as identity primary key,
  platform text not null check (platform in ('mac-arm64', 'mac-x64', 'windows-x64')),
  status text not null check (status in ('healthy', 'down')),
  object_bytes bigint not null default 0 check (object_bytes >= 0),
  head_latency_ms integer not null default 0 check (head_latency_ms >= 0),
  ttfb_ms integer not null default 0 check (ttfb_ms >= 0),
  sample_bytes integer not null default 0 check (sample_bytes >= 0),
  transfer_ms integer not null default 0 check (transfer_ms >= 0),
  throughput_bps bigint not null default 0 check (throughput_bps >= 0),
  estimated_seconds numeric(12,2) not null default 0 check (estimated_seconds >= 0),
  http_status integer,
  created_at timestamptz not null default now()
);

create index if not exists download_performance_platform_created_idx
  on public.download_performance_samples (platform, created_at desc);

create or replace function public.record_service_metrics(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 50 then
    raise exception 'invalid service metrics batch';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.service_request_minutes
      (bucket, route, requests, errors, duration_ms_total, max_duration_ms)
    values (
      date_trunc('minute', (item ->> 'bucket')::timestamptz),
      left(coalesce(item ->> 'route', 'other'), 80),
      greatest(0, least(100000, coalesce((item ->> 'requests')::bigint, 0))),
      greatest(0, least(100000, coalesce((item ->> 'errors')::bigint, 0))),
      greatest(0, least(864000000, coalesce((item ->> 'durationMsTotal')::bigint, 0))),
      greatest(0, least(600000, coalesce((item ->> 'maxDurationMs')::integer, 0)))
    )
    on conflict (bucket, route) do update set
      requests = public.service_request_minutes.requests + excluded.requests,
      errors = public.service_request_minutes.errors + excluded.errors,
      duration_ms_total = public.service_request_minutes.duration_ms_total + excluded.duration_ms_total,
      max_duration_ms = greatest(public.service_request_minutes.max_duration_ms, excluded.max_duration_ms);
  end loop;

  delete from public.service_request_minutes where bucket < now() - interval '90 days';
end;
$$;

create or replace function public.admin_performance_statistics()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with minute_series as (
    select generate_series(
      date_trunc('minute', now()) - interval '59 minutes',
      date_trunc('minute', now()), interval '1 minute'
    ) as minute
  ), minute_totals as (
    select
      series.minute,
      coalesce(sum(metric.requests), 0)::bigint as requests,
      coalesce(sum(metric.errors), 0)::bigint as errors,
      coalesce(sum(metric.duration_ms_total), 0)::bigint as duration_ms_total,
      coalesce(max(metric.max_duration_ms), 0)::integer as max_duration_ms
    from minute_series series
    left join public.service_request_minutes metric on metric.bucket = series.minute
    group by series.minute order by series.minute
  ), route_breakdown as (
    select route as label, sum(requests)::bigint as requests,
      sum(errors)::bigint as errors,
      case when sum(requests) = 0 then 0 else round(sum(duration_ms_total)::numeric / sum(requests), 1) end as avg_latency_ms
    from public.service_request_minutes
    where bucket >= now() - interval '24 hours'
    group by route order by sum(requests) desc limit 10
  ), download_breakdown as (
    select platform as label,
      count(*)::bigint as total,
      count(*) filter (where created_at >= timezone('Asia/Shanghai', now())::date at time zone 'Asia/Shanghai')::bigint as today,
      count(*) filter (where created_at >= (timezone('Asia/Shanghai', now())::date - 6) at time zone 'Asia/Shanghai')::bigint as seven_days
    from public.download_events group by platform order by count(*) desc
  ), latest_downloads as (
    select distinct on (platform)
      platform, status, object_bytes, head_latency_ms, ttfb_ms, sample_bytes,
      transfer_ms, throughput_bps, estimated_seconds, http_status, created_at
    from public.download_performance_samples
    order by platform, created_at desc
  )
  select jsonb_build_object(
    'qps_current', (select round(coalesce(sum(requests), 0)::numeric / 300, 3) from minute_totals where minute >= date_trunc('minute', now()) - interval '4 minutes'),
    'qps_peak_1h', (select round(coalesce(max(requests), 0)::numeric / 60, 3) from minute_totals),
    'requests_5m', (select coalesce(sum(requests), 0) from minute_totals where minute >= date_trunc('minute', now()) - interval '4 minutes'),
    'avg_latency_ms_5m', (select case when sum(requests) = 0 then 0 else round(sum(duration_ms_total)::numeric / sum(requests), 1) end from minute_totals where minute >= date_trunc('minute', now()) - interval '4 minutes'),
    'max_latency_ms_5m', (select coalesce(max(max_duration_ms), 0) from minute_totals where minute >= date_trunc('minute', now()) - interval '4 minutes'),
    'error_rate_5m', (select case when sum(requests) = 0 then 0 else round(100.0 * sum(errors) / sum(requests), 2) end from minute_totals where minute >= date_trunc('minute', now()) - interval '4 minutes'),
    'downloads_today', (select count(*) from public.download_events where created_at >= timezone('Asia/Shanghai', now())::date at time zone 'Asia/Shanghai'),
    'downloads_7d', (select count(*) from public.download_events where created_at >= (timezone('Asia/Shanghai', now())::date - 6) at time zone 'Asia/Shanghai'),
    'downloads_total', (select count(*) from public.download_events),
    'request_series', (select coalesce(jsonb_agg(jsonb_build_object('minute', minute, 'requests', requests, 'errors', errors, 'avgLatencyMs', case when requests = 0 then 0 else round(duration_ms_total::numeric / requests, 1) end) order by minute), '[]'::jsonb) from minute_totals),
    'route_breakdown', (select coalesce(jsonb_agg(to_jsonb(route_breakdown)), '[]'::jsonb) from route_breakdown),
    'download_breakdown', (select coalesce(jsonb_agg(to_jsonb(download_breakdown)), '[]'::jsonb) from download_breakdown),
    'download_performance', (select coalesce(jsonb_agg(to_jsonb(latest_downloads) order by platform), '[]'::jsonb) from latest_downloads)
  );
$$;

alter table public.service_request_minutes enable row level security;
alter table public.download_events enable row level security;
alter table public.download_performance_samples enable row level security;
revoke all on public.service_request_minutes, public.download_events, public.download_performance_samples from public, anon, authenticated;
revoke execute on function public.record_service_metrics(jsonb) from public, anon, authenticated;
revoke execute on function public.admin_performance_statistics() from public, anon, authenticated;
grant execute on function public.record_service_metrics(jsonb) to service_role;
grant execute on function public.admin_performance_statistics() to service_role;

commit;
