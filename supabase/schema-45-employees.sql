-- ════════════════════════════════════════════════════════════════════════════
--  45 · Employees: their own list, apart from the schedule's roster
--  STATUS: applied 2026-10-18 (by Claude)
--
--  The user (2026-10-18): "in the employee tab it should be separate from the
--  schedule employee tab — let the employee tab be the list of employees, and
--  the settings in the schedule tab that has the employees is to its own",
--  with the staff's full names, "first and last name, no need for middle
--  name". Settings → Employees edited schedule_employees (the scheduler's
--  short names, branches, days off) and the Direct Insurance salesperson list
--  read it too. Now:
--    · public.employees — the staff, by full name. Settings → Employees edits
--      it (the office); staff_list() (the salesperson list) reads it.
--    · schedule_employees stays the Schedule tab's own, untouched.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);
create unique index if not exists employees_name_key on public.employees (lower(btrim(name)));

alter table public.employees enable row level security;
drop policy if exists employees_admin on public.employees;
create policy employees_admin on public.employees for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.employees from public, anon;
grant select, insert, update, delete on public.employees to authenticated;

-- The salesperson list: every signed-in location reads it through here.
create or replace function public.staff_list()
 returns table(id text, name text, branches text[])
 language sql stable security definer
 set search_path to 'public'
as $$ select e.id::text, e.name, '{}'::text[] from public.employees e order by lower(e.name) $$;

insert into public.employees (name) values
  ('Mohamed Ashraf'), ('Osama Hamad'), ('Diaa Mutlak'), ('Saad Abuseedo'),
  ('Fatma Al Kindi'), ('Ranad Al Jabri'), ('Salsabeel Al Difaii'), ('Mohammed Marei'),
  ('Omar Al Said'), ('Salman Ammar'), ('Muneera Al Alawi'), ('Hifaa Al Qutaiti'),
  ('Asif Mohammed'), ('Hamza Mashah'), ('Abdul Aziz Naseer'), ('Ahmad Jalabi'),
  ('Bengherbia Oussama'), ('Wijdan Ali'), ('Noor Al Rawahi'), ('Mootez Al Mersni'),
  ('Yaseen'), ('Mohammad Nada'), ('Bayan'), ('AbdulRaheem'),
  ('Shafiq'), ('Jummana'), ('Ahmad Al Khalili'), ('Amir'),
  ('Mithaa'), ('Najwa Saleh')
on conflict do nothing;

commit;
