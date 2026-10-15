-- ════════════════════════════════════════════════════════════════════════════
--  36 · Collect at another branch, and transfers
--  STATUS: applied 2026-10-15 (by Claude)
--
--  The user (2026-10-15): a customer may collect the glasses at a branch other
--  than the one that sold them, and may change their mind later.
--    · orders.collect_code — where the customer collects (null = the branch
--      that sold it, as before).
--    · After fitting the frame goes to the collect branch, which does Frame
--      received → Ready for collection → Handed to customer.
--    · Collecting at the fitter: no return trip — Mark ready goes straight to
--      Ready for collection there.
--    · Changing it (set_collect): anyone on the order's route, or the office.
--      Before the frame leaves the fitter it just swaps the end point. A frame
--      already on its way arrives first; a frame already at a branch that is no
--      longer the collect branch waits there for a TRANSFER (status 'ready',
--      frame_at = that branch) — the route grows: MOO─MGM─QCC─SCC.
--  New columns, all managed by the route trigger and set_collect:
--    frame_at  where the frame is while 'ready' (null = the fitter) and once
--              it has arrived somewhere
--    to_code   where a 'returning' frame is heading (null = the collect branch)
--    stops     branches the frame stopped at on the way (for the journey)
--  Everyone on the route can read and update the order. Undo works on orders
--  that have not been transferred. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.orders add column if not exists collect_code text references public.branches(code);
alter table public.orders add column if not exists frame_at text references public.branches(code);
alter table public.orders add column if not exists to_code text references public.branches(code);
alter table public.orders add column if not exists stops text[] not null default '{}';

-- ── who is on an order's route ──
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
  using (origin_code = public.jwt_branch() or fitter_code = public.jwt_branch() or collect_code = public.jwt_branch()
         or to_code = public.jwt_branch() or frame_at = public.jwt_branch() or public.jwt_branch() = any(stops) or public.is_admin());
drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders for update to authenticated
  using (origin_code = public.jwt_branch() or fitter_code = public.jwt_branch() or collect_code = public.jwt_branch()
         or to_code = public.jwt_branch() or frame_at = public.jwt_branch() or public.jwt_branch() = any(stops) or public.is_admin())
  with check (origin_code = public.jwt_branch() or fitter_code = public.jwt_branch() or collect_code = public.jwt_branch()
         or to_code = public.jwt_branch() or frame_at = public.jwt_branch() or public.jwt_branch() = any(stops) or public.is_admin());
drop policy if exists order_events_all on public.order_events;
create policy order_events_all on public.order_events for all to authenticated
  using (exists (select 1 from public.orders o where o.id = order_events.order_id and (
           o.origin_code = public.jwt_branch() or o.fitter_code = public.jwt_branch() or o.collect_code = public.jwt_branch()
           or o.to_code = public.jwt_branch() or o.frame_at = public.jwt_branch() or public.jwt_branch() = any(o.stops) or public.is_admin())))
  with check (exists (select 1 from public.orders o where o.id = order_events.order_id and (
           o.origin_code = public.jwt_branch() or o.fitter_code = public.jwt_branch() or o.collect_code = public.jwt_branch()
           or o.to_code = public.jwt_branch() or o.frame_at = public.jwt_branch() or public.jwt_branch() = any(o.stops) or public.is_admin())));

-- ── the route, kept right on every step ──
create or replace function public.orders_route_gate() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  c text := coalesce(new.collect_code, new.origin_code);
  x text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if current_setting('foc.undo', true) = '1' or current_setting('foc.route', true) = '1' then return new; end if;

  if new.status = 'ready' and old.status in ('at_fitter', 'to_fitter') then
    -- Ready at the fitter (or, from an outside cutter, back at the branch).
    new.frame_at := case when new.outside_cutter is not null then new.origin_code else new.fitter_code end;
    if new.frame_at = c then new.status := 'delivered'; end if;          -- collected right here
  elsif new.status = 'delivered' and old.status = 'at_fitter' and c <> new.fitter_code then
    new.status := 'ready'; new.frame_at := new.fitter_code;             -- in-house job collected elsewhere
  elsif new.status = 'delivered' and old.status = 'to_fitter' and new.outside_cutter is not null and c <> new.origin_code then
    new.status := 'ready'; new.frame_at := new.origin_code;             -- back from the cutter, collected elsewhere
  elsif new.status = 'returning' and old.status = 'ready' then
    new.to_code := c;
  elsif new.status = 'delivered' and old.status = 'returning' then
    x := coalesce(new.to_code, c);
    new.to_code := null;
    new.frame_at := x;
    if x <> c then                                                      -- the customer moved it meanwhile: transfer from here
      new.status := 'ready';
      new.stops := new.stops || x;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_route_gate on public.orders;
create trigger orders_route_gate before update of status on public.orders
  for each row execute function public.orders_route_gate();

