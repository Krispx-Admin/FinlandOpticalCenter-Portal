-- ════════════════════════════════════════════════════════════════════════════
--  59 · IPD on an invoice's prescription
--  STATUS: applied 2026-10-22 (by Claude)
--
--  The user (2026-10-22): Direct Insurance gets an IPD box in the middle of
--  the prescription grid — tried in the Admin Demo first. One text value per
--  invoice (e.g. "64" or "32/31"). Empty until written; nothing else reads it.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;
alter table public.claims add column if not exists ipd text;
commit;
