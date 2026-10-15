-- ════════════════════════════════════════════════════════════════════════════
--  34 · Fix mistakes on a fitting order: edit, undo the last step, delete
--  STATUS: applied 2026-10-15 (by Claude)
--
--  The user (2026-10-15), choices made:
--    · WHO: the branch that logged the order, or the office. (Undo: also the
--      fitting centre on the order — it presses half the steps.)
--    · EDIT: bill number + customer name, any stage; the outside-lens
--      prescription + lens type until Avenues has confirmed the order.
--    · UNDO: the order goes back one step.
--    · DELETE: only while nothing has moved — the frame not yet sent, no
--      lenses sent, an outside lens order not yet confirmed. Stock lenses it
--      had reserved go back on the shelf.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── edit the bill number and the customer ──
create or replace function public.edit_order(p_id uuid, p_ref text, p_customer text) returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  o   public.orders;
  me  text := public.jwt_branch();
  v_ref text := trim(coalesce(p_ref, ''));
  v_cus text := trim(coalesce(p_customer, ''));
  what text[] := '{}';
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (o.origin_code = me or public.is_admin()) then raise exception 'Only % (or the office) can edit this order', o.origin_code; end if;
  if v_ref = '' then raise exception 'A bill number is needed'; end if;
  if v_cus = '' then raise exception 'A customer name is needed'; end if;
  if v_ref = o.ref and v_cus = coalesce(o.customer, '') then return o; end if;
  if v_ref <> o.ref then what := what || format('bill %s → %s', o.ref, v_ref); end if;
  if v_cus <> coalesce(o.customer, '') then what := what || format('customer %s → %s', coalesce(nullif(o.customer, ''), '—'), v_cus); end if;
  update public.orders set ref = v_ref, customer = v_cus where id = p_id returning * into o;
  -- The lens request carries the same bill and name.
  update public.lens_requests set note = v_ref, customer = v_cus, updated_at = now() where order_id = p_id;
  insert into public.order_events (order_id, by_code, text)
  values (p_id, coalesce(nullif(me, ''), o.origin_code), 'Edited: ' || array_to_string(what, '; '));
  return o;
end $$;

