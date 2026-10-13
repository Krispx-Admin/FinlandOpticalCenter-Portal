-- ════════════════════════════════════════════════════════════════════════════
--  28 · Fitting centres can close their bench (fitter on leave) ·
--       outside lenses: frame to MGM, or lenses to the branch — never both
--       to a third place
--  STATUS: applied 2026-10-13 (by Claude)
--
--  BENCH LOCK. branches.bench_closed (+ optional bench_closed_until, a date it
--  reopens by itself). A fitting centre closes its own (Fitting Log header);
--  the office can close any (Settings › Branches). While closed nobody can
--  send a frame there (to_fitter), keep a frame there to cut in-house
--  (-> at_fitter on the short road), or send a frame-goes-over outside order
--  to it. Frames already on their way still arrive. bench_closed(code) is the
--  one test (the date is Muscat's).
--
--  OUTSIDE LENSES (user, 2026-10-13): everything gathers at ONE place first:
--    · "Frame goes to MGM" (send_frames): fitter = MGM, lenses_in — the branch
--      sends the frame to MGM; not offered while MGM's bench is closed.
--    · "Lenses come here" (receive_lens): fitter NONE, pending — MGM sends the
--      lenses once ordered; the branch marks them delivered; then it cuts
--      here ("Keep here" in Send to fitter, if it has a bench and it is open)
--      or sends frame + lenses together to any open fitting centre or an
--      outside cutter.
--    · MGM's own orders: no fitter, lenses_in — MGM keeps it or sends it on.
--  Open orders are put into this shape. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches add column if not exists bench_closed boolean not null default false;
alter table public.branches add column if not exists bench_closed_until date;

create or replace function public.bench_closed(p_code text) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select b.bench_closed and (b.bench_closed_until is null
                          or b.bench_closed_until >= (now() at time zone 'Asia/Muscat')::date)
                     from public.branches b where b.code = p_code), false)
$$;

create or replace function public.set_bench(p_code text, p_closed boolean, p_until date default null) returns void
  language plpgsql security definer set search_path = public as $$
declare
  b public.branches;
begin
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  if b.role <> 'fitting' then raise exception '% has no fitting bench', b.name; end if;
  if not (public.jwt_branch() = p_code or public.is_admin()) then
    raise exception 'Only % itself (or the office) can open or close its bench', b.name;
  end if;
  if p_closed and p_until is not null and p_until < (now() at time zone 'Asia/Muscat')::date then
    raise exception 'The reopening date is in the past';
  end if;
  update public.branches
     set bench_closed = p_closed, bench_closed_until = case when p_closed then p_until else null end
   where code = p_code;
end $$;

-- The lock, whoever writes the order.
create or replace function public.bench_lock_gate() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'to_fitter' and new.fitter_code is not null and public.bench_closed(new.fitter_code) then
    raise exception '% is closed — fitter on leave', (select name from public.branches where code = new.fitter_code);
  end if;
  if new.status = 'at_fitter' and old.status in ('pending', 'lenses_in') and new.fitter_code = new.origin_code
     and public.bench_closed(new.fitter_code) then
    raise exception 'Your bench is closed — fitter on leave. Send it to another fitter';
  end if;
  return new;
end $$;
drop trigger if exists orders_bench_lock on public.orders;
create trigger orders_bench_lock before update of status on public.orders
  for each row execute function public.bench_lock_gate();

-- ── outside lenses ──
create or replace function public.create_outside_lens_order(p_bill text, p_customer text, p_rx jsonb, p_lens_type text,
                                                            p_fulfilment text default 'send_frames')
  returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  me  text := public.jwt_branch();
  h   text := public.outside_lens_handler();
  how text := case when public.jwt_branch() = public.outside_lens_handler() then 'send_frames'
                   else coalesce(nullif(p_fulfilment, ''), 'send_frames') end;
  ord public.orders;
