-- ════════════════════════════════════════════════════════════════════════════
--  61 · Another pair on the same bill
--  STATUS: applied 2026-10-22 (by Claude)
--
--  The user (2026-10-22): no "pairs" box. A bill is "SEEB 10020"; typing one
--  already in the Fitting Log asks "is this another pair?", shows the orders
--  on it (where each is), and on Confirm the ones there become "(1/2)" and the
--  new one "(2/2)" — and so on: (1/3) (2/3) (3/3)… Tried in the Admin Demo first.
--   bill_orders(base)  the orders on a bill, as the caller may see them (row rules).
--   pair_ref(base)     renumbers them (i/n+1) in the order they were logged,
--                      notes it on each, and returns the new one's bill,
--                      "base (n+1/n+1)". Only the branch that logged them (or
--                      'act_all'). Locked, so two at once cannot take one number.
--   pair_fix(base)     renumbers what is there now (i/n) — after a new pair
--                      could not be saved; one left is the plain bill again.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.bill_orders(p_base text)
 returns table (id uuid, ref text, customer text, status text, origin_code text, fitter_code text, outside_cutter text, created_at timestamptz)
 language sql stable security invoker
 set search_path to 'public'
as $$
  select o.id, o.ref, o.customer, o.status, o.origin_code, o.fitter_code, o.outside_cutter, o.created_at
    from public.orders o
   where o.ref = p_base or o.ref like p_base || ' (%'
   order by o.created_at;
$$;
revoke all on function public.bill_orders(text) from public, anon;
grant execute on function public.bill_orders(text) to authenticated;

create or replace function public.pair_ref(p_base text)
 returns text
 language plpgsql security definer
 set search_path to 'public'
as $$
declare
  me  text := public.jwt_branch();
  n   int;
  r   record;
  i   int := 0;
  nu  text;
begin
  if coalesce(btrim(p_base), '') = '' then raise exception 'No bill number'; end if;
  perform 1 from public.orders where ref = p_base or ref like p_base || ' (%' for update;
  select count(*) into n from public.orders where ref = p_base or ref like p_base || ' (%';
  if n = 0 then return p_base; end if;
  if exists (select 1 from public.orders where (ref = p_base or ref like p_base || ' (%')
               and origin_code <> me) and not public.has_perm('act_all') then
    raise exception '% was logged by another branch', p_base;
  end if;
  for r in select id, ref from public.orders where ref = p_base or ref like p_base || ' (%' order by created_at loop
    i := i + 1;
    nu := format('%s (%s/%s)', p_base, i, n + 1);
    if r.ref <> nu then
      update public.orders set ref = nu, updated_at = now() where id = r.id;
      insert into public.order_events (order_id, by_code, text)
      values (r.id, nullif(me, ''), format('Bill now %s — another pair added on the same bill', nu));
    end if;
  end loop;
  return format('%s (%s/%s)', p_base, n + 1, n + 1);
end $$;
revoke all on function public.pair_ref(text) from public, anon;
grant execute on function public.pair_ref(text) to authenticated;

create or replace function public.pair_fix(p_base text)
 returns void
 language plpgsql security definer
 set search_path to 'public'
as $$
declare
  me text := public.jwt_branch();
  n  int;
  r  record;
  i  int := 0;
  nu text;
begin
  perform 1 from public.orders where ref = p_base or ref like p_base || ' (%' for update;
  select count(*) into n from public.orders where ref = p_base or ref like p_base || ' (%';
  if n = 0 then return; end if;
  if exists (select 1 from public.orders where (ref = p_base or ref like p_base || ' (%')
               and origin_code <> me) and not public.has_perm('act_all') then
    raise exception '% was logged by another branch', p_base;
  end if;
  for r in select id, ref from public.orders where ref = p_base or ref like p_base || ' (%' order by created_at loop
    i := i + 1;
    nu := case when n = 1 then p_base else format('%s (%s/%s)', p_base, i, n) end;
    if r.ref <> nu then update public.orders set ref = nu, updated_at = now() where id = r.id; end if;
  end loop;
end $$;
revoke all on function public.pair_fix(text) from public, anon;
grant execute on function public.pair_fix(text) to authenticated;

commit;
