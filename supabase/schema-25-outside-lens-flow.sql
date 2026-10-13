-- ════════════════════════════════════════════════════════════════════════════
--  25 · Outside lens orders: the branch chooses frame-or-lenses, and nothing
--       is cut or sent before MGM has ordered the lenses
--  STATUS: applied 2026-10-13 (by Claude)
--
--  The user (2026-10-13): the order reads "Waiting for Lenses" with the
--  outside-lens state as a separate tag; the branch decides whether to SEND
--  THE FRAME to MGM or RECEIVE THE LENSES; on receive, MGM gets "Send
--  lenses"; and MGM can neither start cutting nor send the lenses before it
--  has marked them Ordered.
--
--  outside_lens_orders gains fulfilment ('send_frames' default | 'receive_lens')
--  and sent_at. The fitting order:
--    send the frame : fitter = MGM, status lenses_in — the frame may go any
--                     time; MGM may confirm its arrival any time; CUTTING
--                     (at_fitter -> ready, or on MGM's own orders lenses_in ->
--                     at_fitter -> delivered) waits for 'ordered'.
--    receive        : status pending; fitter = the branch if it is a fitting
--                     centre (it cuts), else none yet (it sends frame + lenses
--                     to a fitter later). send_outside_lenses() — MGM, only
--                     once ordered — then the branch marks them delivered,
--                     never before (also enforced below).
--  change_outside_fulfilment() switches while nothing has moved.
--  set_outside_lens_status() refuses to un-order once lenses were sent or
--  cutting began. A trigger on orders holds the gates whoever writes.
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.outside_lens_orders add column if not exists fulfilment text not null default 'send_frames';
alter table public.outside_lens_orders add column if not exists sent_at timestamptz;
alter table public.outside_lens_orders drop constraint if exists outside_lens_orders_fulfilment_check;
alter table public.outside_lens_orders add constraint outside_lens_orders_fulfilment_check
  check (fulfilment in ('send_frames', 'receive_lens'));

-- ── ordering: the branch's choice comes with it ──
drop function if exists public.create_outside_lens_order(text, text, jsonb, text);
create or replace function public.create_outside_lens_order(p_bill text, p_customer text, p_rx jsonb, p_lens_type text,
                                                            p_fulfilment text default 'send_frames')
  returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  me   text := public.jwt_branch();
  h    text := public.outside_lens_handler();
  how  text := case when public.jwt_branch() = public.outside_lens_handler() then 'send_frames'
                    else coalesce(nullif(p_fulfilment, ''), 'send_frames') end;
  cuts boolean;
  ord  public.orders;
begin
  if me = '' then raise exception 'Not signed in'; end if;
  if how not in ('send_frames', 'receive_lens') then raise exception 'Unknown fulfilment %', how; end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if coalesce(trim(p_lens_type), '') = '' then raise exception 'Type the lens type'; end if;
  if coalesce(trim(p_rx #>> '{r,sph}'), '') = '' and coalesce(trim(p_rx #>> '{l,sph}'), '') = '' then
    raise exception 'Enter the prescription (at least the SPH)';
  end if;
  cuts := exists (select 1 from public.branches where code = me and role in ('fitting', 'admin'));

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me,
          case when how = 'send_frames' then h when cuts then me else null end,
          trim(p_customer),
          case when how = 'send_frames' then 'lenses_in' else 'pending' end)
  returning * into ord;

  insert into public.outside_lens_orders (order_id, branch_code, rx, lens_type, fulfilment)
  values (ord.id, me, coalesce(p_rx, '{}'::jsonb), trim(p_lens_type), how);

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Order logged at %s with outside lenses (%s) — %s orders them; %s',
            me, trim(p_lens_type), h,
            case when me = h then 'cut here once ordered'
                 when how = 'send_frames' then format('the frame goes to %s, which cuts them once ordered', h)
                 else format('%s sends the lenses here once ordered', h) end));
  return ord;
end $$;

-- ── MGM sends lenses a branch is receiving — only once ordered ──
create or replace function public.send_outside_lenses(p_id uuid) returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
begin
  if not (me = public.outside_lens_handler() or public.is_admin()) then
    raise exception 'Only % (or the office) can send these lenses', public.outside_lens_handler();
  end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if x.fulfilment <> 'receive_lens' then raise exception 'These lenses stay at % — the frame comes to them', public.outside_lens_handler(); end if;
  if x.status <> 'ordered' then raise exception 'Mark the lenses ordered first'; end if;
  if x.sent_at is not null then raise exception 'These lenses were already sent'; end if;

  update public.outside_lens_orders set sent_at = now(), updated_at = now() where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, me, format('%s sent the outside lenses — on their way to %s', public.outside_lens_handler(), x.branch_code));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $$;

