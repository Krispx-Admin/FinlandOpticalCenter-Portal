-- ════════════════════════════════════════════════════════════════════════════
--  46 · Reimbursement Invoice: paid by cash, card — or both
--  STATUS: applied 2026-10-18 (by Claude)
--
--  The user (2026-10-18): "add to reimbursement cash card or both". A
--  customer can split the payment; claims.payment takes 'both' as well, and
--  the printed invoice ticks Cash and Card. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.claims drop constraint if exists claims_payment_check;
alter table public.claims add constraint claims_payment_check check (payment in ('cash', 'card', 'both'));

commit;
