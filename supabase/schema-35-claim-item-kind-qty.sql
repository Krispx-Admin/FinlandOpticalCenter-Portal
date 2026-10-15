-- ════════════════════════════════════════════════════════════════════════════
--  35 · Invoice products: a frame or lenses, and how many
--  STATUS: applied 2026-10-15 (by Claude)
--
--  The user (2026-10-15): on a Reimbursement Invoice (and Direct Insurance,
--  which shares the form) a product is added as a frame or as lenses, with
--  a quantity. claim_items gains kind ('frame' | 'lens'; empty on older
--  rows) and qty (default 1). The price is per piece, so a line is
--  price × qty and the claim's total follows. Existing rows keep qty 1, so
--  no total changes. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.claim_items add column if not exists kind text;
alter table public.claim_items add column if not exists qty integer not null default 1;
alter table public.claim_items drop constraint if exists claim_items_kind_check;
alter table public.claim_items add constraint claim_items_kind_check check (kind is null or kind in ('frame', 'lens'));
alter table public.claim_items drop constraint if exists claim_items_qty_check;
alter table public.claim_items add constraint claim_items_qty_check check (qty > 0);

create or replace function public.recalc_claim_total() returns trigger
  language plpgsql as $$
declare target uuid := coalesce(new.claim_id, old.claim_id);
begin
  update public.claims
     set total = coalesce((select sum(price * qty) from public.claim_items where claim_id = target), 0),
         updated_at = now()
   where id = target;
  return null;
end $$;

commit;