begin
  if me = '' then raise exception 'Not signed in'; end if;
  if how not in ('send_frames', 'receive_lens') then raise exception 'Unknown fulfilment %', how; end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if coalesce(trim(p_lens_type), '') = '' then raise exception 'Type the lens type'; end if;
  if coalesce(trim(p_rx #>> '{r,sph}'), '') = '' and coalesce(trim(p_rx #>> '{l,sph}'), '') = '' then
    raise exception 'Enter the prescription (at least the SPH)';
  end if;
  if how = 'send_frames' and me <> h and public.bench_closed(h) then
    raise exception '% is closed — fitter on leave. Choose “Lenses come here”', (select name from public.branches where code = h);
  end if;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me,
          case when how = 'send_frames' and me <> h then h else null end,
          trim(p_customer),
          case when how = 'send_frames' then 'lenses_in' else 'pending' end)
  returning * into ord;

  insert into public.outside_lens_orders (order_id, branch_code, rx, lens_type, fulfilment)
  values (ord.id, me, coalesce(p_rx, '{}'::jsonb), trim(p_lens_type), how);

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Order logged at %s with outside lenses (%s) — %s orders them; %s',
            me, trim(p_lens_type), h,
            case when me = h then 'cut here or sent on once ordered'
                 when how = 'send_frames' then format('the frame goes to %s, which cuts it', h)
                 else format('%s sends the lenses here; then cut here or send to a fitter', h) end));
  return ord;
end $$;

create or replace function public.change_outside_fulfilment(p_id uuid, p_fulfilment text) returns public.outside_lens_orders
  language plpgsql security definer set search_path = public as $$
declare
  x  public.outside_lens_orders;
  o  public.orders;
  me text := public.jwt_branch();
  h  text := public.outside_lens_handler();
begin
  if p_fulfilment not in ('send_frames', 'receive_lens') then raise exception 'Unknown fulfilment %', p_fulfilment; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if not (x.branch_code = me or public.is_admin()) then
    raise exception 'Only the branch that ordered (or the office) can change this';
  end if;
  if x.branch_code = h then raise exception '%''s own orders stay there', h; end if;
  if x.fulfilment = p_fulfilment then return x; end if;
  select * into o from public.orders where id = x.order_id for update;
  if p_fulfilment = 'send_frames' then
    if x.sent_at is not null or o.status <> 'pending' then raise exception 'Too late to change — the lenses have already been sent'; end if;
    if public.bench_closed(h) then raise exception '% is closed — fitter on leave', (select name from public.branches where code = h); end if;
  else
    if o.status <> 'lenses_in' or o.fitter_code is distinct from h then raise exception 'Too late to change — the frame has already been sent'; end if;
  end if;
  update public.outside_lens_orders set fulfilment = p_fulfilment, updated_at = now() where id = p_id returning * into x;
  if p_fulfilment = 'send_frames' then
    update public.orders set fitter_code = h, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    update public.orders set fitter_code = null, status = 'pending', updated_at = now() where id = o.id;
  end if;
  insert into public.order_events (order_id, by_code, text)
  values (o.id, me, case when p_fulfilment = 'send_frames'
                         then format('Changed: the frame goes to %s for the outside lenses', h)
                         else format('Changed: %s sends the outside lenses here', h) end);
  return x;
end $$;

-- Open orders into this shape.
update public.orders o set fitter_code = public.outside_lens_handler()
  from public.outside_lens_orders x
 where x.order_id = o.id and x.fulfilment = 'send_frames' and o.status = 'lenses_in'
   and o.fitter_code is null and o.origin_code <> public.outside_lens_handler();
update public.orders o set fitter_code = null
  from public.outside_lens_orders x
 where x.order_id = o.id and x.fulfilment = 'receive_lens' and o.status = 'pending' and o.fitter_code is not null;

revoke all on function public.set_bench(text, boolean, date) from public, anon;
grant execute on function public.set_bench(text, boolean, date) to authenticated;
grant execute on function public.bench_closed(text) to anon, authenticated;

commit;
