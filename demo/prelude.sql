-- ── FOC Portal practice copy: what Supabase provides around the database ──
-- Runs first, inside the browser (PGlite). The live project has these from
-- Supabase itself: the signed-in key's roles, the token reader auth.jwt(),
-- the sign-in tables, and pgcrypto in the "extensions" schema.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create schema if not exists auth;
-- The practice copy signs in by picking a location; these only exist so the
-- office's account functions (add / rename / code) have something to write to.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid, aud text, role text,
  email text unique, encrypted_password text,
  email_confirmed_at timestamptz, confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}', raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now(),
  last_sign_in_at timestamptz, is_sso_user boolean default false, deleted_at timestamptz
);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text, user_id uuid references auth.users(id) on delete cascade,
  identity_data jsonb, provider text, email text,
  last_sign_in_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
);
-- The token the page signed in with, as the live database reads it.
create or replace function auth.jwt() returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable
as $$ select coalesce(auth.jwt() ->> 'role', 'anon') $$;

grant usage on schema auth, extensions to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
