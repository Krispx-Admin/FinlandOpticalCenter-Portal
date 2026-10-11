-- ════════════════════════════════════════════════════════════════════════════
--  12 · The roster in tables of its own, and nothing of it left in the code
--  STATUS: NOT YET APPLIED — run it in the Supabase SQL editor, all at once
--
--  The scheduler's staff and branches were one JSON document inside
--  schedule_state, and a copy of the starting roster was written into
--  scheduler.html itself. Both move here, into rows anyone can read and edit
--  in the Table Editor:
--
--    schedule_employees   one row per person: name, type, optometrist, off
--                         days, and their branches in priority order
--    schedule_branches    one row per branch: name, city, optometrist needed,
--                         keep-together, split, and its hours per day
--    schedule_defaults    what "Reset to defaults" restores — the roster as it
--                         stands today, kept in the database, not the code
--
--  The scheduler saves through save_schedule_roster(), which writes the whole
--  roster in one transaction and refuses to leave it empty. Leave, special
--  dates, part-timers' days, pins and presets stay in schedule_state; every
--  week stays in schedule_weeks.
--
--  The rows are copied from schedule_state and counted before its two JSON
--  columns are dropped — if a count is off, nothing is changed.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · the tables ──────────────────────────────────────────────────────────
create table if not exists public.schedule_branches (
  code         text primary key,
  name         text not null,
  city         text,
  needs_optom  boolean not null default false,
  keep         boolean not null default false,       -- "Keep 2 together"
  split        boolean,                              -- opens in two halves
  days         jsonb not null default '{}'::jsonb,   -- Sat..Fri: open, close, min, max, closed, bStart, bEnd
  position     int not null default 0,               -- order = priority, top first
  updated_at   timestamptz not null default now(),
  updated_by   text
);

