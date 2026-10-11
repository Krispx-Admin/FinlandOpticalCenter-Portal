-- ════════════════════════════════════════════════════════════════════════════
--  11 · Publishing the schedule; Al Mouj is MOUJ; the dates move to their day
--  STATUS: NOT YET APPLIED — run it in the Supabase SQL editor, all at once
--
--  1 · A week is the office's and Ghiath's until one of them presses Publish.
--      That copies the week as it stands into `published`, and only published
--      weeks reach the branches and the public page — so a half-made week, or
--      an edit not yet confirmed, never shows. schedule_view() now hands out
--      every published week that has not finished: this week and any ahead.
--
--  2 · The scheduler called Al Mouj "WAVE". It is MOUJ everywhere else in the
--      portal, so the saved roster, branches, special dates, pins, presets and
--      weeks are renamed to match. The new scheduler.html seeds MOUJ too.
--
--  3 · The scheduler worked its dates out in UTC, which in Oman is still the
--      day before: the week of Saturday 17 Oct was saved as 16–22 Oct. The app
--      now counts in local time; this moves weeks already saved onto their own
--      days (day n is week_start + n). Leave was matched against the shifted
--      dates too — generate such a week again to place leave on the right day.
--
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · WAVE → MOUJ ─────────────────────────────────────────────────────────
-- A code appears as a whole JSON string ("WAVE") — as a branch code, a
-- priority, a key in a day's staffing — or opening a note ("WAVE: Ramadan").
update public.schedule_state set
  branches  = replace(branches::text,  '"WAVE"', '"MOUJ"')::jsonb,
  employees = replace(employees::text, '"WAVE"', '"MOUJ"')::jsonb,
  overrides = replace(replace(overrides::text, '"WAVE"', '"MOUJ"'), '"WAVE: ', '"MOUJ: ')::jsonb,
  pins      = replace(pins::text,      '"WAVE"', '"MOUJ"')::jsonb,
  presets   = replace(replace(presets::text, '"WAVE"', '"MOUJ"'), '"WAVE: ', '"MOUJ: ')::jsonb
 where id = 1;

update public.schedule_weeks set
  result    = replace(replace(result::text, '"WAVE"', '"MOUJ"'), '"WAVE: ', '"MOUJ: ')::jsonb,
  employees = replace(employees::text, '"WAVE"', '"MOUJ"')::jsonb,
  branches  = replace(branches::text,  '"WAVE"', '"MOUJ"')::jsonb;

-- ── 2 · each saved day onto its own date ────────────────────────────────────
update public.schedule_weeks w
   set result = jsonb_set(w.result, '{days}', (
         select jsonb_agg(jsonb_set(d, '{iso}', to_jsonb(to_char(w.week_start + (n - 1)::int, 'YYYY-MM-DD'))) order by n)
           from jsonb_array_elements(w.result -> 'days') with ordinality as x(d, n)))
 where jsonb_typeof(w.result -> 'days') = 'array'
   and w.result -> 'days' -> 0 ->> 'iso' is distinct from to_char(w.week_start, 'YYYY-MM-DD');

-- ── 3 · publishing ──────────────────────────────────────────────────────────
alter table public.schedule_weeks
  add column if not exists published    jsonb,
  add column if not exists published_at timestamptz,
  add column if not exists published_by text;

comment on column public.schedule_weeks.published is
  'The week as it was when last published: {week_start, result, employees, branches}. The only part of this table the branches ever see.';

-- Copy a week, as it stands, into what everyone sees. The office and Ghiath only.
create or replace function public.publish_schedule_week(p_week date)
  returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare
  at timestamptz;
begin
  if not public.can_schedule() then
    raise exception 'Only the office or Ghiath can publish the schedule';
  end if;

  update public.schedule_weeks
     set published = jsonb_build_object('week_start', week_start, 'result', result,
                                        'employees', employees, 'branches', branches),
         published_at = now(),
         published_by = nullif(public.jwt_branch(), '')
   where week_start = p_week
  returning published_at into at;

  if not found then
    raise exception 'There is no schedule for that week yet';
  end if;
  return at;
end $$;

revoke all on function public.publish_schedule_week(date) from public, anon;
grant execute on function public.publish_schedule_week(date) to authenticated;

-- Every published week that has not finished in Oman — this week and any
-- ahead — oldest first. Nothing unpublished, nothing past. Open to the anon
-- key on purpose: the "View schedule" page has no sign-in.
create or replace function public.schedule_view() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(w.published order by w.week_start), '[]'::jsonb)
    from public.schedule_weeks w
   where w.published is not null
     and w.week_start > (now() at time zone 'Asia/Muscat')::date - 7
$$;

revoke all on function public.schedule_view() from public;
grant execute on function public.schedule_view() to anon, authenticated;

commit;