-- ── the branch changes its mind while nothing has moved ──
create or replace function public.change_outside_fulfilment(p_id uuid, p_fulfilment text) returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x    public.outside_lens_orders;
  o    public.orders;
  me   text := public.jwt_branch();
  h    text := public.outside_lens_handler();
  cuts boolean;
begin
  if p_fulfilment not in ('send_frames', 'receive_lens') then raise exception 'Unknown fulfilment %', p_fulfilment; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if not (x.branch_code = me or public.is_admin()) then
    raise exception 'Only the branch that ordered (or the office) can change this';
  end if;
  if x.branch_code = h then raise exception '%''s own orders are cut there', h; end if;
  if x.fulfilment = p_fulfilment then return x; end if;
  select * into o from public.orders where id = x.order_id for update;
  if p_fulfilment = 'send_frames' and (x.sent_at is not null or o.status <> 'pending') then
    raise exception 'Too late to change — the lenses have already been sent';
  end if;
  if p_fulfilment = 'receive_lens' and (o.status <> 'lenses_in' or o.fitter_code is distinct from h) then
    raise exception 'Too late to change — the frame has already been sent';
  end if;
  -- The outside row first: the gate on orders reads it.
  update public.outside_lens_orders set fulfilment = p_fulfilment, updated_at = now() where id = p_id returning * into x;

  if p_fulfilment = 'send_frames' then
    if x.sent_at is not null or o.status <> 'pending' then
      raise exception 'Too late to change — the lenses have already been sent';
    end if;
    update public.orders set fitter_code = h, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    if o.status <> 'lenses_in' or o.fitter_code is distinct from h then
      raise exception 'Too late to change — the frame has already been sent';
    end if;
    cuts := exists (select 1 from public.branches where code = x.branch_code and role in ('fitting', 'admin'));
    update public.orders set fitter_code = case when cuts then x.branch_code else null end,
                             status = 'pending', updated_at = now() where id = o.id;
  end if;
  insert into public.order_events (order_id, by_code, text)
  values (o.id, me, case when p_fulfilment = 'send_frames'
                         then format('Changed: the frame goes to %s for the outside lenses', h)
                         else format('Changed: %s sends the outside lenses here', h) end);
  return x;
end $$;

-- ── un-ordering is refused once things have moved ──
create or replace function public.set_outside_lens_status(p_ids uuid[], p_status text) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  me text := public.jwt_branch();
  n  int;
begin
  if not (me = public.outside_lens_handler() or public.is_admin()) then
    raise exception 'Only % (or the office) can mark outside lenses ordered', public.outside_lens_handler();
  end if;
  if p_status not in ('to_order', 'ordered') then raise exception 'Unknown status %', p_status; end if;
  if p_status = 'to_order' and exists (
       select 1 from public.outside_lens_orders x join public.orders o on o.id = x.order_id
        where x.id = any(p_ids) and (x.sent_at is not null or o.status in ('ready', 'returning', 'delivered')
                                     or (o.fitter_code = o.origin_code and o.status = 'at_fitter'))) then
    raise exception 'Too late to undo — the lenses were sent or cutting has started';
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

-- ── the gates, whoever writes the order ──
create or replace function public.outside_lens_gate() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  x public.outside_lens_orders;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into x from public.outside_lens_orders where order_id = new.id;
  if not found then return new; end if;
  -- Cutting waits for the lenses to be ordered.
  if x.status <> 'ordered' and (
       (old.status = 'at_fitter' and new.status in ('ready', 'delivered'))
    or (old.status = 'lenses_in' and new.status = 'at_fitter' and new.fitter_code = new.origin_code)) then
    raise exception 'Order the outside lenses first — cutting waits for them';
  end if;
  -- Lenses on their way here cannot be marked delivered before they are sent.
  if x.fulfilment = 'receive_lens' and x.sent_at is null and old.status = 'pending' and new.status <> 'pending' then
    raise exception 'The outside lenses have not been sent yet';
  end if;
  return new;
end $$;

drop trigger if exists orders_outside_lens_gate on public.orders;
create trigger orders_outside_lens_gate before update of status on public.orders
  for each row execute function public.outside_lens_gate();

revoke all on function public.create_outside_lens_order(text, text, jsonb, text, text) from public, anon;
revoke all on function public.send_outside_lenses(uuid)                                from public, anon;
revoke all on function public.change_outside_fulfilment(uuid, text)                    from public, anon;
grant execute on function public.create_outside_lens_order(text, text, jsonb, text, text) to authenticated;
grant execute on function public.send_outside_lenses(uuid)                                to authenticated;
grant execute on function public.change_outside_fulfilment(uuid, text)                    to authenticated;

commit;
