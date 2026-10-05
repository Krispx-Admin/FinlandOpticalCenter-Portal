-- ============================================================================
--  FOC Portal — Postgres schema
--  Covers: Insurance Claim Receipts · Fitting Log · Lens Stock
-- ============================================================================
--  STATUS: not yet applied. Run this in the Supabase SQL editor (or let the
--  build apply it). Creating the tables does NOT make the app use them — the
--  portal still reads and writes localStorage until it is rewired.
--
--  Security model, in one paragraph: every staff login is a Supabase Auth user
--  carrying a branch_code in its app_metadata, which is set server-side and so
--  cannot be forged by the browser. Every policy below keys off that claim.
--  Row level security is ON for every table with no permissive default, so a
--  leaked anon key on its own reads nothing.
--
--  Not covered yet: Stock Requests and Settings (categories / brand groups),
--  which stay on localStorage for now. They slot in the same way when wanted.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ════════════════════════════════════════════════════════════════════════════
--  1 · Locations and identity helpers
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.branches (
  code              text primary key,
  name              text not null,
  role              text not null check (role in ('retail', 'fitting', 'clinic', 'admin')),
  holds_lens_stock  boolean not null default false,   -- the branch keeping the loose-lens shelf
  created_at        timestamptz not null default now()
);

comment on table public.branches is
  'Portal locations. A staff login is tied to one of these via app_metadata.branch_code.';

-- The signed-in branch, read from the JWT. Empty string when unauthenticated,
-- which never matches a real code, so policies simply deny.
create or replace function public.jwt_branch() returns text
  language sql stable
  as $$ select coalesce(auth.jwt() -> 'app_metadata' ->> 'branch_code', '') $$;

-- security definer so these can read branches without tripping its own RLS.
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.role = 'admin') $$;

create or replace function public.is_lens_owner() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.holds_lens_stock) $$;

