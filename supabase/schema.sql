-- ============================================================================
--  FOC Portal — Insurance Claim Receipts schema
-- ============================================================================
--  STATUS: NOT CONNECTED. The portal currently keeps everything in the
--  browser's localStorage and shares it between tabs with BroadcastChannel —
--  there is no backend, no network call and no Supabase client in the app.
--
--  This file is the table design, ready to run in the Supabase SQL editor
--  whenever you decide to put the data on a real database. Running it creates
--  the tables; it does NOT make the app use them. See the notes at the bottom
--  for what wiring it up would involve.
--
--  Shapes mirror the printed receipt exactly, so a row maps onto a sheet
--  one-for-one.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Branches ────────────────────────────────────────────────────────────────
-- The portal's locations (MOUJ, SCC, MGM, WH …) as real rows, so claims can
-- reference them instead of repeating a code string.
create table if not exists public.branches (
  code        text primary key,
  name        text not null,
  role        text not null check (role in ('retail', 'fitting', 'clinic', 'admin')),
  created_at  timestamptz not null default now()
);

-- ── Claim header ────────────────────────────────────────────────────────────
create table if not exists public.claims (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,                    -- IC-3042
  claim_date   date not null,                           -- the date on the sheet
  branch_code  text not null references public.branches(code),
  bill_no      text,
  customer     text not null,
  payment      text not null default 'cash' check (payment in ('cash', 'card')),

  -- Add and S.H. sit outside the Distance/Near rows on the form, one per eye.
  add_od       text,
  add_os       text,
  sh_od        text,
  sh_os        text,

  -- Kept as a stored column so totals cannot drift from the line items.
  total        numeric(12, 3) not null default 0,

  created_by   text,                                    -- branch code that raised it
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists claims_branch_idx   on public.claims (branch_code);
create index if not exists claims_date_idx     on public.claims (claim_date desc);
create index if not exists claims_customer_idx on public.claims (customer);

-- ── Product lines ───────────────────────────────────────────────────────────
create table if not exists public.claim_items (
  id        uuid primary key default gen_random_uuid(),
  claim_id  uuid not null references public.claims(id) on delete cascade,
  position  int  not null default 0,                    -- keeps the printed order
  name      text not null,
  price     numeric(12, 3) not null default 0 check (price >= 0)
);

create index if not exists claim_items_claim_idx on public.claim_items (claim_id, position);

-- ── Prescription ────────────────────────────────────────────────────────────
-- One row per claim per line of the grid: 'd' (Distance) and 'n' (Near).
-- IPD is shared across both eyes on a line, exactly as the form prints it.
create table if not exists public.claim_prescriptions (
  claim_id  uuid not null references public.claims(id) on delete cascade,
  line      text not null check (line in ('d', 'n')),

  od_sph    text, od_cyl text, od_axis text, od_va text,
  ipd       text,
  os_sph    text, os_cyl text, os_axis text, os_va text,

  primary key (claim_id, line)
);

-- Powers are stored as text on purpose: opticians write "-2.25", "+2.00",
-- "PL", "6/6", "N5" — values a numeric column would reject or mangle.

-- ── Keep claims.total honest ────────────────────────────────────────────────
create or replace function public.recalc_claim_total() returns trigger
language plpgsql as $$
declare target uuid := coalesce(new.claim_id, old.claim_id);
begin
  update public.claims
     set total = coalesce((select sum(price) from public.claim_items where claim_id = target), 0),
         updated_at = now()
   where id = target;
  return null;
end $$;

drop trigger if exists claim_items_total on public.claim_items;
create trigger claim_items_total
  after insert or update or delete on public.claim_items
  for each row execute function public.recalc_claim_total();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists claims_touch on public.claims;
create trigger claims_touch
  before update on public.claims
  for each row execute function public.touch_updated_at();

-- ── Row level security ──────────────────────────────────────────────────────
-- Enabled with NO permissive policy, so nothing is readable until you decide
-- how the app authenticates. Leaving RLS off would expose every claim —
-- customer names and prescriptions — to anyone holding the anon key.
alter table public.branches            enable row level security;
alter table public.claims              enable row level security;
alter table public.claim_items         enable row level security;
alter table public.claim_prescriptions enable row level security;

-- Example once real auth exists (a branch sees its own claims, admin sees all):
--
-- create policy claims_read on public.claims for select
--   using (
--     branch_code = (auth.jwt() ->> 'branch_code')
--     or (auth.jwt() ->> 'role') = 'admin'
--   );

-- ── Seed the locations the portal already knows about ───────────────────────
insert into public.branches (code, name, role) values
  ('MOUJ',   'Al Mouj',             'retail'),
  ('SCC',    'Seeb City Centre',    'retail'),
  ('AV',     'Avenues Mall',        'retail'),
  ('QCC',    'Qurum City Centre',   'retail'),
  ('SLS',    'Salalah Shop',        'retail'),
  ('SUR',    'Sur',                 'retail'),
  ('MOO',    'Mall of Oman',        'fitting'),
  ('MGM',    'Muscat Grand Mall',   'fitting'),
  ('QURFEC', 'Qurum FEC',           'clinic'),
  ('SALFEC', 'Salalah FEC',         'clinic'),
  ('SOHFEC', 'Sohar FEC',           'clinic'),
  ('NIZFEC', 'Nizwa FEC',           'clinic'),
  ('WH',     'Warehouse (admin)',   'admin')
on conflict (code) do nothing;

-- ============================================================================
--  To actually connect this, the app would need:
--
--  1. A Supabase project, and its URL + anon key available to the page.
--  2. The Supabase JS client loaded (the app has no build step, so an ESM
--     import from a CDN).
--  3. js/store.js reworked: it is synchronous today — load() reads
--     localStorage and every mutation calls commit() straight away. Talking to
--     a database makes all of that asynchronous, so each module's mount/render
--     path has to cope with data arriving later, and with it failing.
--  4. Real authentication. Right now "signing in" is a 4-digit PIN compared in
--     client-side JavaScript, which is not a credential anyone could enforce a
--     database policy against.
--  5. Supabase Realtime in place of BroadcastChannel, so branches on different
--     computers see each other's changes — today "live sync" only spans tabs
--     in one browser.
-- ============================================================================
