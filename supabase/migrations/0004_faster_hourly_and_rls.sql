-- AmzCentric OS — make the Hourly page fast at real Marketing Stream volume.
--
-- 1. RLS: `using (public.is_team_member())` was evaluated once PER ROW. Wrapped in a
--    sub-select it becomes an InitPlan evaluated once per query (Supabase's recommended
--    pattern). Matters most on stream_traffic, which grows by ~20k+ rows a day.
-- 2. hourly_summary: learns advertiser → profile from the same 3-day window it is
--    already reading, instead of scanning 30 days of stream rows on every call.
-- Run once in the Supabase SQL editor (safe to re-run).

do $$
declare t text;
begin
  foreach t in array array[
    'app_users', 'brands', 'amazon_profiles', 'report_jobs', 'campaigns', 'campaign_daily',
    'search_term_daily', 'product_daily', 'daily_analytics', 'stream_traffic',
    'stream_conversion', 'action_log', 'goals'
  ] loop
    execute format('drop policy if exists team_read on public.%I', t);
    execute format(
      'create policy team_read on public.%I for select to authenticated using ((select public.is_team_member()))', t);
  end loop;
end $$;

create or replace function public.hourly_summary(p_brand text, p_day date)
returns table (hour int, impressions bigint, clicks bigint, cost numeric, sales numeric, orders bigint)
language sql stable
as $$
  with bp as (
    select profile_id, timezone, account_info_id
    from public.amazon_profiles
    where brand_slug = p_brand and enabled
  ),
  known as (
    select c.campaign_id, c.profile_id
    from public.campaigns c
    join bp on bp.profile_id = c.profile_id
  ),
  win as (
    select (p_day::timestamp - interval '1 day') at time zone 'UTC' as lo,
           (p_day::timestamp + interval '2 day') at time zone 'UTC' as hi
  ),
  traffic_win as (
    select st.* from public.stream_traffic st, win
    where st.time_window_start >= win.lo and st.time_window_start < win.hi
  ),
  conversion_win as (
    select sc.* from public.stream_conversion sc, win
    where sc.time_window_start >= win.lo and sc.time_window_start < win.hi
  ),
  -- advertiser/marketplace pairs this brand streams under, learned from its known campaigns
  learned as (
    select distinct on (tw.advertiser_id, tw.marketplace_id) tw.advertiser_id, tw.marketplace_id, k.profile_id
    from traffic_win tw
    join known k on k.campaign_id = tw.campaign_id
    where tw.advertiser_id is not null
    order by tw.advertiser_id, tw.marketplace_id
  ),
  t_rows as (
    select r.time_window_start, r.impressions, r.clicks, r.cost,
           coalesce(k.profile_id, l.profile_id, a.profile_id) as profile_id
    from traffic_win r
    left join known k on k.campaign_id = r.campaign_id
    left join learned l on k.campaign_id is null
                       and l.advertiser_id = r.advertiser_id
                       and l.marketplace_id is not distinct from r.marketplace_id
    left join bp a on k.campaign_id is null and l.profile_id is null and a.account_info_id = r.advertiser_id
  ),
  c_rows as (
    select r.time_window_start, r.sales, r.orders,
           coalesce(k.profile_id, l.profile_id, a.profile_id) as profile_id
    from conversion_win r
    left join known k on k.campaign_id = r.campaign_id
    left join learned l on k.campaign_id is null
                       and l.advertiser_id = r.advertiser_id
                       and l.marketplace_id is not distinct from r.marketplace_id
    left join bp a on k.campaign_id is null and l.profile_id is null and a.account_info_id = r.advertiser_id
  ),
  t as (
    select extract(hour from (r.time_window_start at time zone bp.timezone))::int as hour,
           sum(r.impressions) as impressions, sum(r.clicks) as clicks, sum(r.cost) as cost
    from t_rows r join bp on bp.profile_id = r.profile_id
    where (r.time_window_start at time zone bp.timezone)::date = p_day
    group by 1
  ),
  c as (
    select extract(hour from (r.time_window_start at time zone bp.timezone))::int as hour,
           sum(r.sales) as sales, sum(r.orders) as orders
    from c_rows r join bp on bp.profile_id = r.profile_id
    where (r.time_window_start at time zone bp.timezone)::date = p_day
    group by 1
  )
  select h.hour,
         coalesce(t.impressions, 0)::bigint, coalesce(t.clicks, 0)::bigint,
         coalesce(t.cost, 0), coalesce(c.sales, 0), coalesce(c.orders, 0)::bigint
  from generate_series(0, 23) as h(hour)
  left join t on t.hour = h.hour
  left join c on c.hour = h.hour
  order by h.hour;
$$;

grant execute on function public.hourly_summary(text, date) to authenticated, service_role;
create index if not exists stream_traffic_window_idx on public.stream_traffic (time_window_start);
create index if not exists stream_conversion_window_idx on public.stream_conversion (time_window_start);
