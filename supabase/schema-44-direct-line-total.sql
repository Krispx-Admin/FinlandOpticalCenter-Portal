-- ════════════════════════════════════════════════════════════════════════════
--  44 · Direct Insurance: the price typed is the line's total
--  STATUS: applied 2026-10-17 (by Claude)
--
--  The user (2026-10-17): "for direct insurance make sure the price put in is
--  total not each". On Direct Insurance a product line's price is what the
--  whole line costs (2 lenses for 40.000 → 40.000), so the record's total is
--  the sum of the prices. The Reimbursement Invoice keeps schema-35's rule:
--  price per piece, a line is price × qty. Existing Direct Insurance records
--  are recounted the new way. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.recalc_claim_total() returns trigger
  language plpgsql as $$
declare target uuid := coalesce(new.claim_id, old.claim_id);
begin
  update public.claims c
     set total = coalesce((select sum(case when c.kind = 'direct' then i.price else i.price * i.qty end)
                             from public.claim_items i where i.claim_id = target), 0),
         updated_at = now()
   where c.id = target;
  return null;
end $$;

update public.claims c
   set total = coalesce((select sum(i.price) from public.claim_items i where i.claim_id = c.id), 0)
 where c.kind = 'direct';

commit;
