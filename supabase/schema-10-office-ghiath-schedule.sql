-- ════════════════════════════════════════════════════════════════════════════
--  10 · The warehouse becomes the Office (OFC); Ghiath joins; the schedule moves in
--  STATUS: NOT YET APPLIED — run it in the Supabase SQL editor, all of it at once
--
--  Three things, in one transaction so the portal never sees half of them:
--
--  1 · WH → OFC, named "Office". The code is the primary key nine columns
--      point at, the branch_code claim every policy reads, and the local part
--      of the sign-in address — so all three move together, as SLS → SAL did
--      in schema-04. The six-digit code is the account's password and does not
--      change: the office signs in exactly as before.
--
--  2 · Ghiath (GHIATH), a new role, 'scheduler': reads everything the office
--      reads, changes nothing but the schedule. His account is created here
--      with a random password nobody knows — the office then sets his code
--      under Settings → Branch access.
--
--  3 · The staff scheduler's data, out of one browser and into Postgres:
--      schedule_state   the roster, branches, leave, special dates, presets
--      schedule_weeks   every week's finished schedule, one row per week
--      schedule_view()  the week that is running, for the branches and for
--                       the public "View schedule" page — and nothing older
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · roles ───────────────────────────────────────────────────────────────
alter table public.branches drop constraint if exists branches_role_check;
alter table public.branches add constraint branches_role_check
  check (role in ('retail', 'fitting', 'clinic', 'admin', 'scheduler'));

-- ── 2 · WH → OFC ────────────────────────────────────────────────────────────
-- The foreign keys are NO ACTION, so the new code goes in first, every
-- reference moves across, and only then does the old one go. The touch
-- triggers are held off so moving a code does not make old claims and orders
-- look freshly edited.
insert into public.branches (code, name, role, holds_lens_stock, created_at)
select 'OFC', 'Office', role, holds_lens_stock, created_at
  from public.branches where code = 'WH'
on conflict (code) do nothing;

alter table public.claims disable trigger claims_touch;
alter table public.orders disable trigger orders_touch;
alter table public.lens_requests disable trigger lens_requests_touch;
alter table public.stock_requests disable trigger stock_requests_touch;

update public.claims               set branch_code = 'OFC' where branch_code = 'WH';
update public.claims               set created_by  = 'OFC' where created_by  = 'WH';
update public.orders               set origin_code = 'OFC' where origin_code = 'WH';
update public.orders               set fitter_code = 'OFC' where fitter_code = 'WH';
update public.order_events         set by_code     = 'OFC' where by_code     = 'WH';
update public.lens_requests        set branch_code = 'OFC' where branch_code = 'WH';
update public.lens_request_events  set by_code     = 'OFC' where by_code     = 'WH';
update public.stock_requests       set branch_code = 'OFC' where branch_code = 'WH';
update public.stock_request_events set by_code     = 'OFC' where by_code     = 'WH';

alter table public.claims enable trigger claims_touch;
alter table public.orders enable trigger orders_touch;
alter table public.lens_requests enable trigger lens_requests_touch;
alter table public.stock_requests enable trigger stock_requests_touch;

delete from public.branches where code = 'WH';

-- The claim every policy reads, and the address auth.js builds from the code.
update auth.users
   set email             = 'ofc@finlandoptical.om',
       raw_app_meta_data = jsonb_set(raw_app_meta_data, '{branch_code}', '"OFC"')
 where raw_app_meta_data->>'branch_code' = 'WH';

update auth.identities
   set identity_data = jsonb_set(identity_data, '{email}', '"ofc@finlandoptical.om"')
 where provider = 'email' and identity_data->>'email' = 'wh@finlandoptical.om';

-- ── 3 · Ghiath ──────────────────────────────────────────────────────────────
insert into public.branches (code, name, role, holds_lens_stock)
values ('GHIATH', 'Ghiath', 'scheduler', false)
on conflict (code) do update set name = excluded.name, role = excluded.role;

-- His sign-in account, shaped like the branches' own. The password is random
-- and thrown away; the office gives him a code in Settings → Branch access.
do $$
declare
  uid uuid := gen_random_uuid();
  src auth.users;
