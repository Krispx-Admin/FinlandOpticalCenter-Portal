-- ════════════════════════════════════════════════════════════════════════════
--  13 · An insurance claim records the member ID and the insurance company
--  STATUS: applied 2026-10-11 (by Claude, at the user's request)
--
--  The printed sheet is now an Invoice, and it carries the customer's member
--  ID and the insurance company the claim is for. The company is picked from a
--  list the office keeps under Settings → Insurance companies, held with the
--  other shared settings — in the database, not in the code.
--
--  Claims made before this have neither; they print a dash.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.claims
  add column if not exists member_id text,
  add column if not exists insurer   text;

create index if not exists claims_member_idx on public.claims (member_id);

alter table public.app_settings
  add column if not exists insurers jsonb not null default '[]'::jsonb;

comment on column public.claims.member_id is 'The member ID on the customer''s insurance card.';
comment on column public.claims.insurer   is 'The insurance company the claim is for — one of app_settings.insurers when it was made.';
comment on column public.app_settings.insurers is 'Insurance companies the claim form offers, in order. Edited by the office in Settings.';
