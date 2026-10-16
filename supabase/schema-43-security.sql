-- ════════════════════════════════════════════════════════════════════════════
--  43 · Security hardening: least privilege for anyone not signed in
--  STATUS: applied 2026-10-17 (by Claude)
--
--  The user (2026-10-17): make it as hard as possible to breach the data.
--  Probed first as an outsider with only the public (anon) key: every data
--  table read back 0 rows, every write was refused or changed nothing, and
--  admin functions were denied — row-level security already holds. This
--  closes the doors themselves (defence in depth):
--    · anon (not signed in) loses every table privilege except reading
--      branches (the sign-in screen lists them), and every function except
--      disabled_tabs() and schedule_view() (sign-in page + public rota).
--      Postgres grants EXECUTE to PUBLIC by default, which is how anon could
--      call the helpers; signed-in users (authenticated) get an explicit grant
--      first, so nothing they use changes.
--    · New tables / functions start closed to anon and PUBLIC.
--    · The 6 functions Supabase flagged get a fixed search_path.
--  Rehearsed rolled back: every role sees the same rows, the RPCs and
--  triggers still run, and anon is refused. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── tables: anon reads branches, nothing else ──
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.branches to anon;

-- ── functions: signed-in users keep everything; anon only what the sign-in page needs ──
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
grant execute on function public.disabled_tabs() to anon;
grant execute on function public.schedule_view() to anon;

-- ── from now on, new objects start closed ──
alter default privileges in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- ── a fixed search_path for the functions Supabase flagged ──
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('assert_good_pin', 'jwt_branch', 'touch_updated_at', 'recalc_claim_total', 'touch_schedule', 'claims_ref_by_kind') loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

commit;
