-- AmzCentric OS — role-based access.
--
-- People hold one or more roles (admin, brand_manager, ppc_manager, catalog_manager) and,
-- unless admin, see only the brands assigned to them. Brand managers can have a team
-- (app_users.reports_to). Everything people do is recorded in audit_log.
--
-- RLS: the old team_read policies ("any teammate reads everything") are replaced with
-- policies that check the caller's brands (and, for goals/tasks, their roles), so even an
-- app bug can't return another brand's rows. Helpers are evaluated once per query via
-- (select ...) InitPlans.
--
-- Existing users on first run: admins stay admin; everyone else gets brand_manager +
-- ppc_manager + catalog_manager on every existing brand, so nobody is locked out. Narrow it
-- down in Settings → Team afterwards.
--
-- Run once in the Supabase SQL editor, after 0001–0006. Safe to re-run: it never re-grants
-- access you have since removed (each user is seeded once, tracked by app_users.rbac_seeded).

-- ─────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.user_roles (
  user_id    uuid not null references public.app_users(user_id) on delete cascade,
  role       text not null check (role in ('admin', 'brand_manager', 'ppc_manager', 'catalog_manager')),
  -- 'junior' is reserved for a future approval flow (e.g. Junior PPC); nothing uses it yet.
  level      text not null default 'standard' check (level in ('standard', 'junior')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.user_brands (
  user_id    uuid not null references public.app_users(user_id) on delete cascade,
  brand_slug text not null references public.brands(slug) on delete cascade on update cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_slug)
);
create index if not exists user_brands_brand_idx on public.user_brands (brand_slug);

alter table public.app_users add column if not exists reports_to uuid references public.app_users(user_id) on delete set null;
alter table public.app_users add column if not exists rbac_seeded boolean not null default false;

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null,          -- e.g. auth.sign_in, team.roles, export.csv, connector.get_campaigns, task.create
  brand_slug  text,
  target      text,                   -- id or name of what was touched
  via         text not null default 'app' check (via in ('app', 'connector', 'webhook', 'system')),
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_email, at desc);
create index if not exists audit_log_brand_idx on public.audit_log (brand_slug, at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, at desc);

-- ─────────────────────────────────────────────────────────────────────
-- Seed existing users (once per user)
-- ─────────────────────────────────────────────────────────────────────
insert into public.user_roles (user_id, role)
select user_id, 'admin' from public.app_users where role = 'admin' and not rbac_seeded
on conflict do nothing;

insert into public.user_roles (user_id, role)
select u.user_id, r.role
from public.app_users u
cross join (values ('brand_manager'), ('ppc_manager'), ('catalog_manager')) as r(role)
where u.role <> 'admin' and not u.rbac_seeded
on conflict do nothing;

insert into public.user_brands (user_id, brand_slug)
select u.user_id, b.slug
from public.app_users u cross join public.brands b
where u.role <> 'admin' and not u.rbac_seeded
on conflict do nothing;

update public.app_users set rbac_seeded = true where not rbac_seeded;
-- Users created from now on start with no roles and no brands (default deny).
alter table public.app_users alter column rbac_seeded set default true;

-- ─────────────────────────────────────────────────────────────────────
-- Helpers (security definer: they read the role tables, which callers can't)
-- ─────────────────────────────────────────────────────────────────────

-- The server's own service-role key and direct SQL sessions (SQL editor, migrations).
create or replace function public.is_backend()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role' or session_user <> 'authenticator';
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.has_role(p_role text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role);
$$;

create or replace function public.my_email()
returns text
language sql stable security definer set search_path = public
as $$
  select lower(email) from public.app_users where user_id = auth.uid();
$$;

-- Brands the caller may see: all for admins (and the backend); assigned ones for people
-- holding at least one non-admin role; none otherwise.
create or replace function public.my_brands()
returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_backend() or public.is_admin() then (select coalesce(array_agg(slug), '{}') from public.brands)
    else (
      select coalesce(array_agg(ub.brand_slug), '{}')
      from public.user_brands ub
      where ub.user_id = auth.uid()
        and exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role <> 'admin')
    )
  end;
$$;

-- Amazon profiles behind those brands (admins: every profile, assigned or not).
create or replace function public.my_profiles()
returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_backend() or public.is_admin() then (select coalesce(array_agg(profile_id), '{}') from public.amazon_profiles)
    else (select coalesce(array_agg(profile_id), '{}') from public.amazon_profiles where brand_slug = any (public.my_brands()))
  end;
