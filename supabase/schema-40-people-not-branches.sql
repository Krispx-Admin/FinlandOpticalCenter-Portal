-- ════════════════════════════════════════════════════════════════════════════
--  40 · People are not branches
--  STATUS: applied 2026-10-17 (by Claude)
--
--  The user (2026-10-17): Omar (office), Ghiath, Wijdan and Sarah are people,
--  not branches — they must never be chosen where a branch is meant. The
--  "collect at" check accepted any role but 'admin', so a view-only admin or
--  Ghiath could be named as the place a customer collects. Now: an open
--  retail shop, fitting centre or clinic only. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.set_collect(p_id uuid, p_code text) returns public.orders
  language plpgsql security definer set search_path = public as $$
declare
  o     public.orders;
  me    text := public.jwt_branch();
  p     text;
  old_c text;
  l     text;
  n     int;
  note  text := '';
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (me in (o.origin_code, o.fitter_code, o.collect_code, o.to_code, o.frame_at) or me = any(o.stops) or public.is_admin()) then
    raise exception 'Only a branch on this order''s route (or the office) can change where it is collected';
  end if;
  if o.status = 'collected' then raise exception 'Already handed to the customer'; end if;
  p := coalesce(nullif(p_code, ''), o.origin_code);
  -- A branch only — never a person's profile (the office, Ghiath, Wijdan, Sarah).
  if not exists (select 1 from public.branches where code = p and active and role in ('retail', 'fitting', 'clinic')) then
    raise exception '% is not an open branch', p;
  end if;
  old_c := coalesce(o.collect_code, o.origin_code);
  if p = old_c then return o; end if;

  perform set_config('foc.route', '1', true);
  if o.status = 'ready' then
    l := coalesce(o.frame_at, case when o.outside_cutter is not null then o.origin_code else o.fitter_code end);
    if p = l then                                                       -- it is already there
      n := coalesce(array_length(o.stops, 1), 0);
      update public.orders set status = 'delivered', frame_at = l,
             stops = case when n > 0 and o.stops[n] = l then o.stops[1:n - 1] else o.stops end
       where id = p_id;
      note := ' — it is already there: ready for collection';
    end if;
  elsif o.status = 'delivered' then
    l := coalesce(o.frame_at, old_c);
    update public.orders set status = 'ready', frame_at = l,
           stops = case when l = o.fitter_code or (o.outside_cutter is not null and l = o.origin_code) then o.stops else o.stops || l end
     where id = p_id;
    note := format(' — %s transfers it', l);
  elsif o.status = 'returning' then
    note := format(' — it reaches %s first, then is transferred', coalesce(o.to_code, old_c));
  end if;
  update public.orders set collect_code = case when p = o.origin_code then null else p end, updated_at = now()
   where id = p_id returning * into o;
  perform set_config('foc.route', '', true);

  insert into public.order_events (order_id, by_code, text)
  values (p_id, coalesce(nullif(me, ''), o.origin_code), format('Collection moved: %s → %s%s', old_c, p, note));
  return o;
end $$;

commit;