-- Shared updated_at trigger.
create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  2 · Insurance claim receipts
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.claims (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,                       -- IC-3042
  claim_date   date not null,
  branch_code  text not null references public.branches(code),
  bill_no      text,
  customer     text not null,
  payment      text not null default 'cash' check (payment in ('cash', 'card')),

  -- Add and S.H. sit outside the Distance/Near rows on the form, one per eye.
  add_od text, add_os text,
  sh_od  text, sh_os  text,

  -- Maintained by trigger so the printed total can never drift from the lines.
  total        numeric(12, 3) not null default 0,

  created_by   text references public.branches(code),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists claims_branch_idx   on public.claims (branch_code);
create index if not exists claims_date_idx     on public.claims (claim_date desc);
create index if not exists claims_customer_idx on public.claims (customer);

create table if not exists public.claim_items (
  id        uuid primary key default gen_random_uuid(),
  claim_id  uuid not null references public.claims(id) on delete cascade,
  position  int  not null default 0,                       -- preserves printed order
  name      text not null,
  price     numeric(12, 3) not null default 0 check (price >= 0)
);

create index if not exists claim_items_claim_idx on public.claim_items (claim_id, position);

-- One row per line of the printed grid: 'd' (Distance) and 'n' (Near).
-- IPD is shared across both eyes on a line, exactly as the form prints it.
create table if not exists public.claim_prescriptions (
  claim_id  uuid not null references public.claims(id) on delete cascade,
  line      text not null check (line in ('d', 'n')),
  od_sph text, od_cyl text, od_axis text, od_va text,
  ipd    text,
  os_sph text, os_cyl text, os_axis text, os_va text,
  primary key (claim_id, line)
);

comment on column public.claim_prescriptions.od_sph is
  'Powers are text on purpose: opticians write -2.25, +2.00, PL, 6/6, N5 — values a numeric column would reject or mangle.';

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

drop trigger if exists claims_touch on public.claims;
create trigger claims_touch before update on public.claims
  for each row execute function public.touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
--  3 · Fitting log
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,                       -- B-58214
  origin_code  text not null references public.branches(code),
  fitter_code  text references public.branches(code),      -- null until sent
  customer     text,
  phone        text,
  brand        text,
  model        text,
  lens         text,
  urgent       boolean not null default false,
  note         text,
  status       text not null default 'pending'
               check (status in ('pending','to_fitter','at_fitter','ready','returning','delivered')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists orders_origin_idx on public.orders (origin_code);
create index if not exists orders_fitter_idx on public.orders (fitter_code);
create index if not exists orders_status_idx on public.orders (status, updated_at desc);

-- The audit trail shown in the order drawer.
create table if not exists public.order_events (
  id        uuid primary key default gen_random_uuid(),
  order_id  uuid not null references public.orders(id) on delete cascade,
  at        timestamptz not null default now(),
  by_code   text references public.branches(code),
  text      text not null
);

create index if not exists order_events_order_idx on public.order_events (order_id, at);

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
--  4 · Lens stock
-- ════════════════════════════════════════════════════════════════════════════

-- "type" and "index" are awkward identifiers in SQL, hence the lens_ prefix.
create table if not exists public.lens_stock (
  id          uuid primary key default gen_random_uuid(),
  lens_type   text not null check (lens_type in ('Single vision','Bifocal','Progressive')),
  lens_index  text not null,                               -- 1.50 … 1.74
  coating     text not null default 'None',
  sph         numeric(5, 2) not null,
  cyl         numeric(5, 2) not null default 0,
  qty         int not null default 0 check (qty >= 0),
  updated_at  timestamptz not null default now(),
  -- One row per distinct lens spec; topping up adds to qty rather than
  -- creating a duplicate, matching how the app already behaves.
  unique (lens_type, lens_index, coating, sph, cyl)
);

create table if not exists public.lens_requests (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,                       -- LR-2043
  branch_code  text not null references public.branches(code),
  status       text not null default 'requested'
               check (status in ('requested','confirmed','declined')),
  note         text,
  reason       text,                                       -- why it was declined
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists lens_requests_branch_idx on public.lens_requests (branch_code);
create index if not exists lens_requests_status_idx on public.lens_requests (status, updated_at desc);

-- The spec is copied onto the line, not just referenced: a request is a record
-- of what was asked for, and must still read correctly if the shelf row is
-- later edited or removed.
create table if not exists public.lens_request_lines (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.lens_requests(id) on delete cascade,
  stock_id    uuid references public.lens_stock(id) on delete set null,
  lens_type   text not null,
  lens_index  text not null,
  coating     text not null default 'None',
  sph         numeric(5, 2) not null,
  cyl         numeric(5, 2) not null default 0,
  qty         int not null check (qty > 0)
);

create index if not exists lens_request_lines_req_idx on public.lens_request_lines (request_id);

create table if not exists public.lens_request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.lens_requests(id) on delete cascade,
  at          timestamptz not null default now(),
  by_code     text references public.branches(code),
  text        text not null
);

drop trigger if exists lens_requests_touch on public.lens_requests;
create trigger lens_requests_touch before update on public.lens_requests
  for each row execute function public.touch_updated_at();

-- Confirming a request ships the lenses, so the shelf must come down with it,
-- and it must happen atomically — two branches confirming at once cannot both
-- claim the last lens. Doing it in the database rather than the browser is the
-- only way to guarantee that.
create or replace function public.confirm_lens_request(p_request uuid)
  returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  r public.lens_requests;
  l record;
  give int;
  sent int := 0;
  short text[] := '{}';
begin
  if not (public.is_lens_owner() or public.is_admin()) then
    raise exception 'only the lens-holding branch may confirm requests';
  end if;

  select * into r from public.lens_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'requested' then raise exception 'request is already %', r.status; end if;

  for l in select * from public.lens_request_lines where request_id = p_request loop
    -- Lock the shelf row so a concurrent confirm cannot oversell it.
    select least(qty, l.qty) into give from public.lens_stock where id = l.stock_id for update;
    give := coalesce(give, 0);
    if give < l.qty then
      short := short || format('%s %s %s SPH %s — %s of %s',
                               l.lens_type, l.lens_index, l.coating, l.sph, give, l.qty);
    end if;
    if give > 0 then
      update public.lens_stock set qty = qty - give, updated_at = now() where id = l.stock_id;
      sent := sent + give;
    end if;
  end loop;

  update public.lens_requests set status = 'confirmed', updated_at = now()
   where id = p_request returning * into r;

  insert into public.lens_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(),
          format('Confirmed — %s pcs deducted from stock and sent to %s', sent, r.branch_code));

  if array_length(short, 1) is not null then
    insert into public.lens_request_events (request_id, by_code, text)
    values (p_request, public.jwt_branch(), 'Short on: ' || array_to_string(short, '; '));
  end if;

  return r;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  5 · Row level security
-- ════════════════════════════════════════════════════════════════════════════

alter table public.branches            enable row level security;
alter table public.claims              enable row level security;
alter table public.claim_items         enable row level security;
alter table public.claim_prescriptions enable row level security;
alter table public.orders              enable row level security;
alter table public.order_events        enable row level security;
alter table public.lens_stock          enable row level security;
alter table public.lens_requests       enable row level security;
alter table public.lens_request_lines  enable row level security;
alter table public.lens_request_events enable row level security;

-- Everyone signed in can see the location list; nobody edits it from the app.
drop policy if exists branches_read on public.branches;
create policy branches_read on public.branches
  for select to authenticated using (true);

-- ── Claims: a branch sees its own, the warehouse sees all ──
drop policy if exists claims_read on public.claims;
create policy claims_read on public.claims
  for select to authenticated
  using (branch_code = public.jwt_branch() or public.is_admin());

drop policy if exists claims_write on public.claims;
create policy claims_write on public.claims
  for insert to authenticated
  with check (branch_code = public.jwt_branch() or public.is_admin());

drop policy if exists claims_update on public.claims;
create policy claims_update on public.claims
  for update to authenticated
  using (branch_code = public.jwt_branch() or public.is_admin())
  with check (branch_code = public.jwt_branch() or public.is_admin());

drop policy if exists claims_delete on public.claims;
create policy claims_delete on public.claims
  for delete to authenticated
  using (branch_code = public.jwt_branch() or public.is_admin());

-- Children inherit their parent's visibility.
drop policy if exists claim_items_all on public.claim_items;
create policy claim_items_all on public.claim_items
  for all to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_id
                 and (c.branch_code = public.jwt_branch() or public.is_admin())))
  with check (exists (select 1 from public.claims c where c.id = claim_id
                 and (c.branch_code = public.jwt_branch() or public.is_admin())));

