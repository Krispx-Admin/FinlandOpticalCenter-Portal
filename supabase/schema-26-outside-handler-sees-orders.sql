-- ════════════════════════════════════════════════════════════════════════════
--  26 · MGM sees every fitting order that has outside lenses
--  STATUS: applied 2026-10-13 (by Claude)
--
--  A shop that RECEIVES outside lenses has no fitter yet, so MGM — which
--  orders and sends those lenses — could not read the order, and its Fitting
--  Log had nowhere to press "Send lenses". MGM (outside_lens_handler) now
--  reads the orders, and their timelines, that carry an outside lens order.
--  Read only; every write still goes through the functions. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists orders_outside_handler_read on public.orders;
create policy orders_outside_handler_read on public.orders for select to authenticated
  using (public.jwt_branch() = public.outside_lens_handler()
         and exists (select 1 from public.outside_lens_orders x where x.order_id = orders.id));

drop policy if exists order_events_outside_handler_read on public.order_events;
create policy order_events_outside_handler_read on public.order_events for select to authenticated
  using (public.jwt_branch() = public.outside_lens_handler()
         and exists (select 1 from public.outside_lens_orders x where x.order_id = order_events.order_id));
