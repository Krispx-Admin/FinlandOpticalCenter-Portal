-- ════════════════════════════════════════════════════════════════════════════
--  31 · A last step: the customer collects the glasses
--  STATUS: applied 2026-10-13 (by Claude)
--
--  The user (2026-10-13): when the frame is back, the branch marks it handed
--  to the customer. New final status 'collected' after 'delivered':
--  'delivered' now means "back at the branch — ready for collection" (the
--  branch presses "Handed to customer"); 'collected' is the finished job.
--  The 37 orders already at 'delivered' were finished jobs, so they become
--  'collected' — without touching their updated_at. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','lenses_in','to_fitter','at_fitter','ready','returning','delivered','collected'));

-- Finished jobs stay finished, with their dates.
alter table public.orders disable trigger orders_touch;
update public.orders set status = 'collected' where status = 'delivered';
alter table public.orders enable trigger orders_touch;

-- Un-ordering outside lenses is also refused once the job has been collected.
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
        where x.id = any(p_ids) and (x.sent_at is not null or o.status in ('ready', 'returning', 'delivered', 'collected')
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

commit;
