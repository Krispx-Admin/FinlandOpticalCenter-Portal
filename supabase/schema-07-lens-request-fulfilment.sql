-- ════════════════════════════════════════════════════════════════════════════
--  07 · A lens request says how the job will be done, and opens the fitting log
--  STATUS: applied
--
--  Asking the lens centre for lenses is really asking for one of two things:
--
--    send_frames   the frame travels to the lens centre and is cut there
--    receive_lens  the lenses travel to the asking branch, which cuts them
--
--  Only a fitting centre can mean the second, and that is checked here rather
--  than in the browser. Either way the customer has bought glasses, so the job
--  belongs in the fitting log — and the branch is already typing the bill
--  number and the customer name to make the lens request. Creating the order
--  by hand afterwards is the same facts entered twice, and the second time is
--  the one that gets forgotten.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.lens_requests
  add column if not exists customer   text not null default '',
  add column if not exists fulfilment text not null default 'send_frames',
  add column if not exists order_id   uuid references public.orders(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.lens_requests'::regclass
                    and conname = 'lens_requests_fulfilment_check') then
    alter table public.lens_requests add constraint lens_requests_fulfilment_check
      check (fulfilment in ('send_frames', 'receive_lens'));
  end if;
end $$;

-- Which branch physically holds the loose lenses.
create or replace function public.lens_owner_code() returns text
  language sql stable security definer set search_path = public
  as $$ select code from public.branches where holds_lens_stock limit 1 $$;

-- ────────────────────────────────────────────────────────────────────────────
--  The request, its lines and the fitting order it opens, in one transaction.
--
--  The bill number is unique per branch, so the order is the insert that can
--  fail. Doing this in the browser as three calls would leave a lens request
--  with no job behind it the moment someone retyped a bill number that was
--  already used. Here the whole thing either happens or none of it does.
-- ────────────────────────────────────────────────────────────────────────────
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
  pcs    int;
  kinds  int;
begin
  if me = '' then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if p_fulfilment not in ('send_frames', 'receive_lens') then
    raise exception 'Unknown fulfilment %', p_fulfilment;
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
  values (me, 'requested', trim(p_bill), trim(p_customer), p_fulfilment, ord.id)
  returning * into req;

  insert into public.lens_request_lines
         (request_id, stock_id, lens_type, lens_index, coating, sph, cyl, qty)
  select req.id, nullif(l->>'itemId', '')::uuid, l->>'type', l->>'index',
         coalesce(nullif(l->>'coating', ''), 'None'),
         (l->>'sph')::numeric, coalesce((l->>'cyl')::numeric, 0), (l->>'qty')::int
    from jsonb_array_elements(p_lines) l;

  select count(*), coalesce(sum(qty), 0) into kinds, pcs
    from public.lens_request_lines where request_id = req.id;

  insert into public.lens_request_events (request_id, by_code, text)
  values (req.id, me, format('Requested %s lens type%s, %s pcs from %s — bill %s, %s',
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
