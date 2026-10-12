-- ════════════════════════════════════════════════════════════════════════════
--  21 · Lens requests: no confirming — lenses are reserved, then SENT
--  STATUS: NOT YET APPLIED — written 2026-10-12, waiting for a fresh token
--
--  The user (2026-10-12): drop "confirm"; the holder presses "Send lenses",
--  and every movement of lenses and frames is tracked in the Fitting Log.
--  Decisions they made:
--    · lenses come off the shelf WHEN ORDERED (reserved), so two branches can
--      never take the same last lens; not enough on the shelf = refused;
--    · any branch may choose "send the frame" (default) or "receive the
--      lenses"; a fitting centre that receives them cuts them itself, a shop or
--      clinic that receives them then sends frame + lenses to a fitter;
--    · the holder may decline a "receive" request until it sends the lenses —
--      they go back on the shelf.
--
--  Request statuses: reserved  (send the frame: lenses set aside at the holder)
--                    requested (receive: waiting for the holder to send them)
--                    sent      (receive: on their way)
--                    declined
--                    confirmed (older requests only, from the confirm days)
--  The order a request opens:
--    send the frame → fitter = holder, status lenses_in: "Lenses at <holder>",
--                     the branch presses Send to fitter when the driver comes;
--    receive        → status pending, fitter = the branch if it is a fitting
--                     centre, else none yet; "Lenses Requested" until the
--                     holder sends, then "Waiting for Lenses" → Lenses
--                     delivered → (cut here) or Send to fitter.
--  The holder can now READ the orders its requests opened, so its Fitting Log
--  shows them (and their timeline) and carries the Send lenses button.
--  Open requests are moved onto this flow (their lenses reserved now).
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.lens_requests drop constraint if exists lens_requests_status_check;
alter table public.lens_requests add constraint lens_requests_status_check
  check (status in ('requested', 'reserved', 'sent', 'confirmed', 'declined'));

-- ── the holder sees the jobs its lenses are for ──
drop policy if exists orders_lens_holder_read on public.orders;
create policy orders_lens_holder_read on public.orders for select to authenticated
  using (exists (select 1 from public.lens_requests r
                  where r.order_id = orders.id and r.holder_code = public.jwt_branch()));

drop policy if exists order_events_lens_holder_read on public.order_events;
create policy order_events_lens_holder_read on public.order_events for select to authenticated
  using (exists (select 1 from public.lens_requests r
                  where r.order_id = order_events.order_id and r.holder_code = public.jwt_branch()));

-- ── ordering: reserve the lenses and open the job ──
create or replace function public.create_lens_request(p_bill text, p_customer text, p_fulfilment text,
                                                      p_lines jsonb, p_holder text default null)
  returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  me     text := public.jwt_branch();
  owner  text := coalesce(nullif(p_holder, ''), public.lens_owner_code());
  cuts   boolean;
  fitter text;
  ord    public.orders;
  req    public.lens_requests;
  l      record;
  have   int;
  pcs    int;
  kinds  int;
begin
  if me = '' then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if p_fulfilment not in ('send_frames', 'receive_lens') then
    raise exception 'Unknown fulfilment %', p_fulfilment;
  end if;
  if not exists (select 1 from public.branches where code = owner and holds_lens_stock and active) then
    raise exception '% does not hold lens stock', owner;
  end if;
  if owner = me then raise exception 'That is your own shelf'; end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'No lenses in the request'; end if;

  -- Receiving: a fitting centre cuts them itself; anyone else sends the frame
  -- and the lenses on to a fitter afterwards (chosen then).
  cuts := exists (select 1 from public.branches where code = me and role in ('fitting', 'admin'));
  fitter := case when p_fulfilment = 'send_frames' then owner when cuts then me else null end;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, fitter, trim(p_customer),
          case when p_fulfilment = 'send_frames' then 'lenses_in' else 'pending' end)
  returning * into ord;

  insert into public.lens_requests (branch_code, holder_code, status, note, customer, fulfilment, order_id)
  values (me, owner, case when p_fulfilment = 'send_frames' then 'reserved' else 'requested' end,
          trim(p_bill), trim(p_customer), p_fulfilment, ord.id)
  returning * into req;

  -- Take each line off that holder's shelf now. Rows are locked, so two
  -- branches ordering the last lens at the same instant cannot both get it.
  for l in select (x->>'itemId')::uuid as item, x->>'type' as t, x->>'index' as i,
                  coalesce(nullif(x->>'coating', ''), 'None') as c,
                  (x->>'sph')::numeric as sph, coalesce((x->>'cyl')::numeric, 0) as cyl, (x->>'qty')::int as qty
             from jsonb_array_elements(p_lines) x loop
    if l.qty is null or l.qty <= 0 then raise exception 'A lens line has no quantity'; end if;
    select qty into have from public.lens_stock where id = l.item and holder_code = owner for update;
    if have is null then
      raise exception '% % % SPH % is no longer on %''s shelf', l.t, l.i, l.c, l.sph, owner;
    end if;
    if have < l.qty then
      raise exception 'Only % left of % % % SPH % — ask for % or fewer', have, l.t, l.i, l.c, l.sph, have;
    end if;
    update public.lens_stock set qty = qty - l.qty, updated_at = now() where id = l.item;
    insert into public.lens_request_lines (request_id, stock_id, lens_type, lens_index, coating, sph, cyl, qty)
    values (req.id, l.item, l.t, l.i, l.c, l.sph, l.cyl, l.qty);
  end loop;

  select count(*), coalesce(sum(qty), 0) into kinds, pcs
    from public.lens_request_lines where request_id = req.id;

  insert into public.lens_request_events (request_id, by_code, text)
  values (req.id, me, format('Requested %s lens type%s, %s pcs from %s — bill %s, %s; taken off %s''s shelf',
            kinds, case when kinds = 1 then '' else 's' end, pcs, owner, trim(p_bill),
            case when p_fulfilment = 'receive_lens' then 'lenses to come here' else 'frame to go over' end,
            owner));

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Opened from lens request %s — %s',
            req.ref,
            case when p_fulfilment = 'send_frames'
                   then format('lenses set aside at %s; the frame goes there for cutting', owner)
                 when cuts
                   then format('fitting here once %s sends the lenses', owner)
                 else format('%s sends the lenses here, then the frame and lenses go to a fitter', owner) end));

  return req;