drop policy if exists claim_rx_all on public.claim_prescriptions;
create policy claim_rx_all on public.claim_prescriptions
  for all to authenticated
  using (exists (select 1 from public.claims c where c.id = claim_id
                 and (c.branch_code = public.jwt_branch() or public.is_admin())))
  with check (exists (select 1 from public.claims c where c.id = claim_id
                 and (c.branch_code = public.jwt_branch() or public.is_admin())));

-- ── Fitting log: the origin branch and the assigned fitter both see the job ──
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select to authenticated
  using (origin_code = public.jwt_branch() or fitter_code = public.jwt_branch() or public.is_admin());

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert to authenticated
  with check (origin_code = public.jwt_branch() or public.is_admin());

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (origin_code = public.jwt_branch() or fitter_code = public.jwt_branch() or public.is_admin())
  with check (origin_code = public.jwt_branch() or fitter_code = public.jwt_branch() or public.is_admin());

drop policy if exists order_events_all on public.order_events;
create policy order_events_all on public.order_events
  for all to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.origin_code = public.jwt_branch() or o.fitter_code = public.jwt_branch() or public.is_admin())))
  with check (exists (select 1 from public.orders o where o.id = order_id
                 and (o.origin_code = public.jwt_branch() or o.fitter_code = public.jwt_branch() or public.is_admin())));

-- ── Lens stock: everyone browses the shelf, only the holder edits it ──
drop policy if exists lens_stock_read on public.lens_stock;
create policy lens_stock_read on public.lens_stock
  for select to authenticated using (true);

drop policy if exists lens_stock_write on public.lens_stock;
create policy lens_stock_write on public.lens_stock
  for all to authenticated
  using (public.is_lens_owner() or public.is_admin())
  with check (public.is_lens_owner() or public.is_admin());

