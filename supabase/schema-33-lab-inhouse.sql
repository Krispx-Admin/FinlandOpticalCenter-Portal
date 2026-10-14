-- ════════════════════════════════════════════════════════════════════════════
--  33 · The Lab: On / In-house only / Off
--  STATUS: applied 2026-10-14 (by Claude)
--
--  The user (2026-10-14): a fitting centre can keep its lab on for itself —
--  no work from other branches, but it still cuts its own jobs in-house.
--  branches gains bench_own_only. The three settings:
--    On            bench_closed = false, bench_own_only = false
--    In-house only bench_closed = false, bench_own_only = true
--    Off           bench_closed = true  (fitter on leave — nothing at all)
--  bench_closed(code) now means "takes no work from other branches" (Off or
--  In-house only) — every check that guards another branch sending work
--  (open_fitter, send_outside_lenses, lens requests, the to_fitter gate)
--  keeps using it unchanged. The new bench_off(code) is "Off" proper, and is
--  what stops a branch cutting its own job. set_lab(code, mode) sets it.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches add column if not exists bench_own_only boolean not null default false;

-- Off: the fitter is on leave (until the date, if one was set).
create or replace function public.bench_off(p_code text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select b.bench_closed and (b.bench_closed_until is null
                          or b.bench_closed_until >= (now() at time zone 'Asia/Muscat')::date)
                     from public.branches b where b.code = p_code), false)
$$;

-- Takes no work from other branches: Off, or In-house only.
create or replace function public.bench_closed(p_code text) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.bench_off(p_code)
      or coalesce((select b.bench_own_only from public.branches b where b.code = p_code), false)
$$;

create or replace function public.bench_lock_gate() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  -- Another branch's frame cannot go to a lab that is off or in-house only.
  if new.status = 'to_fitter' and new.fitter_code is not null and public.bench_closed(new.fitter_code) then
    raise exception '% is not taking frames — lab %', (select name from public.branches where code = new.fitter_code),
      case when public.bench_off(new.fitter_code) then 'off' else 'in-house only' end;
  end if;
  -- A branch's own job: only when its lab is off altogether.
  if new.status = 'at_fitter' and old.status in ('pending', 'lenses_in') and new.fitter_code = new.origin_code
     and public.bench_off(new.fitter_code) then
    raise exception 'Your lab is off. Send it to another fitter';
  end if;
  return new;
end $$;

create or replace function public.set_lab(p_code text, p_mode text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  b public.branches;
begin
  if p_mode not in ('on', 'inhouse', 'off') then raise exception 'Unknown lab setting %', p_mode; end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  if b.role <> 'fitting' then raise exception '% has no lab', b.name; end if;
  if not (public.jwt_branch() = p_code or public.is_admin()) then
    raise exception 'Only % itself (or the office) can change its lab', b.name;
  end if;
  update public.branches
     set bench_closed = (p_mode = 'off'), bench_closed_until = null, bench_own_only = (p_mode = 'inhouse')
   where code = p_code;
end $$;

-- The old on/off switch clears "in-house only" too, so the two never disagree.
create or replace function public.set_bench(p_code text, p_closed boolean, p_until date default null) returns void
  language plpgsql security definer set search_path = public as $$
declare
  b public.branches;
begin
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  if b.role <> 'fitting' then raise exception '% has no lab', b.name; end if;
  if not (public.jwt_branch() = p_code or public.is_admin()) then
    raise exception 'Only % itself (or the office) can change its lab', b.name;
  end if;
  if p_closed and p_until is not null and p_until < (now() at time zone 'Asia/Muscat')::date then
    raise exception 'The reopening date is in the past';
  end if;
  update public.branches
     set bench_closed = p_closed, bench_closed_until = case when p_closed then p_until else null end, bench_own_only = false
   where code = p_code;
end $$;

revoke all on function public.set_lab(text, text) from public, anon;
grant execute on function public.set_lab(text, text) to authenticated;
grant execute on function public.bench_off(text) to authenticated;

commit;
