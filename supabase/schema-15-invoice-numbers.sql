-- ════════════════════════════════════════════════════════════════════════════
--  15 · Insurance claims are numbered INV-…, not IC-…
--  STATUS: applied 2026-10-11 (by Claude)
--
--  The printed sheet is an invoice, so its number says so. New claims take
--  INV- and the next number of the same sequence; the claims already made are
--  renamed to match (the number after the prefix is kept). Direct Insurance
--  keeps DI-…: its trigger now turns INV- into DI- the way it turned IC- into DI-.
--  Nothing else points at a claim by its reference — items and prescriptions
--  hold the claim's id — so renaming is safe. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.claims
  alter column ref set default 'INV-' || nextval('public.claim_seq');

create or replace function public.claims_ref_by_kind() returns trigger
  language plpgsql as $$
begin
  if new.kind = 'direct' then
    if new.ref like 'INV-%' then new.ref := 'DI-' || substr(new.ref, 5);
    elsif new.ref like 'IC-%' then new.ref := 'DI-' || substr(new.ref, 4);
    end if;
  end if;
  return new;
end $$;

-- The claims already made, renamed without looking freshly edited.
alter table public.claims disable trigger claims_touch;
update public.claims set ref = 'INV-' || substr(ref, 4) where ref like 'IC-%';
alter table public.claims enable trigger claims_touch;

commit;
