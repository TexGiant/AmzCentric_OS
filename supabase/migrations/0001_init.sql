-- AmzCentric OS — initial schema
-- Run in the Supabase SQL editor (or `supabase db push`).
-- All tables live in `public` with RLS on. Team members can READ; every
-- WRITE goes through the server with the service-role key.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- Team
-- ─────────────────────────────────────────────────────────────────────
create table public.app_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- Used by every RLS policy: "is the caller a member of the team?"
create or replace function public.is_team_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.app_users where user_id = auth.uid());
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Brands (clients) and Amazon connections
-- ─────────────────────────────────────────────────────────────────────
create table public.brands (
  slug       text primary key check (slug ~ '^[a-z0-9-]+$'),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.amazon_accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  region        text not null check (region in ('NA', 'EU', 'FE')),
  -- AES-256-GCM ciphertext ("enc:v1:...") — plaintext tolerated for legacy rows
  refresh_token text not null,
  connected_by  uuid references auth.users(id) on delete set null,
  last_error    text,
  created_at    timestamptz not null default now()
);

create table public.amazon_profiles (
  profile_id      text primary key,
  account_id      uuid not null references public.amazon_accounts(id) on delete cascade,
  country_code    text,
  currency_code   text,
  timezone        text not null default 'America/Los_Angeles',
  marketplace_id  text,
  account_info_id text,
  account_name    text,
  account_type    text,
  display_name    text,
  brand_slug      text references public.brands(slug) on delete set null,
  enabled         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index amazon_profiles_brand_idx on public.amazon_profiles (brand_slug) where enabled;

create table public.amazon_oauth_states (
  state      text primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  region     text not null check (region in ('NA', 'EU', 'FE')),
  expires_at timestamptz not null
);

-- ─────────────────────────────────────────────────────────────────────
-- Report queue (Ads API v3 async reports)
-- ─────────────────────────────────────────────────────────────────────
create table public.report_jobs (
  id               uuid primary key default gen_random_uuid(),
  profile_id       text not null references public.amazon_profiles(profile_id) on delete cascade,
  report_type      text not null,
  start_date       date not null,
  end_date         date not null,
  amazon_report_id text,
  status           text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  source           text not null default 'cron' check (source in ('cron', 'backfill', 'manual')),
  attempts         int not null default 0,
  rows_ingested    int,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index report_jobs_status_idx on public.report_jobs (status, created_at);
create index report_jobs_recent_idx on public.report_jobs (created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- Fact tables (from Ads API reports)
-- ─────────────────────────────────────────────────────────────────────
create table public.campaigns (
  campaign_id text primary key,
  profile_id  text not null references public.amazon_profiles(profile_id) on delete cascade,
  ad_product  text not null,           -- SP | SB | SD
  name        text,
  state       text,
  budget      numeric(14, 2),
  updated_at  timestamptz not null default now()
);
create index campaigns_profile_idx on public.campaigns (profile_id);

create table public.campaign_daily (
  profile_id  text not null references public.amazon_profiles(profile_id) on delete cascade,
  campaign_id text not null,
  date        date not null,
  ad_product  text not null,
  impressions bigint not null default 0,
  clicks      bigint not null default 0,
  cost        numeric(14, 4) not null default 0,
  sales       numeric(14, 4) not null default 0,
  orders      int not null default 0,
  units       int not null default 0,
  primary key (profile_id, campaign_id, date)
);
create index campaign_daily_date_idx on public.campaign_daily (profile_id, date);

create table public.search_term_daily (
  profile_id  text not null references public.amazon_profiles(profile_id) on delete cascade,
  date        date not null,
  campaign_id text not null,
  ad_group_id text not null,
  targeting   text not null default '',
  match_type  text,
  search_term text not null,
  impressions bigint not null default 0,
  clicks      bigint not null default 0,
  cost        numeric(14, 4) not null default 0,
  sales       numeric(14, 4) not null default 0,
  orders      int not null default 0,
  units       int not null default 0,
  primary key (profile_id, date, campaign_id, ad_group_id, targeting, search_term)
);
create index search_term_daily_date_idx on public.search_term_daily (profile_id, date);

create table public.product_daily (
  profile_id  text not null references public.amazon_profiles(profile_id) on delete cascade,
  date        date not null,
  campaign_id text not null,
  ad_group_id text not null,
  asin        text not null,
  sku         text,
  impressions bigint not null default 0,
  clicks      bigint not null default 0,
  cost        numeric(14, 4) not null default 0,
  sales       numeric(14, 4) not null default 0,
  orders      int not null default 0,
  units       int not null default 0,
  primary key (profile_id, date, campaign_id, ad_group_id, asin)
);
create index product_daily_date_idx on public.product_daily (profile_id, date);

-- One row per profile per day. ad_* columns are rolled up from campaign_daily;
-- total_* / sessions are reserved for SP-API (Sales & Traffic report).
create table public.daily_analytics (
  profile_id  text not null references public.amazon_profiles(profile_id) on delete cascade,
  date        date not null,
  brand       text,                    -- denormalized label for exports / Sheets
  impressions bigint not null default 0,
  clicks      bigint not null default 0,
  ad_cost     numeric(14, 4) not null default 0,
  ad_sales    numeric(14, 4) not null default 0,
  ad_orders   int not null default 0,
  ad_units    int not null default 0,
  total_sales numeric(14, 4),
  total_units int,
  sessions    int,
  updated_at  timestamptz not null default now(),
  primary key (profile_id, date)
);

-- ─────────────────────────────────────────────────────────────────────
-- Marketing Stream (hourly). Messages are deltas: dedupe on
-- idempotency_id, then SUM per hour.
-- ─────────────────────────────────────────────────────────────────────
create table public.stream_traffic (
  idempotency_id    text primary key,
  dataset_id        text not null,
  ad_product        text not null,
  advertiser_id     text,
  marketplace_id    text,
  campaign_id       text,
  ad_group_id       text,
  target_id         text,
  placement         text,
  time_window_start timestamptz not null,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  cost              numeric(14, 4) not null default 0,
  received_at       timestamptz not null default now()
);
create index stream_traffic_campaign_idx on public.stream_traffic (campaign_id, time_window_start);
create index stream_traffic_received_idx on public.stream_traffic (received_at desc);

create table public.stream_conversion (
  idempotency_id    text primary key,
  dataset_id        text not null,
  ad_product        text not null,
  advertiser_id     text,
  marketplace_id    text,
  campaign_id       text,
  ad_group_id       text,
  target_id         text,
  placement         text,
  time_window_start timestamptz not null,
  sales             numeric(14, 4) not null default 0,
  orders            int not null default 0,
  units             int not null default 0,
  received_at       timestamptz not null default now()
);
create index stream_conversion_campaign_idx on public.stream_conversion (campaign_id, time_window_start);

-- ─────────────────────────────────────────────────────────────────────
-- Team workflow: action log + goals
-- ─────────────────────────────────────────────────────────────────────
create table public.action_log (
  id            uuid primary key default gen_random_uuid(),
  brand_slug    text not null references public.brands(slug) on delete cascade,
  campaign_id   text,
  campaign_name text,
  action_date   date not null,
  category      text not null check (category in ('bid', 'budget', 'negative', 'launch', 'pause', 'listing', 'pricing', 'other')),
  description   text not null,
  author_email  text,
  created_at    timestamptz not null default now()
);
create index action_log_brand_idx on public.action_log (brand_slug, action_date desc);

create table public.goals (
  brand_slug   text not null references public.brands(slug) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  sales_target numeric(14, 2),
  spend_budget numeric(14, 2),
  acos_target  numeric(6, 4),
  updated_at   timestamptz not null default now(),
  primary key (brand_slug, month)
);

-- ─────────────────────────────────────────────────────────────────────
-- RLS: team members read everything except secrets; no client writes.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'app_users', 'brands', 'amazon_accounts', 'amazon_profiles', 'amazon_oauth_states',
    'report_jobs', 'campaigns', 'campaign_daily', 'search_term_daily', 'product_daily',
    'daily_analytics', 'stream_traffic', 'stream_conversion', 'action_log', 'goals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  foreach t in array array[
    'app_users', 'brands', 'amazon_profiles', 'report_jobs', 'campaigns', 'campaign_daily',
    'search_term_daily', 'product_daily', 'daily_analytics', 'stream_traffic',
    'stream_conversion', 'action_log', 'goals'
  ] loop
    execute format(
      'create policy team_read on public.%I for select to authenticated using (public.is_team_member())', t);
  end loop;
end $$;
-- amazon_accounts (refresh tokens) and amazon_oauth_states: no policies → service role only.

-- ─────────────────────────────────────────────────────────────────────
-- Read functions (security invoker → RLS applies)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.brand_daily(p_brand text, p_from date, p_to date)
returns table (date date, impressions bigint, clicks bigint, cost numeric, sales numeric,
               orders bigint, units bigint, total_sales numeric)
language sql stable
as $$
  select d.date,
         sum(d.impressions)::bigint, sum(d.clicks)::bigint,
         sum(d.ad_cost), sum(d.ad_sales),
         sum(d.ad_orders)::bigint, sum(d.ad_units)::bigint,
         sum(d.total_sales)
  from public.daily_analytics d
  join public.amazon_profiles p on p.profile_id = d.profile_id
  where p.brand_slug = p_brand and p.enabled and d.date between p_from and p_to
  group by d.date
  order by d.date;
$$;

create or replace function public.campaign_summary(p_brand text, p_from date, p_to date)
returns table (campaign_id text, name text, ad_product text, state text, budget numeric,
               impressions bigint, clicks bigint, cost numeric, sales numeric,
               orders bigint, units bigint)
language sql stable
as $$
  select cd.campaign_id, max(c.name), max(cd.ad_product), max(c.state), max(c.budget),
         sum(cd.impressions)::bigint, sum(cd.clicks)::bigint, sum(cd.cost), sum(cd.sales),
         sum(cd.orders)::bigint, sum(cd.units)::bigint
  from public.campaign_daily cd
  join public.amazon_profiles p on p.profile_id = cd.profile_id
  left join public.campaigns c on c.campaign_id = cd.campaign_id
  where p.brand_slug = p_brand and p.enabled and cd.date between p_from and p_to
  group by cd.campaign_id;
$$;

create or replace function public.search_term_summary(p_brand text, p_from date, p_to date, p_limit int default 1000)
returns table (search_term text, targeting text, match_type text, campaign_id text, campaign_name text,
               impressions bigint, clicks bigint, cost numeric, sales numeric, orders bigint, units bigint)
language sql stable
as $$
  select s.search_term, s.targeting, max(s.match_type), s.campaign_id, max(c.name),
         sum(s.impressions)::bigint, sum(s.clicks)::bigint, sum(s.cost), sum(s.sales),
         sum(s.orders)::bigint, sum(s.units)::bigint
  from public.search_term_daily s
  join public.amazon_profiles p on p.profile_id = s.profile_id
  left join public.campaigns c on c.campaign_id = s.campaign_id
  where p.brand_slug = p_brand and p.enabled and s.date between p_from and p_to
  group by s.search_term, s.targeting, s.campaign_id
  order by sum(s.cost) desc
  limit p_limit;
$$;

create or replace function public.product_summary(p_brand text, p_from date, p_to date)
returns table (asin text, sku text, impressions bigint, clicks bigint, cost numeric, sales numeric,
               orders bigint, units bigint)
language sql stable
as $$
  select pd.asin, max(pd.sku),
         sum(pd.impressions)::bigint, sum(pd.clicks)::bigint, sum(pd.cost), sum(pd.sales),
         sum(pd.orders)::bigint, sum(pd.units)::bigint
  from public.product_daily pd
  join public.amazon_profiles p on p.profile_id = pd.profile_id
  where p.brand_slug = p_brand and p.enabled and pd.date between p_from and p_to
  group by pd.asin;
$$;

-- Totals for one campaign (or the whole brand when p_campaign is null).
create or replace function public.metrics_window(p_brand text, p_campaign text, p_from date, p_to date)
returns table (impressions bigint, clicks bigint, cost numeric, sales numeric, orders bigint, units bigint)
language sql stable
as $$
  select coalesce(sum(cd.impressions), 0)::bigint, coalesce(sum(cd.clicks), 0)::bigint,
         coalesce(sum(cd.cost), 0), coalesce(sum(cd.sales), 0),
         coalesce(sum(cd.orders), 0)::bigint, coalesce(sum(cd.units), 0)::bigint
  from public.campaign_daily cd
  join public.amazon_profiles p on p.profile_id = cd.profile_id
  where p.brand_slug = p_brand and p.enabled and cd.date between p_from and p_to
    and (p_campaign is null or cd.campaign_id = p_campaign);
$$;

-- Hourly totals for one brand on one local day (profile timezone).
create or replace function public.hourly_summary(p_brand text, p_day date)
returns table (hour int, impressions bigint, clicks bigint, cost numeric, sales numeric, orders bigint)
language sql stable
as $$
  with brand_campaigns as (
    select c.campaign_id, p.timezone
    from public.campaigns c
    join public.amazon_profiles p on p.profile_id = c.profile_id
    where p.brand_slug = p_brand and p.enabled
  ),
  t as (
    select extract(hour from (st.time_window_start at time zone bc.timezone))::int as hour,
           sum(st.impressions) as impressions, sum(st.clicks) as clicks, sum(st.cost) as cost
    from public.stream_traffic st
    join brand_campaigns bc on bc.campaign_id = st.campaign_id
    where st.time_window_start >= (p_day::timestamp - interval '1 day') at time zone 'UTC'
      and st.time_window_start <  (p_day::timestamp + interval '2 day') at time zone 'UTC'
      and (st.time_window_start at time zone bc.timezone)::date = p_day
    group by 1
  ),
  c as (
    select extract(hour from (sc.time_window_start at time zone bc.timezone))::int as hour,
           sum(sc.sales) as sales, sum(sc.orders) as orders
    from public.stream_conversion sc
    join brand_campaigns bc on bc.campaign_id = sc.campaign_id
    where sc.time_window_start >= (p_day::timestamp - interval '1 day') at time zone 'UTC'
      and sc.time_window_start <  (p_day::timestamp + interval '2 day') at time zone 'UTC'
      and (sc.time_window_start at time zone bc.timezone)::date = p_day
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

create or replace function public.brand_data_through(p_brand text)
returns date
language sql stable
as $$
  select max(d.date)
  from public.daily_analytics d
  join public.amazon_profiles p on p.profile_id = d.profile_id
  where p.brand_slug = p_brand and p.enabled;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Write function (service role): roll campaign_daily up into daily_analytics
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.refresh_daily_analytics(p_profile text, p_from date, p_to date)
returns void
language sql
as $$
  insert into public.daily_analytics as da
    (profile_id, date, brand, impressions, clicks, ad_cost, ad_sales, ad_orders, ad_units, updated_at)
  select cd.profile_id, cd.date, max(p.brand_slug),
         sum(cd.impressions), sum(cd.clicks), sum(cd.cost), sum(cd.sales),
         sum(cd.orders), sum(cd.units), now()
  from public.campaign_daily cd
  join public.amazon_profiles p on p.profile_id = cd.profile_id
  where cd.profile_id = p_profile and cd.date between p_from and p_to
  group by cd.profile_id, cd.date
  on conflict (profile_id, date) do update set
    brand = excluded.brand,
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    ad_cost = excluded.ad_cost,
    ad_sales = excluded.ad_sales,
    ad_orders = excluded.ad_orders,
    ad_units = excluded.ad_units,
    updated_at = now();
$$;

revoke all on function public.refresh_daily_analytics(text, date, date) from public, anon, authenticated;
grant execute on function public.refresh_daily_analytics(text, date, date) to service_role;

grant execute on function
  public.brand_daily(text, date, date),
  public.campaign_summary(text, date, date),
  public.search_term_summary(text, date, date, int),
  public.product_summary(text, date, date),
  public.metrics_window(text, text, date, date),
  public.hourly_summary(text, date),
  public.brand_data_through(text)
to authenticated, service_role;
