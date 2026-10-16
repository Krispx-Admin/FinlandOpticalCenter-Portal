-- ════════════════════════════════════════════════════════════════════════════
--  42 · A lens holder uses its own lens stock
--  STATUS: applied 2026-10-17 (by Claude)
--
--  The user (2026-10-17): MGM, logging a fitting order, picks "Lens stock" and
--  takes lenses from its OWN shelf (create_lens_request only asks another
--  branch's shelf). use_own_lens_stock takes them off the shelf at once and
--  opens the order with the lenses in hand (status lenses_in, no fitter yet —
--  "Send to Fitter": keep it in-house or send it). The lenses are recorded as
--  a lens request from the branch to itself, status 'confirmed', so the shelf
--  history and the order's "stock lenses" panel show them. Deleting such an
--  order (delete_order) puts them back on the shelf. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.use_own_lens_stock(p_bill text, p_customer text, p_lines jsonb) returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  me    text := public.jwt_branch();
  ord   public.orders;
  req   public.lens_requests;
  l     record;
  have  int;
  pcs   int;
  kinds int;
begin
  if not exists (select 1 from public.branches where code = me and holds_lens_stock and active) then
    raise exception 'Your branch does not hold lens stock';
  end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Choose the lenses'; end if;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, null, trim(p_customer), 'lenses_in')
  returning * into ord;

  insert into public.lens_requests (branch_code, holder_code, status, note, customer, fulfilment, order_id)
  values (me, me, 'confirmed', trim(p_bill), trim(p_customer), 'receive_lens', ord.id)
  returning * into req;

  for l in select (x->>'itemId')::uuid as item, x->>'type' as t, x->>'index' as i,
                  coalesce(nullif(x->>'coating', ''), 'None') as c,
                  (x->>'sph')::numeric as sph, coalesce((x->>'cyl')::numeric, 0) as cyl, (x->>'qty')::int as qty
             from jsonb_array_elements(p_lines) x loop
    if l.qty is null or l.qty <= 0 then raise exception 'A lens line has no quantity'; end if;
    select qty into have from public.lens_stock where id = l.item and holder_code = me for update;
    if have is null then raise exception '% % % SPH % is no longer on your shelf', l.t, l.i, l.c, l.sph; end if;
    if have < l.qty then raise exception 'Only % left of % % % SPH %', have, l.t, l.i, l.c, l.sph; end if;
    update public.lens_stock set qty = qty - l.qty, updated_at = now() where id = l.item;
    insert into public.lens_request_lines (request_id, stock_id, lens_type, lens_index, coating, sph, cyl, qty)
    values (req.id, l.item, l.t, l.i, l.c, l.sph, l.cyl, l.qty);
  end loop;

  select count(*), coalesce(sum(qty), 0) into kinds, pcs from public.lens_request_lines where request_id = req.id;
  insert into public.lens_request_events (request_id, by_code, text)
  values (req.id, me, format('Taken off %s''s own shelf — %s lens type%s, %s pcs, bill %s', me, kinds, case when kinds = 1 then '' else 's' end, pcs, trim(p_bill)));
  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Order logged at %s with %s pcs from its own lens stock — lenses in hand', me, pcs));
  return req;
end $$;

revoke all on function public.use_own_lens_stock(text, text, jsonb) from public, anon;
grant execute on function public.use_own_lens_stock(text, text, jsonb) to authenticated;

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
    -- Lenses from the branch's own shelf never left it: they go back too (schema-42).
    if lr.status in ('sent', 'confirmed') and lr.holder_code <> lr.branch_code then raise exception 'Too late to delete — the stock lenses have been sent'; end if;
    -- Reserved or requested lenses go back on the shelf (declined ones already did).
    if lr.status in ('reserved', 'requested') or (lr.holder_code = lr.branch_code and lr.status <> 'declined') then
      update public.lens_stock s set qty = s.qty + l.qty, updated_at = now()
        from public.lens_request_lines l where l.request_id = lr.id and s.id = l.stock_id;
    end if;
    delete from public.lens_requests where id = lr.id;
  end loop;
  delete from public.orders where id = p_id;   -- events and the outside lens order go with it
end $$;

commit;
