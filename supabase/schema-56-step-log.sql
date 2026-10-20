-- ════════════════════════════════════════════════════════════════════════════
--  56 · Step log: when each order, stock request and lens request changed step
--  STATUS: applied 2026-10-20 (by Claude)
--
--  The user (2026-10-20): the Data tab shows the average time in each step and
--  start to end. The events only say what happened in words, so the database
--  now notes every change of step by itself — a trigger on each table writes
--  (kind, row, status, at, by) on insert and whenever the status changes,
--  undo included. Nothing else changes. Outside lens orders already keep
--  their own times (ordered_at, arrived_at, sent_at, received_at).
--  Starts now: each record already there gets one row — its step as it is,
--  at its last update — so step times count from 2026-10-20.
--  Read as the record itself is (the same row rules); written only by the
--  triggers. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.step_log (
  id      bigserial primary key,
  kind    text not null check (kind in ('order', 'request', 'lens')),
  row_id  uuid not null,
  status  text not null,
  at      timestamptz not null default now(),
  by_code text
);
create index if not exists step_log_at on public.step_log (at);
create index if not exists step_log_row on public.step_log (row_id, at);

alter table public.step_log enable row level security;
revoke all on public.step_log from anon;
grant select on public.step_log to authenticated;
-- A step is readable by whoever can read its record.
drop policy if exists step_log_read on public.step_log;
create policy step_log_read on public.step_log for select to authenticated using (
  case kind
    when 'order'   then exists (select 1 from public.orders o where o.id = row_id)
    when 'request' then exists (select 1 from public.stock_requests r where r.id = row_id)
    when 'lens'    then exists (select 1 from public.lens_requests l where l.id = row_id)
  end);

create or replace function public.log_step()
 returns trigger
 language plpgsql security definer
 set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.step_log (kind, row_id, status, by_code)
    values (tg_argv[0], new.id, new.status, nullif(public.jwt_branch(), ''));
  end if;
  return new;
end $$;
revoke all on function public.log_step() from public, anon, authenticated;

drop trigger if exists orders_step_log on public.orders;
create trigger orders_step_log after insert or update of status on public.orders
  for each row execute function public.log_step('order');
drop trigger if exists stock_requests_step_log on public.stock_requests;
create trigger stock_requests_step_log after insert or update of status on public.stock_requests
  for each row execute function public.log_step('request');
drop trigger if exists lens_requests_step_log on public.lens_requests;
create trigger lens_requests_step_log after insert or update of status on public.lens_requests
  for each row execute function public.log_step('lens');

-- What is there now: one row each, its step as it stands.
insert into public.step_log (kind, row_id, status, at)
select 'order', o.id, o.status, o.updated_at from public.orders o
 where not exists (select 1 from public.step_log s where s.row_id = o.id);
insert into public.step_log (kind, row_id, status, at)
select 'request', r.id, r.status, r.updated_at from public.stock_requests r
 where not exists (select 1 from public.step_log s where s.row_id = r.id);
insert into public.step_log (kind, row_id, status, at)
select 'lens', l.id, l.status, l.updated_at from public.lens_requests l
 where not exists (select 1 from public.step_log s where s.row_id = l.id);

commit;
