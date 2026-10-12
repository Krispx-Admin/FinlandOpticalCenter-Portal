-- ════════════════════════════════════════════════════════════════════════════
--  23 · "Under maintenance" reaches the sign-in page too
--  STATUS: applied 2026-10-12 (by Claude)
--
--  The sign-in page's "View schedule" button (and the #/view-schedule page)
--  are used before anyone signs in, so they could not see that the office had
--  switched the Schedule tab off. disabled_tabs() hands out just that list —
--  nothing else from app_settings — to anyone. And schedule_view(), the one
--  function the public schedule reads, now returns nothing while the Schedule
--  tab is off, except to the office: the switch holds on the server, not only
--  in the page. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.disabled_tabs() returns jsonb
  language sql stable security definer set search_path = public as
$$ select coalesce((select disabled_tabs from public.app_settings where id = 1), '[]'::jsonb) $$;

revoke all on function public.disabled_tabs() from public;
grant execute on function public.disabled_tabs() to anon, authenticated;

create or replace function public.schedule_view() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(w.published order by w.week_start), '[]'::jsonb)
    from public.schedule_weeks w
   where w.published is not null
     and w.week_start > (now() at time zone 'Asia/Muscat')::date - 7
     and (public.is_admin() or not (public.disabled_tabs() ? 'schedule'))
$$;
