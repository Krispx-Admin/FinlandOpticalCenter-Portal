-- ════════════════════════════════════════════════════════════════════════════
--  39 · Ready for 50 people at once
--  STATUS: applied 2026-10-16 (by Claude)
--
--  The user (2026-10-16): make sure the portal runs smoothly with 50 people on
--  it at once (16–20 expected). Measured with a year of synthetic data in a
--  rolled-back transaction (15,000 orders, 90,000 events): the office's full
--  load took 15.3 s, almost all of it the row-level-security helpers
--  (jwt_branch(), is_admin() …) being called once per ROW. Wrapped in a
--  sub-select, Postgres runs each once per QUERY (an InitPlan): 1.8 s, and
--  0.25 s with the app's 45-day window. Same rows visible — checked.
--    · Every policy in public: no-argument helpers → (select public.f()).
--      Idempotent: calls already wrapped are left alone.
--    · Indexes on the foreign keys the app joins or filters on (Supabase's
--      performance advisor flagged them).
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare p record; q text; c text; f text;
  fns text[] := array['jwt_branch', 'is_admin', 'is_scheduler', 'can_schedule', 'is_lens_owner', 'outside_lens_handler', 'lens_owner_code'];
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := p.qual; c := p.with_check;
    foreach f in array fns loop
      q := regexp_replace(q, '(?<!SELECT )(public\.)?\m' || f || '\(\)', '(select public.' || f || '())', 'g');
      c := regexp_replace(c, '(?<!SELECT )(public\.)?\m' || f || '\(\)', '(select public.' || f || '())', 'g');
    end loop;
    if q is distinct from p.qual or c is distinct from p.with_check then
      execute format('alter policy %I on %I.%I %s %s', p.policyname, p.schemaname, p.tablename,
        case when q is not null then format('using (%s)', q) else '' end,
        case when c is not null then format('with check (%s)', c) else '' end);
    end if;
  end loop;
end $$;

create index if not exists lens_request_events_req_idx on public.lens_request_events (request_id, at);
create index if not exists lens_requests_order_idx      on public.lens_requests (order_id);
create index if not exists lens_requests_holder_idx     on public.lens_requests (holder_code);
create index if not exists lens_request_lines_stock_idx on public.lens_request_lines (stock_id);
create index if not exists outside_lens_orders_branch_idx on public.outside_lens_orders (branch_code);
create index if not exists outside_lens_orders_dest_idx   on public.outside_lens_orders (dest_code);
create index if not exists orders_collect_idx  on public.orders (collect_code);
create index if not exists orders_frame_at_idx on public.orders (frame_at);
create index if not exists orders_to_code_idx  on public.orders (to_code);
create index if not exists orders_updated_idx  on public.orders (updated_at desc);
create index if not exists damaged_reports_branch_idx on public.damaged_reports (branch_code, created_at desc);

commit;
