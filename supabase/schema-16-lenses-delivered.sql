-- ════════════════════════════════════════════════════════════════════════════
--  16 · Fitting Log: a "Lenses Delivered" step before the frame goes on the road
--  STATUS: applied 2026-10-11 (by Claude)
--
--  Between waiting for the lenses and handing the job to the driver, the branch
--  now says the lenses have arrived: pending → lenses_in → to_fitter. The
--  fitting centre is still chosen when it is sent (from lenses_in). Orders
--  kept in-house (fitter = origin) keep their short road, pending → at_fitter.
--  The only rule the database holds about statuses is this check, so it is the
--  only thing that changes. Nothing existing moves. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','lenses_in','to_fitter','at_fitter','ready','returning','delivered'));

commit;