-- ── change where the customer collects ──
create or replace function public.set_collect(p_id uuid, p_code text) returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  me    text := public.jwt_branch();
  p     text;
  old_c text;
  l     text;
  n     int;
  note  text := '';
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (me in (o.origin_code, o.fitter_code, o.collect_code, o.to_code, o.frame_at) or me = any(o.stops) or public.is_admin()) then
    raise exception 'Only a branch on this order''s route (or the office) can change where it is collected';
  end if;
  if o.status = 'collected' then raise exception 'Already handed to the customer'; end if;
  p := coalesce(nullif(p_code, ''), o.origin_code);
  if not exists (select 1 from public.branches where code = p and active and role <> 'admin') then
    raise exception '% is not an open branch', p;
  end if;
  old_c := coalesce(o.collect_code, o.origin_code);
  if p = old_c then return o; end if;

  perform set_config('foc.route', '1', true);
  if o.status = 'ready' then
    l := coalesce(o.frame_at, case when o.outside_cutter is not null then o.origin_code else o.fitter_code end);
    if p = l then                                                       -- it is already there
      n := coalesce(array_length(o.stops, 1), 0);
      update public.orders set status = 'delivered', frame_at = l,
             stops = case when n > 0 and o.stops[n] = l then o.stops[1:n - 1] else o.stops end
       where id = p_id;
      note := ' — it is already there: ready for collection';
    end if;
  elsif o.status = 'delivered' then
    l := coalesce(o.frame_at, old_c);
    update public.orders set status = 'ready', frame_at = l,
           stops = case when l = o.fitter_code or (o.outside_cutter is not null and l = o.origin_code) then o.stops else o.stops || l end
     where id = p_id;
    note := format(' — %s transfers it', l);
  elsif o.status = 'returning' then
    note := format(' — it reaches %s first, then is transferred', coalesce(o.to_code, old_c));
  end if;
  update public.orders set collect_code = case when p = o.origin_code then null else p end, updated_at = now()
   where id = p_id returning * into o;
  perform set_config('foc.route', '', true);

  insert into public.order_events (order_id, by_code, text)
  values (p_id, coalesce(nullif(me, ''), o.origin_code), format('Collection moved: %s → %s%s', old_c, p, note));
  return o;
end $$;

-- ── undo, aware of the collect branch (not after a transfer) ──
create or replace function public.undo_order_step(p_id uuid) returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  o    public.orders;
  me   text := public.jwt_branch();
  lr   public.lens_requests;
  ol   public.outside_lens_orders;
  c    text;
  flow text[];
  i    int;
  prev text;
  keep_fitter boolean;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (me in (o.origin_code, o.fitter_code, o.collect_code, o.to_code, o.frame_at) or public.is_admin()) then
    raise exception 'Only a branch on this order''s route (or the office) can undo a step';
  end if;
  if coalesce(array_length(o.stops, 1), 0) > 0 then
    raise exception 'This frame has been transferred — change where it is collected instead';
  end if;
  select * into lr from public.lens_requests where order_id = p_id order by created_at desc limit 1;
  select * into ol from public.outside_lens_orders where order_id = p_id;
  c := coalesce(o.collect_code, o.origin_code);

  -- The road this order is on (as in the app's data.js, flowFor).
  flow := case
    when o.outside_cutter is not null then
      case when c = o.origin_code then array['pending','lenses_in','to_fitter','delivered','collected']
           else array['pending','lenses_in','to_fitter','ready','returning','delivered','collected'] end
    when o.fitter_code is not null and o.fitter_code = o.origin_code then
      case when c = o.origin_code then array['pending','lenses_in','at_fitter','delivered','collected']
           else array['pending','lenses_in','at_fitter','ready','returning','delivered','collected'] end
    when o.fitter_code is not null and c = o.fitter_code then array['pending','lenses_in','to_fitter','at_fitter','delivered','collected']
    else array['pending','lenses_in','to_fitter','at_fitter','ready','returning','delivered','collected'] end;
  i := array_position(flow, o.status);
  if i is null or i = 1 then raise exception 'Nothing to undo — this is the first step'; end if;
  prev := flow[i - 1];

  keep_fitter := (lr.id is not null and lr.fulfilment = 'send_frames') or (ol.id is not null and ol.fulfilment = 'send_frames');
  if prev = 'pending' and keep_fitter then raise exception 'Nothing to undo — this is the first step'; end if;
  if prev = 'pending' and ((lr.id is not null and lr.status in ('sent', 'confirmed')) or (ol.id is not null and ol.branch_code <> public.outside_lens_handler())) then
    raise exception 'The lenses are here — that step can''t be undone';
  end if;

  perform set_config('foc.undo', '1', true);
  update public.orders
     set status = prev,
         fitter_code = case when prev in ('pending', 'lenses_in') and not keep_fitter then null else fitter_code end,
         outside_cutter = case when prev in ('pending', 'lenses_in') then null else outside_cutter end,
         to_code = case when prev = 'returning' then c else null end,
         frame_at = case when prev = 'returning' and o.outside_cutter is not null then o.origin_code
                         when prev = 'ready' then o.frame_at
                         else null end
   where id = p_id returning * into o;
  perform set_config('foc.undo', '', true);
  if prev = 'pending' and ol.id is not null then
    update public.outside_lens_orders set received_at = null, arrived_at = null, updated_at = now() where id = ol.id;
  end if;

  insert into public.order_events (order_id, by_code, text)
  values (p_id, coalesce(nullif(me, ''), o.origin_code), format('Step undone — back to %s', prev));
  return o;
end $$;

revoke all on function public.set_collect(uuid, text) from public, anon;
grant execute on function public.set_collect(uuid, text) to authenticated;

commit;
