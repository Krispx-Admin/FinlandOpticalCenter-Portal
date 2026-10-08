-- ════════════════════════════════════════════════════════════════════════════
--  08 · A lens request takes the lenses off the shelf the moment it is placed
--  STATUS: NOT YET APPLIED — run it in the Supabase SQL editor
--
--  Muscat Grand Mall used to confirm each request by hand, and only then did
--  the shelf come down. That confirm added nothing: the branch can only put
--  in its basket what the shelf already shows, so the holder was pressing a
--  button to agree with a number it had published itself — and until it did,
--  a second branch could be shown the same lenses.
--
--  create_lens_request now locks each shelf row it draws on, refuses the whole
--  request if any line is short (someone took them a moment earlier), deducts
--  the quantities, and records the request as confirmed — request, lines,
--  deduction and fitting order in one transaction. The spec on each line is
--  copied from the shelf row, not from what the browser sent.
--
--  confirm_lens_request stays, so a request placed before this ran can still
--  be confirmed or declined by hand. The app works either side of this file:
--  until it runs, requests still arrive as "Awaiting MGM".
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.create_lens_request(
  p_bill       text,
  p_customer   text,
  p_fulfilment text,
  p_lines      jsonb
) returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  me     text := public.jwt_branch();
  owner  text := public.lens_owner_code();
  fitter text;
  ord    public.orders;
  req    public.lens_requests;
  l      record;
  s      public.lens_stock;
  pcs    int;
  kinds  int;
begin
  if me = '' then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if p_fulfilment not in ('send_frames', 'receive_lens') then
    raise exception 'Unknown fulfilment %', p_fulfilment;
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Pick at least one lens';
  end if;

  -- Only somewhere with a bench can keep the job.
  if p_fulfilment = 'receive_lens'
     and not exists (select 1 from public.branches
                      where code = me and role in ('fitting', 'admin')) then
    raise exception 'Only a fitting centre can cut its own lenses';
  end if;

  -- Cutting it yourself means you are the fitter; otherwise the frame goes to
  -- whoever holds the lenses.
  fitter := case when p_fulfilment = 'receive_lens' then me else owner end;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, fitter, trim(p_customer), 'pending')
  returning * into ord;

  insert into public.lens_requests (branch_code, status, note, customer, fulfilment, order_id)
  values (me, 'confirmed', trim(p_bill), trim(p_customer), p_fulfilment, ord.id)
  returning * into req;

  -- One basket line per shelf row; the same row twice is one line of the sum.
  for l in
    select nullif(x->>'itemId', '')::uuid as stock_id, sum((x->>'qty')::int) as qty
      from jsonb_array_elements(p_lines) x
     group by 1
     order by 1                              -- a fixed order, so two requests
  loop                                       -- locking rows cannot deadlock
    if l.stock_id is null or coalesce(l.qty, 0) <= 0 then
      raise exception 'Each lens in the basket needs a quantity';
    end if;

    select * into s from public.lens_stock where id = l.stock_id for update;
    if not found then
      raise exception 'A lens in the basket is no longer on the shelf — refresh and try again';
    end if;
    if s.qty < l.qty then
      raise exception 'Only % left of % % % SPH % — refresh and try again',
        s.qty, s.lens_type, s.lens_index, s.coating, s.sph;
    end if;

    update public.lens_stock set qty = qty - l.qty, updated_at = now() where id = s.id;

    insert into public.lens_request_lines
           (request_id, stock_id, lens_type, lens_index, coating, sph, cyl, qty)
    values (req.id, s.id, s.lens_type, s.lens_index, s.coating, s.sph, s.cyl, l.qty);
  end loop;

  select count(*), coalesce(sum(qty), 0) into kinds, pcs
    from public.lens_request_lines where request_id = req.id;

  -- One event, so the holder gets one notice rather than a request and a
  -- deduction a moment apart.
  insert into public.lens_request_events (request_id, by_code, text)
  values (req.id, me, format('Requested %s lens type%s, %s pcs — taken off %s''s shelf · bill %s, %s',
            kinds, case when kinds = 1 then '' else 's' end, pcs, owner, trim(p_bill),
            case when p_fulfilment = 'receive_lens'
                 then 'lenses to come here' else 'frame to go over' end));

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Opened from lens request %s — %s',
            req.ref,
            case when p_fulfilment = 'receive_lens'
                 then format('fitting here once %s sends the lenses', owner)
                 else format('frame goes to %s for cutting', owner) end));

  return req;
end $$;

revoke all on function public.create_lens_request(text, text, text, jsonb) from public;
grant execute on function public.create_lens_request(text, text, text, jsonb) to authenticated;