-- ── Lens requests: the asking branch and the holder ──
drop policy if exists lens_requests_read on public.lens_requests;
create policy lens_requests_read on public.lens_requests
  for select to authenticated
  using (branch_code = public.jwt_branch() or public.is_lens_owner() or public.is_admin());

drop policy if exists lens_requests_insert on public.lens_requests;
create policy lens_requests_insert on public.lens_requests
  for insert to authenticated
  with check (branch_code = public.jwt_branch());

-- Only the holder answers a request; confirming goes through the function above
-- so the stock deduction stays atomic.
drop policy if exists lens_requests_update on public.lens_requests;
create policy lens_requests_update on public.lens_requests
  for update to authenticated
  using (public.is_lens_owner() or public.is_admin())
  with check (public.is_lens_owner() or public.is_admin());

drop policy if exists lens_lines_all on public.lens_request_lines;
create policy lens_lines_all on public.lens_request_lines
  for all to authenticated
  using (exists (select 1 from public.lens_requests r where r.id = request_id
                 and (r.branch_code = public.jwt_branch() or public.is_lens_owner() or public.is_admin())))
  with check (exists (select 1 from public.lens_requests r where r.id = request_id
                 and r.branch_code = public.jwt_branch()));

drop policy if exists lens_events_all on public.lens_request_events;
create policy lens_events_all on public.lens_request_events
  for all to authenticated
  using (exists (select 1 from public.lens_requests r where r.id = request_id
                 and (r.branch_code = public.jwt_branch() or public.is_lens_owner() or public.is_admin())))
  with check (exists (select 1 from public.lens_requests r where r.id = request_id
                 and (r.branch_code = public.jwt_branch() or public.is_lens_owner() or public.is_admin())));

-- ════════════════════════════════════════════════════════════════════════════
--  6 · Realtime — replaces BroadcastChannel, so branches on different
--      computers see each other's changes, not just tabs in one browser.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table
  public.claims, public.claim_items, public.claim_prescriptions,
  public.orders, public.order_events,
  public.lens_stock, public.lens_requests, public.lens_request_lines, public.lens_request_events;

-- ════════════════════════════════════════════════════════════════════════════
--  7 · Seed the locations
-- ════════════════════════════════════════════════════════════════════════════

insert into public.branches (code, name, role, holds_lens_stock) values
  ('MOUJ',   'Al Mouj',           'retail',  false),
  ('SCC',    'Seeb City Centre',  'retail',  false),
  ('AV',     'Avenues Mall',      'retail',  false),
  ('QCC',    'Qurum City Centre', 'retail',  false),
  ('SLS',    'Salalah Shop',      'retail',  false),
  ('SUR',    'Sur',               'retail',  false),
  ('MOO',    'Mall of Oman',      'fitting', false),
  ('MGM',    'Muscat Grand Mall', 'fitting', true),    -- holds the lens shelf
  ('QURFEC', 'Qurum FEC',         'clinic',  false),
  ('SALFEC', 'Salalah FEC',       'clinic',  false),
  ('SOHFEC', 'Sohar FEC',         'clinic',  false),
  ('NIZFEC', 'Nizwa FEC',         'clinic',  false),
  ('WH',     'Warehouse (admin)', 'admin',   false)
on conflict (code) do update
  set name = excluded.name, role = excluded.role, holds_lens_stock = excluded.holds_lens_stock;

-- ════════════════════════════════════════════════════════════════════════════
--  8 · Still to do, outside this file
-- ════════════════════════════════════════════════════════════════════════════
--   · One Supabase Auth user per location, each with
--       app_metadata = { "branch_code": "MGM" }
--     set through the admin API. It must be app_metadata, not user_metadata:
--     user_metadata is editable by the signed-in user, so a branch could
--     rewrite its own code and read everyone else's claims.
--   · Rewire the app: supabase-js client, real sign-in replacing the PIN
--     screen, and async reads/writes in place of the synchronous store.
--   · Stock Requests and Settings still live in localStorage.
-- ============================================================================
