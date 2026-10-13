-- ════════════════════════════════════════════════════════════════════════════
--  29 · Stock lenses received by a branch: cut here OR send to a fitter
--  STATUS: applied 2026-10-13 (by Claude)
--
--  Same rule as outside lenses (schema-28), at the user's request: a branch
--  that RECEIVES stock lenses gets an order with no fitter yet. When the lenses
--  arrive (Lenses delivered) it uses Send to fitter — "Keep here" if it has an
--  open bench, or any open fitting centre / outside cutter — because its own
--  fitter may be on leave. A holder whose bench is closed cannot be sent the
--  frame. Open receive orders still fixed to in-house are freed. These are the
--  live definitions with only those changes.
-- ════════════════════════════════════════════════════════════════════════════

begin;

CREATE OR REPLACE FUNCTION public.create_lens_request(p_bill text, p_customer text, p_fulfilment text, p_lines jsonb, p_holder text DEFAULT NULL::text)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Receiving: no fitter yet — once the lenses arrive the branch keeps it
  -- (if it has an open bench) or sends frame + lenses to a fitter (schema-29).
  fitter := case when p_fulfilment = 'send_frames' then owner else null end;
  if p_fulfilment = 'send_frames' and public.bench_closed(owner) then
    raise exception '% is closed — fitter on leave. Choose to receive the lenses', (select name from public.branches where code = owner);
  end if;

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
      raise exception 'Only % left of % % % SPH % â€” ask for % or fewer', have, l.t, l.i, l.c, l.sph, have;
    end if;
    update public.lens_stock set qty = qty - l.qty, updated_at = now() where id = l.item;
    insert into public.lens_request_lines (request_id, stock_id, lens_type, lens_index, coating, sph, cyl, qty)
    values (req.id, l.item, l.t, l.i, l.c, l.sph, l.cyl, l.qty);
  end loop;

  select count(*), coalesce(sum(qty), 0) into kinds, pcs
    from public.lens_request_lines where request_id = req.id;

  insert into public.lens_request_events (request_id, by_code, text)
  values (req.id, me, format('Requested %s lens type%s, %s pcs from %s â€” bill %s, %s; taken off %s''s shelf',
            kinds, case when kinds = 1 then '' else 's' end, pcs, owner, trim(p_bill),
            case when p_fulfilment = 'receive_lens' then 'lenses to come here' else 'frame to go over' end,
            owner));

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Opened from lens request %s â€” %s',
            req.ref,
            case when p_fulfilment = 'send_frames'
                   then format('lenses set aside at %s; the frame goes there for cutting', owner)
                 else format('%s sends the lenses here; then cut here or send to a fitter', owner) end));

  return req;
end $function$;

CREATE OR REPLACE FUNCTION public.change_lens_fulfilment(p_request uuid, p_fulfilment text)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      raise exception 'Too late to change â€” the lenses have already been marked delivered';
    end if;
    update public.lens_requests set fulfilment = 'send_frames', status = 'reserved', updated_at = now()
     where id = r.id returning * into r;
    if public.bench_closed(r.holder_code) then
      raise exception '% is closed — fitter on leave', (select name from public.branches where code = r.holder_code);
    end if;
    update public.orders set fitter_code = r.holder_code, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    if o.status <> 'lenses_in' or o.fitter_code is distinct from r.holder_code then
      raise exception 'Too late to change â€” the frame has already been sent';
    end if;
    cuts := exists (select 1 from public.branches where code = r.branch_code and role in ('fitting', 'admin'));
    update public.lens_requests set fulfilment = 'receive_lens', status = 'requested', updated_at = now()
     where id = r.id returning * into r;
    update public.orders set fitter_code = null,
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
               then format('Changed: the frame goes to %s for cutting â€” the lenses wait there', r.holder_code)
               else format('Changed: %s sends the lenses here', r.holder_code) end);
  return r;
end $function$;

update public.orders o set fitter_code = null
  from public.lens_requests r
 where r.order_id = o.id and r.fulfilment = 'receive_lens' and o.status = 'pending' and o.fitter_code is not null;

commit;
