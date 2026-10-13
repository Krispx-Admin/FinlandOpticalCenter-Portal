-- ════════════════════════════════════════════════════════════════════════════
--  30 · Outside lenses: Avenues orders them; the frame and the lenses travel
--       separately to the fitter the branch chose
--  STATUS: applied 2026-10-13 (by Claude)
--
--  The user (2026-10-13): ordering outside lenses is AVENUES MALL's job (no
--  longer MGM). It is a setting now — app_settings.outside_lens_handler,
--  default 'AV' — read by outside_lens_handler().
--  A branch ordering outside lenses chooses:
--    · SEND THE FRAME to a fitter it picks (dest = an open fitting centre):
--      the frame goes from the branch (any time) and the lenses go from the
--      handler (once ordered) — two legs to one fitter. The fitter marks the
--      lenses received; it cannot finish the cut until they are; then the
--      glasses go back to the branch as normal.
--    · RECEIVE THE LENSES (dest = the branch): the handler sends them to the
--      branch; the branch marks them delivered and carries on as normal.
--    · The handler's own orders: the lenses arrive there; it marks them
--      delivered once ordered.
--  outside_lens_orders gains dest_code and received_at. The handler sends to
--  the dest (send_outside_lenses); the dest receives (receive_outside_lenses,
--  or for the branch itself, Lenses delivered). change_outside_fulfilment can
--  switch the way or the fitter while nothing has moved. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.app_settings add column if not exists outside_lens_handler text not null default 'AV';

create or replace function public.outside_lens_handler() returns text
  language sql stable security definer set search_path = public as
$$ select coalesce((select nullif(outside_lens_handler, '') from public.app_settings where id = 1), 'AV') $$;

alter table public.outside_lens_orders add column if not exists dest_code text references public.branches(code);
alter table public.outside_lens_orders add column if not exists received_at timestamptz;
update public.outside_lens_orders x
   set dest_code = coalesce(case when x.fulfilment = 'send_frames' then o.fitter_code end, o.origin_code),
       received_at = coalesce(x.received_at, case when o.status in ('ready', 'returning', 'delivered') then now() end)
  from public.orders o where o.id = x.order_id and x.dest_code is null;

-- The destination fitter reads its incoming lenses.
drop policy if exists outside_lens_orders_read on public.outside_lens_orders;
create policy outside_lens_orders_read on public.outside_lens_orders for select to authenticated
  using (branch_code = public.jwt_branch() or dest_code = public.jwt_branch()
         or public.jwt_branch() = public.outside_lens_handler() or public.is_admin() or public.is_scheduler());

-- A fitter a branch may choose: an open fitting centre.
create or replace function public.open_fitter(p_code text) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.branches where code = p_code and role = 'fitting' and active) and not public.bench_closed(p_code) $$;

-- ── ordering ──
drop function if exists public.create_outside_lens_order(text, text, jsonb, text, text);
create or replace function public.create_outside_lens_order(p_bill text, p_customer text, p_rx jsonb, p_lens_type text,
                                                            p_fulfilment text default 'send_frames', p_dest text default null)
  returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  me   text := public.jwt_branch();
  h    text := public.outside_lens_handler();
  how  text := coalesce(nullif(p_fulfilment, ''), 'send_frames');
  dest text;
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
  -- The handler's own orders, and a fitter picking itself, are "receive".
  if me = h or nullif(p_dest, '') = me then how := 'receive_lens'; end if;
  if how = 'send_frames' then
    dest := nullif(p_dest, '');
    if dest is null then raise exception 'Choose the fitter the frame and lenses go to'; end if;
    if not public.open_fitter(dest) then
      raise exception '% cannot take it — not an open fitting centre', coalesce((select name from public.branches where code = dest), dest);
    end if;
  else
    dest := me;
  end if;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, case when how = 'send_frames' then dest else null end, trim(p_customer),
          case when how = 'send_frames' then 'lenses_in' else 'pending' end)
  returning * into ord;

  insert into public.outside_lens_orders (order_id, branch_code, rx, lens_type, fulfilment, dest_code)
  values (ord.id, me, coalesce(p_rx, '{}'::jsonb), trim(p_lens_type), how, dest);

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Order logged at %s with outside lenses (%s) — %s orders them; %s',
            me, trim(p_lens_type), h,
            case when me = h then 'they arrive here'
                 when how = 'send_frames' then format('the frame and the lenses go to %s, which cuts it', dest)
                 else format('%s sends the lenses here', h) end));
  return ord;
end $$;

-- ── the handler sends the lenses to wherever they go ──
create or replace function public.send_outside_lenses(p_id uuid) returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
  h  text := public.outside_lens_handler();
