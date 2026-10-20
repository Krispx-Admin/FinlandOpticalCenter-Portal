-- ════════════════════════════════════════════════════════════════════════════
--  54 · Any account may hold lens stock
--  STATUS: applied 2026-10-20 (by Claude)
--
--  The user (2026-10-20): holding lens stock should not need the account to be
--  a fitting centre — "all options should be available". set_lens_holder: any
--  open account; save_branch: a holder may change kind, only not close.
--  A frame can be sent for cutting only to a shelf at a fitting centre:
--  create_lens_request and change_lens_fulfilment say so, and a shelf kept
--  anywhere else sends the lenses to the branch. (Also mends dashes stored
--  garbled in these four.) Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

CREATE OR REPLACE FUNCTION public.set_lens_holder(p_code text, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.branches;
  n int;
begin
  if not public.has_perm('accounts') then
    raise exception 'Only the office may change who holds lens stock';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;

  if p_on then
    -- Any open account may keep a shelf (user 2026-10-20); only a fitting
    -- centre's can take frames to cut (create_lens_request).
    if not b.active then
      raise exception '% is closed — open it first', b.name;
    end if;
  else
    select coalesce(sum(qty), 0) into n from public.lens_stock where holder_code = p_code;
    if n > 0 then
      raise exception '% still has % lenses on its shelf — clear them first', b.name, n;
    end if;
    select count(*) into n from public.lens_requests where holder_code = p_code and status = 'requested';
    if n > 0 then
      raise exception '% still has % lens request% to answer', b.name, n, case when n = 1 then '' else 's' end;
    end if;
    if (select count(*) from public.branches where holds_lens_stock and code <> p_code) = 0 then
      raise exception '% is the only branch holding lens stock', b.name;
    end if;
  end if;

  update public.branches set holds_lens_stock = p_on where code = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.save_branch(p_code text, p_name text, p_role text, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  b  public.branches;
  nm text := trim(coalesce(p_name, ''));
begin
  if not public.has_perm('accounts') then
    raise exception 'Only the office may change branches';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then
    raise exception 'No branch %', p_code;
  end if;
  if nm = '' then
    raise exception 'Give it a name';
  end if;
  -- Every account is a branch (retail / fitting / clinic) or a person (view-
  -- only admin, schedule editor, office admin), and can be switched - as long
  -- as one open office admin is left (schema-41).
  if p_role in ('manager', 'scheduler', 'admin') then p_role := 'person'; end if;
  if p_role not in ('retail', 'fitting', 'clinic', 'person') then
    raise exception 'Unknown kind of account %', p_role;
  end if;
  -- Never close the last account that can manage the accounts (schema-50).
  if not p_active and public.manages_accounts(b) and not exists (
       select 1 from public.branches o where o.code <> p_code and o.active and public.manages_accounts(o)) then
    raise exception '% is the last account that can manage accounts - give that to another first', b.name;
  end if;
  if b.holds_lens_stock and not p_active then
    raise exception '% holds lens stock, so it has to stay open', b.name;
  end if;

  update public.branches set name = nm, role = p_role, active = p_active,
         -- only a fitting centre has a lab
         bench_closed = case when p_role = 'fitting' then bench_closed else false end,
         bench_closed_until = case when p_role = 'fitting' then bench_closed_until else null end,
         bench_own_only = case when p_role = 'fitting' then bench_own_only else false end
   where code = p_code;

  update auth.users
     set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('branch_role', p_role),
         banned_until = case when p_active then null else now() + interval '100 years' end,
         updated_at = now()
   where (raw_app_meta_data ->> 'branch_code') = p_code;
end $function$;

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
  -- Only a fitting centre cuts: a shelf kept anywhere else sends the lenses (schema-54).
  if p_fulfilment = 'send_frames' and not exists (select 1 from public.branches where code = owner and role = 'fitting') then
    raise exception '% is not a fitting centre — choose to receive the lenses', (select name from public.branches where code = owner);
  end if;
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
    if not exists (select 1 from public.branches where code = r.holder_code and role = 'fitting') then
      raise exception '% is not a fitting centre — the lenses come to you', (select name from public.branches where code = r.holder_code);
    end if;
    if o.status <> 'pending' then
      raise exception 'Too late to change — the lenses have already been marked delivered';
    end if;
    update public.lens_requests set fulfilment = 'send_frames', status = 'reserved', updated_at = now()
     where id = r.id returning * into r;
    if public.bench_closed(r.holder_code) then
      raise exception '% is closed — fitter on leave', (select name from public.branches where code = r.holder_code);
    end if;
    update public.orders set fitter_code = r.holder_code, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    if o.status <> 'lenses_in' or o.fitter_code is distinct from r.holder_code then
      raise exception 'Too late to change — the frame has already been sent';
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
               then format('Changed: the frame goes to %s for cutting — the lenses wait there', r.holder_code)
               else format('Changed: %s sends the lenses here', r.holder_code) end);
  return r;
end $function$;

commit;
