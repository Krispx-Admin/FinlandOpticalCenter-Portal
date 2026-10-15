-- ════════════════════════════════════════════════════════════════════════════
--  37 · View-only admins, the insurance export switch, and Damaged Stock
--  STATUS: applied 2026-10-15 (by Claude)
--
--  The user (2026-10-15):
--    · Office (OFC) is Omar — the one real admin.
--    · Wijdan and Sarah are admins who SEE everything but change little, like
--      Ghiath: a new role 'manager'. They are added by the office in Settings
--      → Branches with a sign-in code the office types (never by Claude).
--      is_scheduler(), which every "read it all" policy uses, now covers
--      'manager' too. Writing the schedule stays can_schedule() (admin,
--      scheduler).
--    · branches.can_export_insurance: a profile that may export Direct
--      Insurance to Excel (Sarah). The office always may. set_insurance_export.
--    · DAMAGED STOCK: a branch walks the shop, lists the damaged pieces (name
--      of the glasses, barcode, qty — many lines) and sends the report.
--      Omar, Wijdan and Sarah print it and send the paper; Ghiath may look.
--      Numbered DS-1001…; the branch (or office) can delete a report sent by
--      mistake.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── roles ──
alter table public.branches drop constraint if exists branches_role_check;
alter table public.branches add constraint branches_role_check
  check (role in ('retail', 'fitting', 'clinic', 'admin', 'scheduler', 'manager'));
alter table public.branches add column if not exists can_export_insurance boolean not null default false;

-- Sees everything, read-only: Ghiath (scheduler) and the view-only admins.
create or replace function public.is_scheduler() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.role in ('scheduler', 'manager')) $$;

update public.branches set name = 'Omar' where code = 'OFC' and name = 'Office';

create or replace function public.add_branch(p_code text, p_name text, p_role text, p_pin text) returns void
  language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_code  text := upper(trim(coalesce(p_code, '')));
  nm    text := trim(coalesce(p_name, ''));
  v_email text;
  uid   uuid := gen_random_uuid();
  src   auth.users;
begin
  if not public.is_admin() then
    raise exception 'Only the office may add branches';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9]{1,9}$' then
    raise exception 'The code is 2 to 10 letters or digits, starting with a letter';
  end if;
  if nm = '' then
    raise exception 'Give it a name';
  end if;
  if p_role not in ('retail', 'fitting', 'clinic', 'manager') then
    raise exception 'A branch is a retail shop, a fitting centre or a clinic — or an admin (view only)';
  end if;
  if exists (select 1 from public.branches b where b.code = v_code) then
    raise exception 'There is already a profile %', v_code;
  end if;
  perform public.assert_good_pin(p_pin);

  v_email := lower(v_code) || '@finlandoptical.om';
  if exists (select 1 from auth.users u where u.email = v_email) then
    raise exception 'A sign-in account % already exists', v_email;
  end if;

  insert into public.branches (code, name, role, holds_lens_stock, active, position)
  values (v_code, nm, p_role, false, true,
          coalesce((select max(position) from public.branches), 0) + 1);

  -- Shaped exactly like the accounts the branches already sign in with.
  select * into src from auth.users where raw_app_meta_data ? 'branch_code' limit 1;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
    created_at, updated_at)
  values (
    src.instance_id, uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_pin, extensions.gen_salt('bf')), now(),
    '', '', '', '', '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                       'branch_code', v_code, 'branch_role', p_role),
    '{"email_verified": true}'::jsonb, src.is_super_admin, false, false,
    now(), now());

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (uid::text, uid,
          jsonb_build_object('sub', uid::text, 'email', v_email,
                             'email_verified', false, 'phone_verified', false),
          'email', now(), now());
end $$;

create or replace function public.save_branch(p_code text, p_name text, p_role text, p_active boolean) returns void
  language plpgsql security definer set search_path = public, auth as $$
declare
  b  public.branches;
  nm text := trim(coalesce(p_name, ''));
