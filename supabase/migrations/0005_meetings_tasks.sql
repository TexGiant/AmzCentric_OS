-- AmzCentric OS — weekly brand meetings and the tasks that come out of them.
-- Notes arrive three ways: pasted in the app, saved from Claude through the connector,
-- or pushed by a recorder (Zapier / Fireflies / Otter …) to /api/meetings/ingest.
-- Claude turns each one into a summary, insights and tasks.
-- Run once in the Supabase SQL editor (safe to re-run).

create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  brand_slug   text not null references public.brands(slug) on delete cascade,
  title        text not null,
  meeting_date date not null,
  notes        text not null,
  source       text not null default 'paste' check (source in ('paste', 'claude', 'webhook')),
  external_id  text,                       -- recorder's meeting id, so a re-sent webhook doesn't duplicate
  status       text not null default 'pending'
               check (status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  summary      text,
  insights     jsonb not null default '[]'::jsonb,   -- [{type, title, detail}]
  agenda       jsonb not null default '[]'::jsonb,   -- follow-ups for next week's meeting
  error        text,
  created_by   text,
  created_at   timestamptz not null default now(),
  analyzed_at  timestamptz
);
create index if not exists meetings_brand_idx on public.meetings (brand_slug, meeting_date desc);
create unique index if not exists meetings_external_idx on public.meetings (brand_slug, external_id) where external_id is not null;

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  brand_slug   text not null references public.brands(slug) on delete cascade,
  meeting_id   uuid references public.meetings(id) on delete set null,
  title        text not null,
  detail       text,
  owner_email  text,                       -- a teammate (app_users.email)
  owner_name   text,                       -- or someone else, e.g. the client
  due_date     date,
  priority     text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status       text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  source       text not null default 'manual' check (source in ('ai', 'manual', 'claude')),
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  completed_note text
);
create index if not exists tasks_brand_idx on public.tasks (brand_slug, status, due_date);
create index if not exists tasks_owner_idx on public.tasks (owner_email, status);
create index if not exists tasks_meeting_idx on public.tasks (meeting_id);

alter table public.meetings enable row level security;
alter table public.tasks enable row level security;
drop policy if exists team_read on public.meetings;
create policy team_read on public.meetings for select to authenticated using ((select public.is_team_member()));
drop policy if exists team_read on public.tasks;
create policy team_read on public.tasks for select to authenticated using ((select public.is_team_member()));
-- Writes go through the server (service role).
