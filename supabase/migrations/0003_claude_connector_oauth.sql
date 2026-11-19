-- AmzCentric OS — sign-in tables for the Claude connector (OAuth 2.1 + PKCE).
-- Claude registers itself as a client, a teammate approves it with their AmzCentric
-- OS login, and Claude gets short-lived tokens tied to that teammate.
-- Only the server (service role) touches these tables. Safe to re-run.

create table if not exists public.oauth_clients (
  client_id          text primary key,
  client_secret_hash text,                 -- null = public client (PKCE only)
  client_name        text,
  redirect_uris      text[] not null,
  created_at         timestamptz not null default now()
);

create table if not exists public.oauth_codes (
  code_hash      text primary key,          -- sha256 of the one-time code
  client_id      text not null references public.oauth_clients(client_id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,             -- PKCE S256
  scope          text,
  resource       text,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

-- One "connection" = a family of access + refresh tokens from one approval.
create table if not exists public.oauth_tokens (
  token_hash   text primary key,            -- sha256 of the token; tokens are never stored
  kind         text not null check (kind in ('access', 'refresh')),
  family       uuid not null,
  client_id    text not null references public.oauth_clients(client_id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  scope        text,
  resource     text,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists oauth_tokens_user_idx on public.oauth_tokens (user_id);
create index if not exists oauth_tokens_family_idx on public.oauth_tokens (family);

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
-- No policies: only the service role can read or write these tables.
