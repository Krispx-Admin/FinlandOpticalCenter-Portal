-- ============================================================================
--  FOC Portal — migration 02: everything else the branches share
-- ============================================================================
--  schema.sql covered claims, the fitting log and lens stock. This finishes
--  the job so NOTHING the network needs lives in one branch's browser:
--
--    · stock requests (branch → warehouse), which schema.sql left out
--    · settings (brand groups and categories), so a change at the warehouse
--      reaches every till instead of only the computer that made it
--    · server-side reference numbers — the old client-side counters would
--      hand two branches the same SR-1004 the moment they both placed a
--      request, and `ref` is unique, so one of them would simply fail
--    · Al Mouj corrected to a fitting centre
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
--  1 · Reference numbers come from the database, not the browser
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.req_seq   start 1001;
create sequence if not exists public.lens_seq  start 1001;
create sequence if not exists public.claim_seq start 3001;

-- Defaults rather than an RPC: the number is allocated inside the same insert
-- that uses it, so two simultaneous requests can never collide, and there is
-- no extra round trip.
alter table public.claims
  alter column ref set default 'IC-' || nextval('public.claim_seq');
alter table public.lens_requests
  alter column ref set default 'LR-' || nextval('public.lens_seq');

-- A fitting order's ref is the branch's own bill number, typed in by staff.
-- Two branches legitimately have a bill 4021 each, so it is unique per branch,
-- not globally — the old global constraint would reject the second one.
alter table public.orders drop constraint if exists orders_ref_key;
create unique index if not exists orders_ref_per_branch on public.orders (origin_code, ref);

-- ════════════════════════════════════════════════════════════════════════════
--  2 · Stock requests (branch → warehouse)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.stock_requests (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique default 'SR-' || nextval('public.req_seq'),
  branch_code  text not null references public.branches(code),
  status       text not null default 'placed' check (status in ('placed', 'completed')),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists stock_requests_branch_idx on public.stock_requests (branch_code);
create index if not exists stock_requests_status_idx on public.stock_requests (status, updated_at desc);

-- The category/brand/audience set is copied onto the line rather than keyed to
-- settings: a placed request must still read correctly after someone renames a
-- brand group or deletes a category.
create table if not exists public.stock_request_lines (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.stock_requests(id) on delete cascade,
  position    int  not null default 0,
  category    text not null,
  brand       text,
  audience    text,
  qty         int,
  unit        text,
  note        text
);

create index if not exists stock_request_lines_req_idx on public.stock_request_lines (request_id, position);

create table if not exists public.stock_request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.stock_requests(id) on delete cascade,
  at          timestamptz not null default now(),
  by_code     text references public.branches(code),
  text        text not null
);

create index if not exists stock_request_events_req_idx on public.stock_request_events (request_id, at);

drop trigger if exists stock_requests_touch on public.stock_requests;
create trigger stock_requests_touch before update on public.stock_requests
  for each row execute function public.touch_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
--  3 · Settings — one shared row, the warehouse's to edit
-- ════════════════════════════════════════════════════════════════════════════

-- Held as JSON because this is a small ordered document the warehouse edits
-- whole (groups, their brands, categories and their flags), never queried
-- field by field. Normalising it would buy nothing and cost four more tables.
create table if not exists public.app_settings (
  id            int primary key default 1 check (id = 1),
  brand_groups  jsonb not null default '[]'::jsonb,
  categories    jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- Seeded by the app on first run if still empty, so the defaults live in one
-- place (data.js) instead of being duplicated here and drifting.
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
--  4 · Completing a stock request, warehouse only
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.complete_stock_request(p_request uuid)
  returns public.stock_requests
  language plpgsql security definer set search_path = public as $$
declare r public.stock_requests;
begin
  if not public.is_admin() then
    raise exception 'only the warehouse may complete a request';
  end if;

  select * into r from public.stock_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if r.status <> 'placed' then raise exception 'request is already %', r.status; end if;

  update public.stock_requests set status = 'completed', updated_at = now()
   where id = p_request returning * into r;

  insert into public.stock_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(), 'Fulfilled and completed at the warehouse');

  return r;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  5 · Row level security
-- ════════════════════════════════════════════════════════════════════════════

alter table public.stock_requests       enable row level security;
alter table public.stock_request_lines  enable row level security;
alter table public.stock_request_events enable row level security;
alter table public.app_settings         enable row level security;

-- A branch sees its own requests; the warehouse sees the whole queue.
drop policy if exists stock_requests_read on public.stock_requests;
create policy stock_requests_read on public.stock_requests
  for select to authenticated
  using (branch_code = public.jwt_branch() or public.is_admin());

drop policy if exists stock_requests_insert on public.stock_requests;
create policy stock_requests_insert on public.stock_requests
  for insert to authenticated
  with check (branch_code = public.jwt_branch());

-- Completing goes through the function above; no direct updates.
drop policy if exists stock_requests_update on public.stock_requests;
create policy stock_requests_update on public.stock_requests
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists stock_lines_all on public.stock_request_lines;
create policy stock_lines_all on public.stock_request_lines
  for all to authenticated
  using (exists (select 1 from public.stock_requests r where r.id = request_id
                 and (r.branch_code = public.jwt_branch() or public.is_admin())))
  with check (exists (select 1 from public.stock_requests r where r.id = request_id
                 and r.branch_code = public.jwt_branch()));

drop policy if exists stock_events_all on public.stock_request_events;
create policy stock_events_all on public.stock_request_events
  for all to authenticated
  using (exists (select 1 from public.stock_requests r where r.id = request_id
                 and (r.branch_code = public.jwt_branch() or public.is_admin())))
  with check (exists (select 1 from public.stock_requests r where r.id = request_id
                 and (r.branch_code = public.jwt_branch() or public.is_admin())));

-- Everyone needs to read settings to compose a request; only the warehouse
-- changes them.
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════════
--  6 · Realtime
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['stock_requests', 'stock_request_lines',
                           'stock_request_events', 'app_settings'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  7 · Al Mouj is a fitting centre, not a retail branch
-- ════════════════════════════════════════════════════════════════════════════

update public.branches set role = 'fitting' where code = 'MOUJ';