$$;

create or replace function public.can_see_brand(p_brand text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_brand = any (public.my_brands());
$$;

grant execute on function public.is_backend(), public.is_admin(), public.has_role(text), public.my_email(),
  public.my_brands(), public.my_profiles(), public.can_see_brand(text)
to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- RLS: drop the old "any teammate" policies, add brand- and role-aware ones
-- ─────────────────────────────────────────────────────────────────────
alter table public.user_roles enable row level security;
alter table public.user_brands enable row level security;
alter table public.audit_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'app_users', 'brands', 'amazon_profiles', 'report_jobs', 'campaigns', 'campaign_daily',
    'search_term_daily', 'product_daily', 'daily_analytics', 'stream_traffic', 'stream_conversion',
    'action_log', 'goals', 'meetings', 'tasks', 'user_roles', 'user_brands', 'audit_log'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists team_read on public.%I', t);
      execute format('drop policy if exists rbac_read on public.%I', t);
    end if;
  end loop;

  -- Rows keyed by Amazon profile: visible when the profile belongs to one of the caller's brands.
  foreach t in array array['campaigns', 'campaign_daily', 'search_term_daily', 'product_daily', 'daily_analytics'] loop
    execute format(
      'create policy rbac_read on public.%I for select to authenticated using (profile_id = any ((select public.my_profiles())::text[]))', t);
  end loop;

  -- Rows keyed by brand.
  foreach t in array array['action_log', 'meetings'] loop
    execute format(
      'create policy rbac_read on public.%I for select to authenticated using (brand_slug = any ((select public.my_brands())::text[]))', t);
  end loop;

  -- Admin only: sync jobs, raw Stream rows (read through hourly functions below), the audit log.
  foreach t in array array['report_jobs', 'stream_traffic', 'stream_conversion', 'audit_log'] loop
    execute format('create policy rbac_read on public.%I for select to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

create policy rbac_read on public.brands for select to authenticated
  using (slug = any ((select public.my_brands())::text[]));

create policy rbac_read on public.amazon_profiles for select to authenticated
  using ((select public.is_admin()) or brand_slug = any ((select public.my_brands())::text[]));

-- Goals: brand managers and admins.
create policy rbac_read on public.goals for select to authenticated
  using (
    brand_slug = any ((select public.my_brands())::text[])
    and ((select public.is_admin()) or (select public.has_role('brand_manager')))
  );

-- Tasks: admins and brand managers see every task on their brands; PPC and catalog
-- managers see the ones they own or created.
create policy rbac_read on public.tasks for select to authenticated
  using (
    brand_slug = any ((select public.my_brands())::text[])
    and (
      (select public.is_admin())
      or (select public.has_role('brand_manager'))
      or lower(owner_email) = (select public.my_email())
      or lower(created_by) = (select public.my_email())
    )
  );

-- People: admins see everyone; others see themselves and their direct reports.
create policy rbac_read on public.app_users for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()) or reports_to = (select auth.uid()));

create policy rbac_read on public.user_roles for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

create policy rbac_read on public.user_brands for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

-- All writes go through the server (service role) after it checks permissions.

-- ─────────────────────────────────────────────────────────────────────
-- Stream reads, now that the raw Stream tables are admin-only
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.brand_stream_last_hour(p_brand text)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  select max(st.time_window_start)
  from public.stream_traffic st
  join public.campaigns c on c.campaign_id = st.campaign_id
  join public.amazon_profiles p on p.profile_id = c.profile_id
  where p.brand_slug = p_brand and p.enabled
    and public.can_see_brand(p_brand)
    and st.time_window_start > now() - interval '3 days';
$$;
grant execute on function public.brand_stream_last_hour(text) to authenticated, service_role;

-- hourly_summary (from 0004), now security definer with an explicit brand check.
create or replace function public.hourly_summary(p_brand text, p_day date)
returns table (hour int, impressions bigint, clicks bigint, cost numeric, sales numeric, orders bigint)
language sql stable security definer set search_path = public
as $$
  with bp as (
    select profile_id, timezone, account_info_id
    from public.amazon_profiles
    where brand_slug = p_brand and enabled and public.can_see_brand(p_brand)
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
