-- AmzCentric OS — match hourly Stream data from campaigns the app hasn't seen yet.
--
-- Before: Stream rows were linked to a brand only through the `campaigns` table, which
-- is filled by the daily reports. Campaigns launched today showed up as UNMATCHED
-- until tomorrow's report.
-- Now: if the campaign is unknown, the row is linked through its advertiser +
-- marketplace, learned from this brand's known campaigns (or the profile's
-- account_info_id). Run this once in the Supabase SQL editor.

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
  -- advertiser/marketplace pairs this brand streams under, learned from its known campaigns
  learned as (
    select distinct on (st.advertiser_id, st.marketplace_id)
           st.advertiser_id, st.marketplace_id, k.profile_id
    from public.stream_traffic st
    join known k on k.campaign_id = st.campaign_id
    where st.advertiser_id is not null
      and st.time_window_start >= now() - interval '30 days'
    order by st.advertiser_id, st.marketplace_id, st.time_window_start desc
  ),
  win as (
    select (p_day::timestamp - interval '1 day') at time zone 'UTC' as lo,
           (p_day::timestamp + interval '2 day') at time zone 'UTC' as hi
  ),
  t_rows as (
    select st.time_window_start, st.impressions, st.clicks, st.cost,
           coalesce(k.profile_id, l.profile_id, a.profile_id) as profile_id
    from public.stream_traffic st
    cross join win
    left join known k on k.campaign_id = st.campaign_id
    left join learned l on k.campaign_id is null
                       and l.advertiser_id = st.advertiser_id
                       and l.marketplace_id is not distinct from st.marketplace_id
    left join bp a on k.campaign_id is null and l.profile_id is null
                  and a.account_info_id = st.advertiser_id
    where st.time_window_start >= win.lo and st.time_window_start < win.hi
  ),
  c_rows as (
    select sc.time_window_start, sc.sales, sc.orders,
           coalesce(k.profile_id, l.profile_id, a.profile_id) as profile_id
    from public.stream_conversion sc
    cross join win
    left join known k on k.campaign_id = sc.campaign_id
    left join learned l on k.campaign_id is null
                       and l.advertiser_id = sc.advertiser_id
                       and l.marketplace_id is not distinct from sc.marketplace_id
    left join bp a on k.campaign_id is null and l.profile_id is null
                  and a.account_info_id = sc.advertiser_id
    where sc.time_window_start >= win.lo and sc.time_window_start < win.hi
  ),
  t as (
    select extract(hour from (r.time_window_start at time zone bp.timezone))::int as hour,
           sum(r.impressions) as impressions, sum(r.clicks) as clicks, sum(r.cost) as cost
    from t_rows r
    join bp on bp.profile_id = r.profile_id
    where (r.time_window_start at time zone bp.timezone)::date = p_day
    group by 1
  ),
  c as (
    select extract(hour from (r.time_window_start at time zone bp.timezone))::int as hour,
           sum(r.sales) as sales, sum(r.orders) as orders
    from c_rows r
    join bp on bp.profile_id = r.profile_id
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
