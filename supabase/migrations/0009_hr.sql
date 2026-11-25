-- AmzCentric OS — HR: attendance, leave requests and time spent in the app.
--   hr_settings        leave policy, office hours and timezone (one row)
--   hr_people          per teammate: display name, fingerprint machine ID, tracked or not,
--                      leave already taken this year before the app (from the old sheet)
--   hr_holidays        public holidays (no work, no leave used)
--   hr_leave_requests  sick / casual / annual / half day / WFH / other requests and decisions
--   hr_checkins        check-in / check-out from the app (WFH days, or Office without a punch)
--   hr_punches         fingerprint punches from the office machine (bridge script or USB upload)
--   hr_device_users    the machine's own user list, to match machine IDs to teammates
--   hr_presence, hr_app_time   active time in the app, per person, day and brand
-- Everyone reads only their own rows; admins read all. Writes go through the server.
-- Run once in the Supabase SQL editor, after 0001–0008. Safe to re-run.

create table if not exists public.hr_settings (
  id         int primary key default 1 check (id = 1),
  policy     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.hr_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.hr_people (
  email          text primary key,
  display_name   text,
  device_user_id text unique,
  tracked        boolean not null default true,
  opening_year   int,
  opening        jsonb not null default '{}'::jsonb,   -- {sick, casual, annual, half_day} used before the app
  updated_at     timestamptz not null default now()
);

create table if not exists public.hr_holidays (
  day  date primary key,
  name text not null
);

create table if not exists public.hr_leave_requests (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  type          text not null check (type in ('sick', 'casual', 'annual', 'half_day', 'wfh', 'other')),
  start_date    date not null,
  end_date      date not null,
  session       text not null default 'full' check (session in ('full', 'am', 'pm')),
  days          numeric(5, 1) not null default 0,
  reason        text not null default '',
  status        text not null default 'pending' check (status in ('pending', 'escalated', 'approved', 'declined', 'cancelled')),
  created_at    timestamptz not null default now(),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  constraint hr_leave_dates check (end_date >= start_date)
);
create index if not exists hr_leave_email_idx on public.hr_leave_requests (email, start_date);
create index if not exists hr_leave_status_idx on public.hr_leave_requests (status, created_at);

create table if not exists public.hr_checkins (
  email          text not null,
  day            date not null,
  mode           text not null check (mode in ('office', 'wfh')),
  checked_in_at  timestamptz not null default now(),
  checked_out_at timestamptz,
  primary key (email, day)
);

create table if not exists public.hr_punches (
  id             bigint generated always as identity primary key,
  device_user_id text not null,
  punch_date     date not null,
  punch_time     time not null,
  source         text not null default 'bridge' check (source in ('bridge', 'upload')),
  device         text,
  received_at    timestamptz not null default now(),
  unique (device_user_id, punch_date, punch_time)
);
create index if not exists hr_punches_date_idx on public.hr_punches (punch_date);

create table if not exists public.hr_device_users (
  device_user_id text primary key,
  name           text,
  seen_at        timestamptz not null default now()
);

create table if not exists public.hr_presence (
  email        text primary key,
  last_beat_at timestamptz not null
);

create table if not exists public.hr_app_time (
  email      text not null,
  day        date not null,
  brand_slug text not null default '',   -- '' = pages outside a brand (My day, Tasks, Settings …)
  seconds    int not null default 0,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (email, day, brand_slug)
);
create index if not exists hr_app_time_day_idx on public.hr_app_time (day);

-- One heartbeat from the browser = one active minute. Several open tabs send several
-- heartbeats; only one per 50 seconds counts, so time isn't doubled.
create or replace function public.hr_beat(p_email text, p_day date, p_brand text, p_seconds int default 60)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare counted boolean;
begin
  insert into public.hr_presence as p (email, last_beat_at) values (lower(p_email), now())
  on conflict (email) do update set last_beat_at = now()
    where p.last_beat_at < now() - interval '50 seconds'
  returning true into counted;
  if counted is null then
    return false;
  end if;
  insert into public.hr_app_time as t (email, day, brand_slug, seconds)
  values (lower(p_email), p_day, coalesce(p_brand, ''), p_seconds)
  on conflict (email, day, brand_slug) do update set seconds = t.seconds + excluded.seconds, last_seen = now();
  return true;
end $$;
revoke all on function public.hr_beat(text, date, text, int) from public, anon, authenticated;
grant execute on function public.hr_beat(text, date, text, int) to service_role;

-- ─────────────────────────────────────────────────────────────────────
-- RLS: own rows, or everything for admins (helpers from 0007)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['hr_settings', 'hr_people', 'hr_holidays', 'hr_leave_requests', 'hr_checkins',
                           'hr_punches', 'hr_device_users', 'hr_presence', 'hr_app_time'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists hr_read on public.%I', t);
  end loop;

  foreach t in array array['hr_people', 'hr_leave_requests', 'hr_checkins', 'hr_app_time'] loop
    execute format(
      'create policy hr_read on public.%I for select to authenticated using ((select public.is_admin()) or email = (select public.my_email()))', t);
  end loop;

  foreach t in array array['hr_settings', 'hr_holidays'] loop
    execute format('create policy hr_read on public.%I for select to authenticated using ((select public.is_team_member()))', t);
  end loop;

  foreach t in array array['hr_device_users', 'hr_presence'] loop
    execute format('create policy hr_read on public.%I for select to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;

create policy hr_read on public.hr_punches for select to authenticated
  using ((select public.is_admin()) or device_user_id in (select device_user_id from public.hr_people where email = (select public.my_email())));
