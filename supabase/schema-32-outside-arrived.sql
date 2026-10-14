-- ════════════════════════════════════════════════════════════════════════════
--  32 · Outside lenses: Avenues marks them received before it sends them on
--  STATUS: applied 2026-10-14 (by Claude)
--
--  The user (2026-10-14): for Avenues (the handler) the lens follows the
--  normal steps — Waiting for Lenses once ordered from the supplier; "Lens
--  received" when they reach Avenues (Lenses Delivered); then "Send lenses"
--  (In transit) until the branch or fitter receives them.
--  outside_lens_orders gains arrived_at: the lenses are at the handler.
--    · outside_lenses_arrived(id) — the handler (or office) marks them in.
--    · send_outside_lenses refuses until they have arrived.
--    · set_outside_lens_status will not un-order lenses that have arrived.
--    · The handler's own orders: its "Lens received" on the order (the gate)
--      stamps arrived_at as well as received_at.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.outside_lens_orders add column if not exists arrived_at timestamptz;
-- Anything already sent or received had arrived.
update public.outside_lens_orders set arrived_at = coalesce(sent_at, received_at)
 where arrived_at is null and (sent_at is not null or received_at is not null);

-- ── the handler marks the lenses in from the supplier ──
create or replace function public.outside_lenses_arrived(p_id uuid) returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
  h  text := public.outside_lens_handler();
begin
  if not (me = h or public.is_admin()) then raise exception 'Only % (or the office) can mark these lenses received', h; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if x.status <> 'ordered' then raise exception 'Confirm the order first'; end if;
  if x.arrived_at is not null then return x; end if;
  update public.outside_lens_orders set arrived_at = now(), updated_at = now() where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, me, format('The outside lenses arrived at %s', h));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $$;

-- ── sending: only once they are here ──
create or replace function public.send_outside_lenses(p_id uuid) returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
  h  text := public.outside_lens_handler();
begin
  if not (me = h or public.is_admin()) then raise exception 'Only % (or the office) can send these lenses', h; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if x.dest_code = h then raise exception 'These lenses stay at %', h; end if;
  if x.status <> 'ordered' then raise exception 'Confirm the order first'; end if;
  if x.arrived_at is null then raise exception 'Mark the lenses received at % first', h; end if;
  if x.sent_at is not null then raise exception 'These lenses were already sent'; end if;
  if x.dest_code <> x.branch_code and public.bench_closed(x.dest_code) then
    raise exception '% lab is off. The branch has to choose another fitter', (select name from public.branches where code = x.dest_code);
  end if;
  update public.outside_lens_orders set sent_at = now(), updated_at = now() where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, me, format('%s sent the outside lenses to %s', h, x.dest_code));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $$;

-- ── un-ordering: not once the lenses have arrived ──
create or replace function public.set_outside_lens_status(p_ids uuid[], p_status text) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  me text := public.jwt_branch();
  n  int;
begin
  if not (me = public.outside_lens_handler() or public.is_admin()) then
    raise exception 'Only % (or the office) can confirm outside lens orders', public.outside_lens_handler();
  end if;
  if p_status not in ('to_order', 'ordered') then raise exception 'Unknown status %', p_status; end if;
  if p_status = 'to_order' and exists (
       select 1 from public.outside_lens_orders x join public.orders o on o.id = x.order_id
        where x.id = any(p_ids) and (x.arrived_at is not null or x.sent_at is not null
                                     or o.status in ('ready', 'returning', 'delivered', 'collected')
                                     or (o.fitter_code = o.origin_code and o.status = 'at_fitter'))) then
    raise exception 'Too late to undo — the lenses have arrived or cutting has started';
  end if;

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

-- ── the gate: the handler's own "Lens received" also marks them arrived ──
create or replace function public.outside_lens_gate() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  x public.outside_lens_orders;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into x from public.outside_lens_orders where order_id = new.id;
  if not found then return new; end if;
  -- The fitter cannot finish the cut before the lenses have reached it.
  if x.fulfilment = 'send_frames' and x.received_at is null and old.status = 'at_fitter' and new.status in ('ready', 'delivered') then
    raise exception 'The outside lenses have not arrived here yet';
  end if;
  -- Lenses coming to the branch: received only once sent (or, at the
  -- handler itself, once ordered).
  if x.fulfilment = 'receive_lens' and old.status = 'pending' and new.status <> 'pending' then
    if x.sent_at is null and not (x.branch_code = public.outside_lens_handler() and x.status = 'ordered') then
      raise exception 'The outside lenses have not been sent yet';
    end if;
    update public.outside_lens_orders
       set received_at = coalesce(received_at, now()), arrived_at = coalesce(arrived_at, now()), updated_at = now()
     where id = x.id;
  end if;
  return new;
end $$;

revoke all on function public.outside_lenses_arrived(uuid) from public, anon;
grant execute on function public.outside_lenses_arrived(uuid) to authenticated;

commit;