-- ── edit the outside-lens prescription and lens type ──
create or replace function public.edit_outside_lens(p_id uuid, p_rx jsonb, p_lens_type text) returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
begin
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if not (x.branch_code = me or public.is_admin()) then raise exception 'Only % (or the office) can edit this', x.branch_code; end if;
  if x.status <> 'to_order' then raise exception 'Too late to change — % has already confirmed the order with the supplier', public.outside_lens_handler(); end if;
  if coalesce(trim(p_lens_type), '') = '' then raise exception 'Type the lens type'; end if;
  if coalesce(trim(p_rx #>> '{r,sph}'), '') = '' and coalesce(trim(p_rx #>> '{l,sph}'), '') = '' then
    raise exception 'Enter the prescription (at least the SPH)';
  end if;
  update public.outside_lens_orders set rx = coalesce(p_rx, '{}'::jsonb), lens_type = trim(p_lens_type), updated_at = now()
   where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, coalesce(nullif(me, ''), x.branch_code), format('Edited: outside lenses — %s', trim(p_lens_type)));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $$;

-- The lab gate (schema-33) skips a step being undone.
create or replace function public.bench_lock_gate() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if current_setting('foc.undo', true) = '1' then return new; end if;
  -- Another branch's frame cannot go to a lab that is off or in-house only.
  if new.status = 'to_fitter' and new.fitter_code is not null and public.bench_closed(new.fitter_code) then
    raise exception '% is not taking frames — lab %', (select name from public.branches where code = new.fitter_code),
      case when public.bench_off(new.fitter_code) then 'off' else 'in-house only' end;
  end if;
  -- A branch's own job: only when its lab is off altogether.
  if new.status = 'at_fitter' and old.status in ('pending', 'lenses_in') and new.fitter_code = new.origin_code
     and public.bench_off(new.fitter_code) then
    raise exception 'Your lab is off. Send it to another fitter';
  end if;
  return new;
end $$;

-- ── undo the last step ──
create or replace function public.undo_order_step(p_id uuid) returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  o    public.orders;
  me   text := public.jwt_branch();
  lr   public.lens_requests;
  ol   public.outside_lens_orders;
  flow text[];
  i    int;
  prev text;
  keep_fitter boolean;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (o.origin_code = me or o.fitter_code = me or public.is_admin()) then
    raise exception 'Only % or its fitting centre (or the office) can undo a step', o.origin_code;
  end if;
  select * into lr from public.lens_requests where order_id = p_id order by created_at desc limit 1;
  select * into ol from public.outside_lens_orders where order_id = p_id;

  -- The road this order is on (as in the app's data.js).
  flow := case
    when o.outside_cutter is not null then array['pending','lenses_in','to_fitter','delivered','collected']
    when o.fitter_code is not null and o.fitter_code = o.origin_code then array['pending','lenses_in','at_fitter','delivered','collected']
    else array['pending','lenses_in','to_fitter','at_fitter','ready','returning','delivered','collected'] end;
  i := array_position(flow, o.status);
  if i is null or i = 1 then raise exception 'Nothing to undo — this is the first step'; end if;
  prev := flow[i - 1];

  -- An order that starts with its frame going to a fitter has no step before.
  keep_fitter := (lr.id is not null and lr.fulfilment = 'send_frames') or (ol.id is not null and ol.fulfilment = 'send_frames');
  if prev = 'pending' and keep_fitter then raise exception 'Nothing to undo — this is the first step'; end if;
  -- Lenses that came from someone else: once they are marked in, that stays.
  if prev = 'pending' and ((lr.id is not null and lr.status in ('sent', 'confirmed')) or (ol.id is not null and ol.branch_code <> public.outside_lens_handler())) then
    raise exception 'The lenses are here — that step can''t be undone';
  end if;

  -- Going back is never "sending" — the lab gate lets it through.
  perform set_config('foc.undo', '1', true);
  update public.orders
     set status = prev,
         -- back before the frame left: the fitter is chosen again when it is sent
         fitter_code = case when prev in ('pending', 'lenses_in') and not keep_fitter then null else fitter_code end,
         outside_cutter = case when prev in ('pending', 'lenses_in') then null else outside_cutter end
   where id = p_id returning * into o;
  perform set_config('foc.undo', '', true);
  -- The handler's own outside lenses: un-mark them in.
  if prev = 'pending' and ol.id is not null then
    update public.outside_lens_orders set received_at = null, arrived_at = null, updated_at = now() where id = ol.id;
  end if;

  insert into public.order_events (order_id, by_code, text)
  values (p_id, coalesce(nullif(me, ''), o.origin_code), format('Step undone — back to %s', prev));
  return o;
end $$;

-- ── delete, while nothing has moved ──
create or replace function public.delete_order(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  o  public.orders;
  me text := public.jwt_branch();
  lr public.lens_requests;
  ol public.outside_lens_orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (o.origin_code = me or public.is_admin()) then raise exception 'Only % (or the office) can delete this order', o.origin_code; end if;
  if o.status not in ('pending', 'lenses_in') then raise exception 'Too late to delete — the frame has already moved. Undo the steps first'; end if;
  select * into ol from public.outside_lens_orders where order_id = p_id;
  if ol.id is not null and ol.status <> 'to_order' then
    raise exception 'Too late to delete — % has already confirmed the outside lenses with the supplier', public.outside_lens_handler();
  end if;
  for lr in select * from public.lens_requests where order_id = p_id for update loop
    if lr.status in ('sent', 'confirmed') then raise exception 'Too late to delete — the stock lenses have been sent'; end if;
    -- Reserved or requested lenses go back on the shelf (declined ones already did).
    if lr.status in ('reserved', 'requested') then
      update public.lens_stock s set qty = s.qty + l.qty, updated_at = now()
        from public.lens_request_lines l where l.request_id = lr.id and s.id = l.stock_id;
    end if;
    delete from public.lens_requests where id = lr.id;
  end loop;
  delete from public.orders where id = p_id;   -- events and the outside lens order go with it
end $$;

revoke all on function public.edit_order(uuid, text, text) from public, anon;
revoke all on function public.edit_outside_lens(uuid, jsonb, text) from public, anon;
revoke all on function public.undo_order_step(uuid) from public, anon;
revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.edit_order(uuid, text, text) to authenticated;
grant execute on function public.edit_outside_lens(uuid, jsonb, text) to authenticated;
grant execute on function public.undo_order_step(uuid) to authenticated;
grant execute on function public.delete_order(uuid) to authenticated;

commit;
