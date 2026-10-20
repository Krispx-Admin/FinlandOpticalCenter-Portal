-- ════════════════════════════════════════════════════════════════════════════
--  58 · "Open as": the record of every switch into another account
--  STATUS: applied 2026-10-20 (by Claude)
--
--  The user (2026-10-20) wanted to get into any branch without its code;
--  chose (over a master code at the sign-in screen) an "Open as…" button for
--  an account already signed in with the 'accounts' permission — which can
--  set any account's code anyway, so it gains nothing it did not have. The
--  edge function supabase/functions/open-as checks that and signs the browser
--  in as the account picked; every switch is written here (by the function,
--  with the service key). Readable by 'accounts'; nobody writes it from the
--  browser. Codes are untouched. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.account_switches (
  id      bigserial primary key,
  by_code text not null,
  to_code text not null,
  at      timestamptz not null default now()
);
alter table public.account_switches enable row level security;
revoke all on public.account_switches from anon, authenticated;
grant select on public.account_switches to authenticated;
drop policy if exists account_switches_read on public.account_switches;
create policy account_switches_read on public.account_switches for select to authenticated
  using ((select public.has_perm('accounts')));

commit;
