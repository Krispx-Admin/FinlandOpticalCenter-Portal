-- ════════════════════════════════════════════════════════════════════════════
--  22 · Change how a lens request is fulfilled, after it was made
--  STATUS: applied 2026-10-12 (by Claude)
--
--  Al Mouj ordered from Salalah meaning to send the frames, but the form then
--  pre-selected "Receive the lenses" for fitting centres, so three jobs
--  (wdwd LR-1024, sg LR-1025, FEF LR-1026) were recorded the wrong way round.
--  change_lens_fulfilment(request, fulfilment) lets the branch that ordered
--  (or the office) switch between the two, as long as nothing has moved yet:
--    receive -> send the frame : the order is still pending (lenses not marked
--                                delivered). The lenses stay set aside at the
--                                holder (request 'reserved'); order fitter =
--                                holder, status lenses_in ("Send to fitter").
--    send the frame -> receive : the order is still lenses_in (frame not sent).
--                                Request 'requested' (the holder sends them);
--                                order pending, fitter = the branch if it is a
--                                fitting centre, else none yet.
--  The lenses were taken off the shelf when ordered, so the shelf is untouched.
--  Both timelines say what changed and who changed it. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.change_lens_fulfilment(p_request uuid, p_fulfilment text)
  returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  r    public.lens_requests;
  o    public.orders;
  me   text := public.jwt_branch();
  cuts boolean;
begin
  if p_fulfilment not in ('send_frames', 'receive_lens') then
    raise exception 'Unknown fulfilment %', p_fulfilment;
  end if;
  select * into r from public.lens_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not (r.branch_code = me or public.is_admin()) then
    raise exception 'Only the branch that ordered the lenses (or the office) can change this';
  end if;
  if r.fulfilment = p_fulfilment then return r; end if;
  if r.status = 'declined' then raise exception 'This request was declined'; end if;
  select * into o from public.orders where id = r.order_id for update;
  if not found then raise exception 'The fitting order for this request is gone'; end if;

  if p_fulfilment = 'send_frames' then
    if o.status <> 'pending' then
      raise exception 'Too late to change — the lenses have already been marked delivered';
    end if;
    update public.lens_requests set fulfilment = 'send_frames', status = 'reserved', updated_at = now()
     where id = r.id returning * into r;
    update public.orders set fitter_code = r.holder_code, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    if o.status <> 'lenses_in' or o.fitter_code is distinct from r.holder_code then
      raise exception 'Too late to change — the frame has already been sent';
    end if;
    cuts := exists (select 1 from public.branches where code = r.branch_code and role in ('fitting', 'admin'));
    update public.lens_requests set fulfilment = 'receive_lens', status = 'requested', updated_at = now()
     where id = r.id returning * into r;
    update public.orders set fitter_code = case when cuts then r.branch_code else null end,
                             status = 'pending', updated_at = now() where id = o.id;
  end if;

  insert into public.lens_request_events (request_id, by_code, text)
  values (r.id, coalesce(nullif(me, ''), r.branch_code),
          case when p_fulfilment = 'send_frames'
               then format('Changed: the frame goes to %s; the lenses stay set aside there', r.holder_code)
               else format('Changed: %s sends the lenses to %s', r.holder_code, r.branch_code) end);
  insert into public.order_events (order_id, by_code, text)
  values (o.id, coalesce(nullif(me, ''), r.branch_code),
          case when p_fulfilment = 'send_frames'
               then format('Changed: the frame goes to %s for cutting — the lenses wait there', r.holder_code)
               else format('Changed: %s sends the lenses here', r.holder_code) end);
  return r;
end $$;

revoke all on function public.change_lens_fulfilment(uuid, text) from public, anon;
grant execute on function public.change_lens_fulfilment(uuid, text) to authenticated;

-- The three Al Mouj jobs, put the way they were meant (done as Al Mouj).
do $$
declare id uuid;
begin
  perform set_config('request.jwt.claims', '{"app_metadata":{"branch_code":"MOUJ"}}', true);
  for id in select r.id from public.lens_requests r join public.orders o on o.id = r.order_id
             where r.ref in ('LR-1024', 'LR-1025', 'LR-1026') and r.fulfilment = 'receive_lens' and o.status = 'pending' loop
    perform public.change_lens_fulfilment(id, 'send_frames');
  end loop;
end $$;
