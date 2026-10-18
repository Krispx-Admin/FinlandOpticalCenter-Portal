-- ════════════════════════════════════════════════════════════════════════════
--  48 · A branch's opening hours, as the schedule has them this week
--  STATUS: applied 2026-10-18 (by Claude)
--
--  The user (2026-10-18): the WhatsApp "ready for collection" message must
--  "always take the timings of what the schedule has because sometimes
--  depending on the season timings change". The schedule keeps each branch's
--  hours per day (open / close / closed) — in this week's saved schedule, and
--  as the branch's standing hours. Only the office and Ghiath may read the
--  schedule's tables, so this hands out just one branch's hours to a signed-in
--  location: this week's (Oman time) if the week is saved, else the standing
--  ones. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.branch_hours(p_code text)
 returns jsonb
 language sql stable security definer
 set search_path to 'public'
as $$
  -- Open / close / closed for each day — nothing about staffing.
  select (select jsonb_object_agg(d.key, jsonb_build_object('open', d.value -> 'open', 'close', d.value -> 'close',
                                                            'closed', coalesce(d.value -> 'closed', 'false'::jsonb)))
            from jsonb_each(coalesce(
    (select b -> 'days'
       from public.schedule_weeks w, jsonb_array_elements(case when jsonb_typeof(w.branches) = 'array' then w.branches else '[]'::jsonb end) b
      where w.week_start <= (now() at time zone 'Asia/Muscat')::date
        and (now() at time zone 'Asia/Muscat')::date < w.week_start + 7
        and b ->> 'code' = p_code
      order by w.week_start desc
      limit 1),
    (select days from public.schedule_branches where code = p_code),
    '{}'::jsonb)) d)
$$;
revoke all on function public.branch_hours(text) from public, anon;
grant execute on function public.branch_hours(text) to authenticated;

commit;