end $$;

-- ── the holder sends the lenses ──
create or replace function public.send_lens_request(p_request uuid) returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  r public.lens_requests;
begin
  select * into r from public.lens_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not ((r.holder_code = public.jwt_branch() and public.is_lens_owner()) or public.is_admin()) then
    raise exception 'only the lens-holding branch may send these lenses';
  end if;
  if r.status <> 'requested' then raise exception 'request is already %', r.status; end if;

  update public.lens_requests set status = 'sent', updated_at = now() where id = p_request returning * into r;
  insert into public.lens_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(), format('Lenses sent to %s', r.branch_code));
  if r.order_id is not null then
    insert into public.order_events (order_id, by_code, text)
    values (r.order_id, public.jwt_branch(), format('%s sent the lenses — on their way to %s', r.holder_code, r.branch_code));
    update public.orders set updated_at = now() where id = r.order_id;
  end if;
  return r;
end $$;

-- ── the holder declines before sending: the lenses go back on the shelf ──
create or replace function public.decline_lens_request(p_request uuid, p_reason text default '') returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  r   public.lens_requests;
  why text := trim(coalesce(p_reason, ''));
begin
  select * into r from public.lens_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not ((r.holder_code = public.jwt_branch() and public.is_lens_owner()) or public.is_admin()) then
    raise exception 'only the lens-holding branch may decline this request';
  end if;
  if r.status <> 'requested' then
    raise exception 'request is already % — it can only be declined before the lenses are sent', r.status;
  end if;

  update public.lens_stock s set qty = s.qty + l.qty, updated_at = now()
    from public.lens_request_lines l
   where l.request_id = p_request and s.id = l.stock_id;

  update public.lens_requests set status = 'declined', reason = why, updated_at = now()
   where id = p_request returning * into r;
  insert into public.lens_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(), 'Declined' || case when why <> '' then ' — ' || why else '' end || '; lenses back on the shelf');
  if r.order_id is not null then
    insert into public.order_events (order_id, by_code, text)
    values (r.order_id, public.jwt_branch(),
            format('%s declined the lenses%s', r.holder_code, case when why <> '' then ' — ' || why else '' end));
    update public.orders set updated_at = now() where id = r.order_id;
  end if;
  return r;
end $$;

-- Confirming is gone. A page still open from before cannot take stock twice.
create or replace function public.confirm_lens_request(p_request uuid) returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Lens requests are no longer confirmed — reload the page';
end $$;

revoke all on function public.send_lens_request(uuid)          from public, anon;
revoke all on function public.decline_lens_request(uuid, text) from public, anon;
grant execute on function public.send_lens_request(uuid)          to authenticated;
grant execute on function public.decline_lens_request(uuid, text) to authenticated;

-- ── requests already open move onto the new flow ──
do $$
declare
  r record; l record; give int;
begin
  for r in select * from public.lens_requests where status = 'requested' loop
    -- Their lenses were never taken off the shelf: reserve what there is now.
    for l in select * from public.lens_request_lines where request_id = r.id loop
      select least(qty, l.qty) into give from public.lens_stock where id = l.stock_id for update;
      if coalesce(give, 0) > 0 then
        update public.lens_stock set qty = qty - give, updated_at = now() where id = l.stock_id;
      end if;
      if coalesce(give, 0) < l.qty then
        insert into public.lens_request_events (request_id, by_code, text)
        values (r.id, r.holder_code, format('Short on %s %s %s SPH %s — %s of %s set aside',
                l.lens_type, l.lens_index, l.coating, l.sph, coalesce(give, 0), l.qty));
      end if;
    end loop;
    if r.fulfilment = 'send_frames' then
      update public.lens_requests set status = 'reserved', updated_at = now() where id = r.id;
      update public.orders set status = 'lenses_in' where id = r.order_id and status = 'pending';
    end if;
    insert into public.lens_request_events (request_id, by_code, text)
    values (r.id, r.holder_code, 'Lenses set aside on the shelf (confirming is no longer needed)');
  end loop;

  -- Confirmed "frame goes over" jobs whose frame has not left: the lenses are
  -- at the holder, so the next step is sending the frame.
  update public.orders o set status = 'lenses_in'
    from public.lens_requests r
   where r.order_id = o.id and r.fulfilment = 'send_frames' and r.status = 'confirmed' and o.status = 'pending';
end $$;

commit;