begin
  if exists (select 1 from auth.users where email = 'ghiath@finlandoptical.om') then
    update auth.users
       set raw_app_meta_data = raw_app_meta_data
             || '{"branch_code": "GHIATH", "branch_role": "scheduler"}'::jsonb
     where email = 'ghiath@finlandoptical.om';
    return;
  end if;

  select * into src from auth.users where raw_app_meta_data->>'branch_code' = 'SCC' limit 1;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
    created_at, updated_at)
  values (
    src.instance_id, uid, 'authenticated', 'authenticated', 'ghiath@finlandoptical.om',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
    '', '', '', '', '', '', '', '',
    '{"provider": "email", "providers": ["email"], "branch_code": "GHIATH", "branch_role": "scheduler"}'::jsonb,
    '{"email_verified": true}'::jsonb, src.is_super_admin, false, false,
    now(), now());

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (uid::text, uid,
          jsonb_build_object('sub', uid::text, 'email', 'ghiath@finlandoptical.om',
                             'email_verified', false, 'phone_verified', false),
          'email', now(), now());
end $$;

-- ── 4 · who may read what ───────────────────────────────────────────────────
create or replace function public.is_scheduler() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.role = 'scheduler') $$;

-- The office and Ghiath both make the schedule.
create or replace function public.can_schedule() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.role in ('admin', 'scheduler')) $$;

-- Ghiath reads every claim, order and request, and writes none of them. These
-- are SELECT-only policies added beside the existing ones, so they open reading
-- and nothing else: an update or delete still has to pass the old rules.
do $$
declare t text;
begin
  foreach t in array array[
    'claims', 'claim_items', 'claim_prescriptions',
    'orders', 'order_events',
    'stock_requests', 'stock_request_lines', 'stock_request_events',
    'lens_requests', 'lens_request_lines', 'lens_request_events'] loop
    execute format('drop policy if exists %I on public.%I', t || '_scheduler_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_scheduler())',
                   t || '_scheduler_read', t);
  end loop;
end $$;

-- ── 5 · the schedule ────────────────────────────────────────────────────────
-- The scheduler edits one document — its roster, branches, leave, special
-- dates, part-timers' days, pins and presets — and saves it whole, so it is
-- kept whole: one row, a column per part, the way app_settings is kept.
create table if not exists public.schedule_state (
  id          int primary key default 1 check (id = 1),
  branches    jsonb not null default '[]'::jsonb,
  employees   jsonb not null default '[]'::jsonb,
  vacations   jsonb not null default '{}'::jsonb,
  overrides   jsonb not null default '[]'::jsonb,
  pt_days     jsonb not null default '{}'::jsonb,
  pins        jsonb not null default '{}'::jsonb,
  presets     jsonb not null default '[]'::jsonb,
  week_start  date,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Left empty on purpose: the first time the office or Ghiath opens the
-- schedule, the scheduler starts from its own built-in roster and saves it
-- here — one definition of the starting staff, not two that drift.
insert into public.schedule_state (id) values (1) on conflict (id) do nothing;

-- Each week's finished schedule, with the names and branches it was made
-- from, so an old week still reads correctly after someone leaves.
create table if not exists public.schedule_weeks (
  week_start  date primary key,
  result      jsonb not null,
  employees   jsonb not null default '[]'::jsonb,
  branches    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create or replace function public.touch_schedule() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = nullif(public.jwt_branch(), '');
  return new;
end $$;

drop trigger if exists schedule_state_touch on public.schedule_state;
create trigger schedule_state_touch before insert or update on public.schedule_state
  for each row execute function public.touch_schedule();

drop trigger if exists schedule_weeks_touch on public.schedule_weeks;
create trigger schedule_weeks_touch before insert or update on public.schedule_weeks
  for each row execute function public.touch_schedule();

alter table public.schedule_state enable row level security;
alter table public.schedule_weeks enable row level security;

-- Only the two who make the schedule touch these tables at all. The branches
-- and the public read the running week through schedule_view() below, which is
-- why no branch can page back through old weeks.
drop policy if exists schedule_state_all on public.schedule_state;
create policy schedule_state_all on public.schedule_state
  for all to authenticated
  using (public.can_schedule()) with check (public.can_schedule());

drop policy if exists schedule_weeks_all on public.schedule_weeks;
create policy schedule_weeks_all on public.schedule_weeks
  for all to authenticated
  using (public.can_schedule()) with check (public.can_schedule());

-- The week that is running in Oman — the one whose seven days include today —
-- with only what reading it needs. Open to the anon key on purpose: the
-- "View schedule" page has no sign-in.
create or replace function public.schedule_view() returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object('week_start', w.week_start, 'result', w.result,
                            'employees', w.employees, 'branches', w.branches)
    from public.schedule_weeks w
   where w.week_start <= (now() at time zone 'Asia/Muscat')::date
     and w.week_start >  (now() at time zone 'Asia/Muscat')::date - 7
   order by w.week_start desc
   limit 1
$$;

revoke all on function public.schedule_view() from public;
grant execute on function public.schedule_view() to anon, authenticated;

commit;