begin
  if not (me = h or public.is_admin()) then raise exception 'Only % (or the office) can send these lenses', h; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if x.dest_code = h then raise exception 'These lenses stay at %', h; end if;
  if x.status <> 'ordered' then raise exception 'Mark the lenses ordered first'; end if;
  if x.sent_at is not null then raise exception 'These lenses were already sent'; end if;
  if x.dest_code <> x.branch_code and public.bench_closed(x.dest_code) then
    raise exception '% is closed — fitter on leave. The branch has to choose another fitter', (select name from public.branches where code = x.dest_code);
  end if;
  update public.outside_lens_orders set sent_at = now(), updated_at = now() where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, me, format('%s sent the outside lenses to %s', h, x.dest_code));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $$;

-- ── the fitter marks the lenses received ──
create or replace function public.receive_outside_lenses(p_id uuid) returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
begin
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if not (me = x.dest_code or public.is_admin()) then raise exception 'Only % can mark these lenses received', x.dest_code; end if;
  if x.sent_at is null then raise exception 'The lenses have not been sent yet'; end if;
  if x.received_at is not null then return x; end if;
  update public.outside_lens_orders set received_at = now(), updated_at = now() where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, me, format('%s received the outside lenses', x.dest_code));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $$;

-- ── switch the way, or the fitter, while nothing has moved ──
drop function if exists public.change_outside_fulfilment(uuid, text);
create or replace function public.change_outside_fulfilment(p_id uuid, p_fulfilment text, p_dest text default null)
  returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x    public.outside_lens_orders;
  o    public.orders;
  me   text := public.jwt_branch();
  h    text := public.outside_lens_handler();
  dest text;
begin
  if p_fulfilment not in ('send_frames', 'receive_lens') then raise exception 'Unknown fulfilment %', p_fulfilment; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if not (x.branch_code = me or public.is_admin()) then raise exception 'Only the branch that ordered (or the office) can change this'; end if;
  if x.branch_code = h then raise exception 'The lenses arrive at % — nothing to change', h; end if;
  select * into o from public.orders where id = x.order_id for update;
  if x.sent_at is not null then raise exception 'Too late to change — the lenses have already been sent'; end if;
  if not ((x.fulfilment = 'receive_lens' and o.status = 'pending')
       or (x.fulfilment = 'send_frames' and o.status = 'lenses_in' and o.fitter_code = x.dest_code)) then
    raise exception 'Too late to change — the frame has already been sent';
  end if;
  if p_fulfilment = 'send_frames' then
    dest := nullif(p_dest, '');
    if dest is null or dest = x.branch_code then raise exception 'Choose the fitter'; end if;
    if not public.open_fitter(dest) then raise exception '% is not an open fitting centre', coalesce((select name from public.branches where code = dest), dest); end if;
  else
    dest := x.branch_code;
  end if;
  if x.fulfilment = p_fulfilment and x.dest_code = dest then return x; end if;

  update public.outside_lens_orders set fulfilment = p_fulfilment, dest_code = dest, updated_at = now() where id = p_id returning * into x;
  if p_fulfilment = 'send_frames' then
    update public.orders set fitter_code = dest, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    update public.orders set fitter_code = null, status = 'pending', updated_at = now() where id = o.id;
  end if;
  insert into public.order_events (order_id, by_code, text)
  values (o.id, me, case when p_fulfilment = 'send_frames'
                         then format('Changed: the frame and the lenses go to %s', dest)
                         else format('Changed: %s sends the lenses here', h) end);
  return x;
end $$;

-- ── the gates ──
create or replace function public.outside_lens_gate() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  x public.outside_lens_orders;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into x from public.outside_lens_orders where order_id = new.id;
  if not found then return new; end if;
  -- The fitter cannot finish the cut before the lenses have reached it.
  if x.fulfilment = 'send_frames' and x.received_at is null and old.status = 'at_fitter' and new.status in ('ready', 'delivered') then
    raise exception 'The outside lenses have not arrived here yet';
  end if;
  -- Lenses coming to the branch: delivered only once sent (or, at the
  -- handler itself, once ordered) — and that is when they are received.
  if x.fulfilment = 'receive_lens' and old.status = 'pending' and new.status <> 'pending' then
    if x.sent_at is null and not (x.branch_code = public.outside_lens_handler() and x.status = 'ordered') then
      raise exception 'The outside lenses have not been sent yet';
    end if;
    update public.outside_lens_orders set received_at = coalesce(received_at, now()), updated_at = now() where id = x.id;
  end if;
  return new;
end $$;

revoke all on function public.create_outside_lens_order(text, text, jsonb, text, text, text) from public, anon;
revoke all on function public.receive_outside_lenses(uuid)                                   from public, anon;
revoke all on function public.change_outside_fulfilment(uuid, text, text)                    from public, anon;
grant execute on function public.create_outside_lens_order(text, text, jsonb, text, text, text) to authenticated;
grant execute on function public.receive_outside_lenses(uuid)                                   to authenticated;
grant execute on function public.change_outside_fulfilment(uuid, text, text)                    to authenticated;

commit;