create table if not exists public.schedule_employees (
  id            text primary key,
  name          text not null,
  optom         boolean not null default false,
  type          text not null default 'High',        -- Stable, High-Stable, High, Medium, Low, Non-Stable, Part-Time
  weekend_days  text[] not null default '{}',        -- off days: Sat, Sun, …
  priority      text[] not null default '{}',        -- branch codes, home branch first
  position      int not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create table if not exists public.schedule_defaults (
  id          int primary key default 1 check (id = 1),
  employees   jsonb not null default '[]'::jsonb,
  branches    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

drop trigger if exists schedule_branches_touch on public.schedule_branches;
create trigger schedule_branches_touch before insert or update on public.schedule_branches
  for each row execute function public.touch_schedule();

drop trigger if exists schedule_employees_touch on public.schedule_employees;
create trigger schedule_employees_touch before insert or update on public.schedule_employees
  for each row execute function public.touch_schedule();

alter table public.schedule_branches  enable row level security;
alter table public.schedule_employees enable row level security;
alter table public.schedule_defaults  enable row level security;

-- Like the rest of the schedule: the office and Ghiath only. The branches read
-- names from the published weeks, never from here.
drop policy if exists schedule_branches_all on public.schedule_branches;
create policy schedule_branches_all on public.schedule_branches
  for all to authenticated using (public.can_schedule()) with check (public.can_schedule());

drop policy if exists schedule_employees_all on public.schedule_employees;
create policy schedule_employees_all on public.schedule_employees
  for all to authenticated using (public.can_schedule()) with check (public.can_schedule());

drop policy if exists schedule_defaults_read on public.schedule_defaults;
create policy schedule_defaults_read on public.schedule_defaults
  for select to authenticated using (public.can_schedule());

-- ── 2 · copy the roster out of the JSON, and check it all arrived ───────────
do $$
declare
  has_json boolean := exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = 'schedule_state'
                                 and column_name = 'employees');
  want_e int; want_b int; got_e int; got_b int;
begin
  if not has_json then return; end if;   -- already moved on an earlier run

  insert into public.schedule_branches (code, name, city, needs_optom, keep, split, days, position)
  select b->>'code', b->>'name', b->>'city',
         coalesce((b->>'needsOptom')::boolean, false), coalesce((b->>'keep')::boolean, false),
         (b->>'split')::boolean, coalesce(b->'days', '{}'::jsonb), (n - 1)::int
    from public.schedule_state s, jsonb_array_elements(s.branches) with ordinality as x(b, n)
   where s.id = 1
  on conflict (code) do nothing;

  insert into public.schedule_employees (id, name, optom, type, weekend_days, priority, position)
  select e->>'id', e->>'name', coalesce((e->>'optom')::boolean, false), coalesce(e->>'type', 'High'),
         array(select jsonb_array_elements_text(coalesce(e->'weekendDays', '[]'::jsonb))),
         array(select jsonb_array_elements_text(coalesce(e->'priority', '[]'::jsonb))),
         (n - 1)::int
    from public.schedule_state s, jsonb_array_elements(s.employees) with ordinality as x(e, n)
   where s.id = 1
  on conflict (id) do nothing;

  -- "Reset to defaults" restores the roster as it stands today.
  insert into public.schedule_defaults (id, employees, branches)
  select 1, s.employees, s.branches from public.schedule_state s where s.id = 1
  on conflict (id) do update set employees = excluded.employees, branches = excluded.branches, updated_at = now();

  select jsonb_array_length(employees), jsonb_array_length(branches) into want_e, want_b
    from public.schedule_state where id = 1;
  select count(*) into got_e from public.schedule_employees;
  select count(*) into got_b from public.schedule_branches;
  if got_e <> want_e or got_b <> want_b then
    raise exception 'Roster copy did not match: % of % employees, % of % branches — nothing was changed',
      got_e, want_e, got_b, want_b;
  end if;

  alter table public.schedule_state drop column employees, drop column branches;
end $$;

-- ── 3 · saving the roster ───────────────────────────────────────────────────
-- The scheduler hands over the whole roster after a change. One transaction:
-- people and branches no longer in it are removed, the rest written with their
-- order. An empty roster is refused — that is a load gone wrong, not a choice.
create or replace function public.save_schedule_roster(p_employees jsonb, p_branches jsonb)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.can_schedule() then
    raise exception 'Only the office or Ghiath can change the schedule roster';
  end if;
  if coalesce(jsonb_array_length(p_employees), 0) = 0 or coalesce(jsonb_array_length(p_branches), 0) = 0 then
    raise exception 'Refusing to save an empty roster';
  end if;

  delete from public.schedule_employees
   where id not in (select e->>'id' from jsonb_array_elements(p_employees) e);
  insert into public.schedule_employees (id, name, optom, type, weekend_days, priority, position)
  select e->>'id', e->>'name', coalesce((e->>'optom')::boolean, false), coalesce(e->>'type', 'High'),
         array(select jsonb_array_elements_text(coalesce(e->'weekendDays', '[]'::jsonb))),
         array(select jsonb_array_elements_text(coalesce(e->'priority', '[]'::jsonb))),
         (n - 1)::int
    from jsonb_array_elements(p_employees) with ordinality as x(e, n)
  on conflict (id) do update
     set name = excluded.name, optom = excluded.optom, type = excluded.type,
         weekend_days = excluded.weekend_days, priority = excluded.priority, position = excluded.position;

  delete from public.schedule_branches
   where code not in (select b->>'code' from jsonb_array_elements(p_branches) b);
  insert into public.schedule_branches (code, name, city, needs_optom, keep, split, days, position)
  select b->>'code', b->>'name', b->>'city',
         coalesce((b->>'needsOptom')::boolean, false), coalesce((b->>'keep')::boolean, false),
         (b->>'split')::boolean, coalesce(b->'days', '{}'::jsonb), (n - 1)::int
    from jsonb_array_elements(p_branches) with ordinality as x(b, n)
  on conflict (code) do update
     set name = excluded.name, city = excluded.city, needs_optom = excluded.needs_optom,
         keep = excluded.keep, split = excluded.split, days = excluded.days, position = excluded.position;
end $$;

revoke all on function public.save_schedule_roster(jsonb, jsonb) from public, anon;
grant execute on function public.save_schedule_roster(jsonb, jsonb) to authenticated;

commit;
