-- ════════════════════════════════════════════════════════════════════════════
--  27 · Outside lenses, "send the frame": the branch picks the fitter
--  STATUS: applied 2026-10-13 (by Claude)
--
--  The user (2026-10-13): no tag under the status, it reads "Waiting for
--  Lenses", and Send to fitter lets the branch choose the fitter — so a
--  send-the-frame order no longer comes with MGM preset as its fitter. It is
--  created at lenses_in with no fitter; the branch picks one (MGM, where the
--  outside lenses arrive, normally; or keeps it in-house if it is a fitting
--  centre) whenever the frame is ready.
--  The cutting gate now only stops FINISHING the cut (at_fitter -> ready /
--  delivered) before the lenses are ordered — keeping a frame in-house
--  (lenses_in -> at_fitter) is allowed. change_outside_fulfilment follows the
--  new shape. Open send-the-frame orders still waiting at lenses_in with MGM
--  preset are cleared so the branch picks. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

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

  -- Send the frame: no fitter yet — the branch picks one when it sends.
  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me,
          case when how = 'send_frames' then null when cuts then me else null end,
          trim(p_customer),
          case when how = 'send_frames' then 'lenses_in' else 'pending' end)
  returning * into ord;

  insert into public.outside_lens_orders (order_id, branch_code, rx, lens_type, fulfilment)
  values (ord.id, me, coalesce(p_rx, '{}'::jsonb), trim(p_lens_type), how);

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Order logged at %s with outside lenses (%s) — %s orders them; %s',
            me, trim(p_lens_type), h,
            case when how = 'send_frames' then 'the frame goes to the fitter chosen when it is sent'
                 else format('%s sends the lenses here once ordered', h) end));
  return ord;
end $$;

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
  if p_fulfilment = 'receive_lens' and (o.status <> 'lenses_in' or o.fitter_code is not null) then
    raise exception 'Too late to change — the frame has already been sent';
  end if;
  update public.outside_lens_orders set fulfilment = p_fulfilment, updated_at = now() where id = p_id returning * into x;

  if p_fulfilment = 'send_frames' then
    update public.orders set fitter_code = null, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    cuts := exists (select 1 from public.branches where code = x.branch_code and role in ('fitting', 'admin'));
    update public.orders set fitter_code = case when cuts then x.branch_code else null end,
                             status = 'pending', updated_at = now() where id = o.id;
  end if;
  insert into public.order_events (order_id, by_code, text)
  values (o.id, me, case when p_fulfilment = 'send_frames'
                         then 'Changed: the frame goes to a fitter for the outside lenses'
                         else format('Changed: %s sends the outside lenses here', h) end);
  return x;
end $$;

create or replace function public.outside_lens_gate() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  x public.outside_lens_orders;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into x from public.outside_lens_orders where order_id = new.id;
  if not found then return new; end if;
  -- Finishing the cut waits for the lenses to be ordered.
  if x.status <> 'ordered' and old.status = 'at_fitter' and new.status in ('ready', 'delivered') then
    raise exception 'Order the outside lenses first — cutting waits for them';
  end if;
  -- Lenses on their way here cannot be marked delivered before they are sent.
  if x.fulfilment = 'receive_lens' and x.sent_at is null and old.status = 'pending' and new.status <> 'pending' then
    raise exception 'The outside lenses have not been sent yet';
  end if;
  return new;
end $$;

-- Open send-the-frame jobs still waiting with MGM preset: the branch picks now.
update public.orders o set fitter_code = null
  from public.outside_lens_orders x
 where x.order_id = o.id and x.fulfilment = 'send_frames' and o.status = 'lenses_in'
   and o.fitter_code = public.outside_lens_handler();

commit;
