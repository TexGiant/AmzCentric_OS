-- AmzCentric OS — Reports tab: room for SP-API total orders.
-- total_sales / total_units / sessions already exist on daily_analytics; total_orders joins them.
-- All four stay empty until the SP-API Sales & Traffic report is connected.
-- Run once in the Supabase SQL editor (safe to re-run).

alter table public.daily_analytics add column if not exists total_orders int;

-- brand_daily now also returns the SP-API totals (return type changed → drop + create).
drop function if exists public.brand_daily(text, date, date);
create function public.brand_daily(p_brand text, p_from date, p_to date)
returns table (date date, impressions bigint, clicks bigint, cost numeric, sales numeric,
               orders bigint, units bigint, total_sales numeric, total_orders bigint, total_units bigint)
language sql stable
as $$
  select d.date,
         sum(d.impressions)::bigint, sum(d.clicks)::bigint,
         sum(d.ad_cost), sum(d.ad_sales),
         sum(d.ad_orders)::bigint, sum(d.ad_units)::bigint,
         sum(d.total_sales), sum(d.total_orders)::bigint, sum(d.total_units)::bigint
  from public.daily_analytics d
  join public.amazon_profiles p on p.profile_id = d.profile_id
  where p.brand_slug = p_brand and p.enabled and d.date between p_from and p_to
  group by d.date
  order by d.date;
$$;

grant execute on function public.brand_daily(text, date, date) to authenticated, service_role;
