-- ════════════════════════════════════════════════════════════════════════════
--  24 · Outside lens orders (TRIAL — the user is testing whether to keep it)
--  STATUS: applied 2026-10-13 (by Claude)
--
--  A branch logging a fitting order can switch on "Outside lenses": lenses
--  from an outside brand (Essilor, Zeiss, BBGR, Creative …) that Mohammed
--  Ashraf at MGM orders from the supplier by WhatsApp. The order carries the
--  prescription (R/L: SPH, CYL, AXIS, ADD) and the lens type, typed out.
--    · The fitting order goes to MGM (it cuts them) and starts at lenses_in:
--      the frame may travel whenever — before or after the lenses arrive
--      (user: "simultaneous steps"), so the branch has Send to fitter at once.
--    · MGM's "Outside Lens Orders" tab lists them: To order → Ordered
--      (set_outside_lens_status; can be put back). Copy is done in the page.
--  The handler is MGM for the trial (outside_lens_handler()).
--  Reads: the ordering branch its own; MGM, the office and Ghiath all.
--  Writes only through the two functions. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.outside_lens_handler() returns text
  language sql immutable as $$ select 'MGM'::text $$;

create table if not exists public.outside_lens_orders (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references public.orders(id) on delete cascade,
  branch_code text not null references public.branches(code),
  rx          jsonb not null default '{}'::jsonb,   -- {r:{sph,cyl,axis,add}, l:{…}}
  lens_type   text not null,
  status      text not null default 'to_order' check (status in ('to_order', 'ordered')),
  ordered_at  timestamptz,
  ordered_by  text references public.branches(code),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists outside_lens_orders_status_idx on public.outside_lens_orders (status, created_at);

alter table public.outside_lens_orders enable row level security;
drop policy if exists outside_lens_orders_read on public.outside_lens_orders;
create policy outside_lens_orders_read on public.outside_lens_orders for select to authenticated
  using (branch_code = public.jwt_branch() or public.jwt_branch() = public.outside_lens_handler()
         or public.is_admin() or public.is_scheduler());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'outside_lens_orders') then
    alter publication supabase_realtime add table public.outside_lens_orders;
  end if;
end $$;

-- ── a branch logs a fitting order with outside lenses ──
create or replace function public.create_outside_lens_order(p_bill text, p_customer text, p_rx jsonb, p_lens_type text)
  returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  me  text := public.jwt_branch();
  h   text := public.outside_lens_handler();
  ord public.orders;
begin
  if me = '' then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if coalesce(trim(p_lens_type), '') = '' then raise exception 'Type the lens type'; end if;
  if coalesce(trim(p_rx #>> '{r,sph}'), '') = '' and coalesce(trim(p_rx #>> '{l,sph}'), '') = '' then
    raise exception 'Enter the prescription (at least the SPH)';
  end if;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, h, trim(p_customer), 'lenses_in')
  returning * into ord;

  insert into public.outside_lens_orders (order_id, branch_code, rx, lens_type)
  values (ord.id, me, coalesce(p_rx, '{}'::jsonb), trim(p_lens_type));

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Order logged at %s with outside lenses (%s) — %s orders them from the supplier%s',
            me, trim(p_lens_type), h,
            case when me = h then '' else '; send the frame whenever it is ready' end));
  return ord;
end $$;

-- ── MGM marks orders ordered (or puts them back) ──
create or replace function public.set_outside_lens_status(p_ids uuid[], p_status text) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  me text := public.jwt_branch();
  n  int;
begin
  if not (me = public.outside_lens_handler() or public.is_admin()) then
    raise exception 'Only % (or the office) can mark outside lenses ordered', public.outside_lens_handler();
  end if;
  if p_status not in ('to_order', 'ordered') then raise exception 'Unknown status %', p_status; end if;

  with changed as (
    update public.outside_lens_orders
       set status = p_status,
           ordered_at = case when p_status = 'ordered' then now() else null end,
           ordered_by = case when p_status = 'ordered' then me else null end,
           updated_at = now()
     where id = any(p_ids) and status <> p_status
    returning order_id
  ), ev as (
    insert into public.order_events (order_id, by_code, text)
    select order_id, me, case when p_status = 'ordered'
                              then 'Outside lenses ordered from the supplier'
                              else 'Outside lenses put back to "to order"' end
      from changed
    returning order_id
  )
  update public.orders o set updated_at = now() from ev where o.id = ev.order_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.create_outside_lens_order(text, text, jsonb, text) from public, anon;
revoke all on function public.set_outside_lens_status(uuid[], text)              from public, anon;
grant execute on function public.create_outside_lens_order(text, text, jsonb, text) to authenticated;
grant execute on function public.set_outside_lens_status(uuid[], text)              to authenticated;

commit;