begin
  if not public.is_admin() then
    raise exception 'Only the office may change branches';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then
    raise exception 'No branch %', p_code;
  end if;
  if nm = '' then
    raise exception 'Give it a name';
  end if;
  if b.role in ('admin', 'scheduler') then
    if p_role is distinct from b.role or not p_active then
      raise exception '% keeps its role and cannot be closed', b.name;
    end if;
  elsif b.role = 'manager' then
    if p_role is distinct from b.role then raise exception '% stays an admin (view only)', b.name; end if;
  elsif p_role not in ('retail', 'fitting', 'clinic') then
    raise exception 'A branch is a retail shop, a fitting centre or a clinic';
  end if;
  if b.holds_lens_stock and (p_role <> 'fitting' or not p_active) then
    raise exception '% holds the lens stock, so it has to stay an open fitting centre', b.name;
  end if;

  update public.branches set name = nm, role = p_role, active = p_active where code = p_code;

  update auth.users
     set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('branch_role', p_role),
         banned_until = case when p_active then null else now() + interval '100 years' end,
         updated_at = now()
   where (raw_app_meta_data ->> 'branch_code') = p_code;
end $$;

create or replace function public.set_insurance_export(p_code text, p_on boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the office may change this'; end if;
  update public.branches set can_export_insurance = coalesce(p_on, false) where code = p_code;
  if not found then raise exception 'No profile %', p_code; end if;
end $$;

-- ── Damaged Stock ──
create sequence if not exists public.damage_seq start 1001;

create table if not exists public.damaged_reports (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique default ('DS-' || nextval('public.damage_seq')),
  branch_code text not null references public.branches(code),
  note        text not null default '',
  created_at  timestamptz not null default now()
);
create table if not exists public.damaged_lines (
  id        uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.damaged_reports(id) on delete cascade,
  position  integer not null default 0,
  name      text not null,
  barcode   text not null default '',
  qty       integer not null check (qty > 0)
);
create index if not exists damaged_lines_report on public.damaged_lines(report_id);

alter table public.damaged_reports enable row level security;
alter table public.damaged_lines enable row level security;

drop policy if exists damaged_reports_read on public.damaged_reports;
create policy damaged_reports_read on public.damaged_reports for select to authenticated
  using (branch_code = public.jwt_branch() or public.is_admin() or public.is_scheduler());
drop policy if exists damaged_reports_delete on public.damaged_reports;
create policy damaged_reports_delete on public.damaged_reports for delete to authenticated
  using (branch_code = public.jwt_branch() or public.is_admin());
drop policy if exists damaged_lines_read on public.damaged_lines;
create policy damaged_lines_read on public.damaged_lines for select to authenticated
  using (exists (select 1 from public.damaged_reports r where r.id = damaged_lines.report_id
                   and (r.branch_code = public.jwt_branch() or public.is_admin() or public.is_scheduler())));

grant select, delete on public.damaged_reports to authenticated;
grant select on public.damaged_lines to authenticated;

-- A branch sends a report, all its lines at once.
create or replace function public.create_damaged_report(p_lines jsonb, p_note text default '') returns public.damaged_reports
  language plpgsql security definer set search_path = public as $$
declare
  me  text := public.jwt_branch();
  r   public.damaged_reports;
  l   record;
  i   int := 0;
begin
  if not exists (select 1 from public.branches where code = me and role in ('retail', 'fitting', 'clinic') and active) then
    raise exception 'Only a branch can send a damaged stock report';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Add at least one item'; end if;
  insert into public.damaged_reports (branch_code, note) values (me, trim(coalesce(p_note, ''))) returning * into r;
  for l in select trim(coalesce(x->>'name', '')) as name, trim(coalesce(x->>'barcode', '')) as barcode,
                  coalesce(nullif(x->>'qty', '')::int, 0) as qty
             from jsonb_array_elements(p_lines) x loop
    if l.name = '' then raise exception 'Every line needs the name of the glasses'; end if;
    if l.qty <= 0 then raise exception 'Every line needs a quantity'; end if;
    insert into public.damaged_lines (report_id, position, name, barcode, qty) values (r.id, i, l.name, l.barcode, l.qty);
    i := i + 1;
  end loop;
  return r;
end $$;
revoke all on function public.create_damaged_report(jsonb, text) from public, anon;
grant execute on function public.create_damaged_report(jsonb, text) to authenticated;
revoke all on function public.set_insurance_export(text, boolean) from public, anon;
grant execute on function public.set_insurance_export(text, boolean) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.damaged_reports; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.damaged_lines; exception when duplicate_object then null; end;
end $$;

commit;
