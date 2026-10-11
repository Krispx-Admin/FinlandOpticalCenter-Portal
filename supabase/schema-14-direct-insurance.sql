-- ════════════════════════════════════════════════════════════════════════════
--  14 · Direct Insurance
--  STATUS: applied 2026-10-11 (by Claude)
--
--  A sales operator records an insurance customer the way a claim is
--  recorded — date, branch, bill, member ID, full name, products, prescription,
--  payment — and adds which insurer pays (OQIC, LIVA or Mednet) and which
--  employee made the sale. The office and Ghiath see a dashboard of what the
--  insurers paid: in total, by insurer, by branch and by employee.
--
--  It is a claim of another kind, so it lives in `claims` with kind = 'direct'
--  and has everything a claim has for free: its items and prescription rows,
--  the total kept by trigger, the same row level security (a branch sees its
--  own, the office and Ghiath see all) and realtime. Its reference reads DI-…
--  from the same sequence, so numbers never collide with IC-….
--
--  The insurers are a list in app_settings.insurers, which the office edits in
--  Settings. The employee list is the schedule's own roster, read through
--  staff_list() — names and their branches only.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.claims
  add column if not exists kind          text not null default 'claim',
  add column if not exists employee_id   text,
  add column if not exists employee_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'claims_kind_check') then
    alter table public.claims add constraint claims_kind_check check (kind in ('claim', 'direct'));
  end if;
end $$;

create index if not exists claims_kind_date_idx on public.claims (kind, claim_date desc);

comment on column public.claims.kind is 'claim = Insurance Claims; direct = Direct Insurance (has insurer and employee).';
comment on column public.claims.employee_name is 'The salesperson, as named when the sale was recorded — kept so it still reads after they leave the roster.';

-- A direct-insurance record is numbered DI-… from the claims' own sequence.
create or replace function public.claims_ref_by_kind() returns trigger
  language plpgsql as $$
begin
  if new.kind = 'direct' and new.ref like 'IC-%' then
    new.ref := 'DI-' || substr(new.ref, 4);
  end if;
  return new;
end $$;

drop trigger if exists claims_ref_kind on public.claims;
create trigger claims_ref_kind before insert on public.claims
  for each row execute function public.claims_ref_by_kind();

-- The insurers Direct Insurance offers, unless the office has already set some.
update public.app_settings
   set insurers = '["OQIC", "LIVA", "Mednet"]'::jsonb
 where id = 1 and coalesce(jsonb_array_length(insurers), 0) = 0;

-- The salespeople to choose from: the schedule's roster, names and branches
-- only. Every signed-in location may read it; the roster tables themselves
-- stay the office's and Ghiath's.
create or replace function public.staff_list()
  returns table (id text, name text, branches text[])
  language sql stable security definer set search_path = public as $$
  select e.id, e.name, e.priority from public.schedule_employees e order by e.name
$$;

revoke all on function public.staff_list() from public, anon;
grant execute on function public.staff_list() to authenticated;

commit;
