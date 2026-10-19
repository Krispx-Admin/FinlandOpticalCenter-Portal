-- ════════════════════════════════════════════════════════════════════════════
--  50 · Access permissions per account
--  STATUS: applied 2026-10-19 (by Claude)
--
--  The user (2026-10-19): instead of fixed kinds of admin (office admin,
--  schedule editor, view-only admin), each account gets "Access Permissions"
--  — tick boxes for what it may do, and View only. People become one kind,
--  'person'; branches keep their own work and may be given more.
--
--    see_all           see every branch's records
--    act_all           change any branch's records (orders, invoices,
--                      insurance, damaged stock, lens stock and requests)
--    office_queue      complete the branches' stock requests
--    accounts          Settings: accounts, codes, permissions, employees
--    lists             Settings: lists and tabs (+ open a tab under maintenance)
--    insurance_dash    the Direct Insurance dashboard            (the app)
--    export_insurance  export Insurance Sales                    (the app)
--    schedule_edit     build and publish the schedule
--    view_only         changes nothing — overrides the changing ones above
--
--  The three checks every rule already uses keep their names and now read the
--  ticks: is_admin() = act_all, is_scheduler() (sees all) = see_all, or
--  act_all / office_queue, can_schedule() = schedule_edit. Account management,
--  lists and the office queue check their own tick. Everyone keeps exactly
--  today's access: the office everything; Ghiath see all + schedule; Wijdan,
--  Sarah, Mohammad Azmi see all + view only (+ export for Sarah). OFC is
--  renamed "Office"; a new person "Omar" gets everything (a random code
--  nobody sees — the office sets his in Settings).
--
--  The anon key (the sign-in screen) cannot read the permissions.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches add column if not exists perms text[] not null default '{}';
alter table public.branches drop constraint if exists branches_role_check;
alter table public.branches add constraint branches_role_check
  check (role in ('retail', 'fitting', 'clinic', 'person', 'admin', 'scheduler', 'manager'));
alter table public.branches drop constraint if exists branches_perms_check;
alter table public.branches add constraint branches_perms_check check (perms <@ array['see_all', 'act_all', 'office_queue',
  'accounts', 'lists', 'insurance_dash', 'export_insurance', 'schedule_edit', 'view_only']::text[]);

-- Today's access, carried over exactly.
update public.branches set perms = array['see_all', 'act_all', 'office_queue', 'accounts', 'lists', 'insurance_dash', 'export_insurance', 'schedule_edit']
 where role = 'admin';
update public.branches set perms = array['see_all', 'insurance_dash', 'schedule_edit'] where role = 'scheduler';
update public.branches set perms = array['see_all', 'insurance_dash', 'view_only']
       || case when can_export_insurance then array['export_insurance'] else '{}'::text[] end
 where role = 'manager';
update public.branches set perms = array['export_insurance'] where role in ('retail', 'fitting', 'clinic') and can_export_insurance;
update public.branches set role = 'person' where role in ('admin', 'scheduler', 'manager');
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"branch_role": "person"}'::jsonb
 where raw_app_meta_data ->> 'branch_code' in (select code from public.branches where role = 'person');
update public.branches set name = 'Office' where code = 'OFC';

-- The sign-in screen (anon) reads the list, never the permissions.
revoke select on public.branches from anon;
grant select (code, name, name_ar, role, active, position, holds_lens_stock, bench_closed, bench_closed_until,
              bench_own_only, can_export_insurance, created_at) on public.branches to anon;

-- May the signed-in account do this? View only takes back every changing one.
create or replace function public.has_perm(p text)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.branches b
                  where b.code = public.jwt_branch() and b.active and p = any(b.perms)
                    and not (p in ('act_all', 'office_queue', 'accounts', 'lists', 'schedule_edit') and 'view_only' = any(b.perms)))
$$;
-- Whether an account (a row) can manage the accounts — for the guards.
create or replace function public.manages_accounts(b public.branches)
 returns boolean language sql immutable
as $$ select 'accounts' = any(b.perms) and not ('view_only' = any(b.perms)) $$;

create or replace function public.is_admin()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.has_perm('act_all') $$;
create or replace function public.is_scheduler()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.active
                        and b.perms && array['see_all', 'act_all', 'office_queue']) $$;
create or replace function public.can_schedule()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select public.has_perm('schedule_edit') $$;

-- Rules that are about running the portal, not the records.
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using ((select public.has_perm('lists'))) with check ((select public.has_perm('lists')));
drop policy if exists lens_catalogue_write on public.lens_catalogue;
create policy lens_catalogue_write on public.lens_catalogue for all to authenticated
  using ((select public.is_lens_owner()) or (select public.has_perm('lists')))
  with check ((select public.is_lens_owner()) or (select public.has_perm('lists')));
drop policy if exists stock_requests_update on public.stock_requests;
create policy stock_requests_update on public.stock_requests for update to authenticated
  using ((select public.has_perm('office_queue'))) with check ((select public.has_perm('office_queue')));
drop policy if exists employees_admin on public.employees;
create policy employees_admin on public.employees for all to authenticated
  using ((select public.has_perm('accounts'))) with check ((select public.has_perm('accounts')));

-- Set an account's permissions — never leaving no one able to manage accounts.
create or replace function public.set_permissions(p_code text, p_perms text[])
 returns void language plpgsql security definer set search_path to 'public'
as $$
declare b public.branches; nxt text[];
begin
  if not public.has_perm('accounts') then raise exception 'Only an account that manages accounts can change permissions'; end if;
  select * into b from public.branches where code = p_code for update;
  if not found then raise exception 'No account %', p_code; end if;
  nxt := array(select distinct unnest(coalesce(p_perms, '{}')) order by 1);
  if not (nxt <@ array['see_all', 'act_all', 'office_queue', 'accounts', 'lists', 'insurance_dash', 'export_insurance', 'schedule_edit', 'view_only']::text[]) then
    raise exception 'Unknown permission in %', p_perms;
  end if;
  if public.manages_accounts(b) and not ('accounts' = any(nxt) and not 'view_only' = any(nxt))
     and not exists (select 1 from public.branches o where o.code <> p_code and o.active and public.manages_accounts(o)) then
    raise exception '% is the last account that can manage accounts - give that to another first', b.name;
  end if;
  update public.branches set perms = nxt where code = p_code;
end $$;
revoke all on function public.set_permissions(text, text[]) from public, anon;
grant execute on function public.set_permissions(text, text[]) to authenticated;
revoke all on function public.has_perm(text) from public, anon;
grant execute on function public.has_perm(text) to authenticated;
revoke all on function public.manages_accounts(public.branches) from public, anon;
grant execute on function public.manages_accounts(public.branches) to authenticated;

CREATE OR REPLACE FUNCTION public.branch_access()
 RETURNS TABLE(code text, name text, role text, active boolean, "position" integer, holds_lens_stock boolean, has_account boolean, last_sign_in timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select b.code, b.name, b.role, b.active, b.position, b.holds_lens_stock,
         u.id is not null as has_account,
         u.last_sign_in_at
    from public.branches b
    left join auth.users u on (u.raw_app_meta_data ->> 'branch_code') = b.code
   where public.has_perm('accounts')
   order by b.position, b.code
$function$;

CREATE OR REPLACE FUNCTION public.set_branch_code(p_branch text, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  n int;
begin
  if not public.has_perm('accounts') then
    raise exception 'Only the office may change branch codes';
  end if;
  perform public.assert_good_pin(p_code);

  update auth.users
     set encrypted_password = extensions.crypt(p_code, extensions.gen_salt('bf')),
         updated_at = now()
   where (raw_app_meta_data ->> 'branch_code') = p_branch;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'No sign-in account exists for branch %', p_branch;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_branch_name_ar(p_code text, p_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_perm('accounts') then raise exception 'Only the office can rename a branch'; end if;
  update public.branches set name_ar = nullif(btrim(p_name), '') where code = p_code;
  if not found then raise exception 'No such branch'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_lens_holder(p_code text, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.branches;
  n int;
begin
  if not public.has_perm('accounts') then
    raise exception 'Only the office may change who holds lens stock';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;

  if p_on then
    if b.role <> 'fitting' or not b.active then
      raise exception 'Only an open fitting centre can hold lens stock â€” frames are sent to it for cutting';
    end if;
  else
    select coalesce(sum(qty), 0) into n from public.lens_stock where holder_code = p_code;
    if n > 0 then
      raise exception '% still has % lenses on its shelf â€” clear them first', b.name, n;
    end if;
    select count(*) into n from public.lens_requests where holder_code = p_code and status = 'requested';
    if n > 0 then
      raise exception '% still has % lens request% to answer', b.name, n, case when n = 1 then '' else 's' end;
    end if;
    if (select count(*) from public.branches where holds_lens_stock and code <> p_code) = 0 then
      raise exception '% is the only branch holding lens stock', b.name;
    end if;
  end if;

  update public.branches set holds_lens_stock = p_on where code = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.set_bench(p_code text, p_closed boolean, p_until date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.branches;
begin
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  if b.role <> 'fitting' then raise exception '% has no lab', b.name; end if;
  if not (public.jwt_branch() = p_code or public.has_perm('accounts')) then
    raise exception 'Only % itself (or the office) can change its lab', b.name;
  end if;
  if p_closed and p_until is not null and p_until < (now() at time zone 'Asia/Muscat')::date then
    raise exception 'The reopening date is in the past';
  end if;
  update public.branches
     set bench_closed = p_closed, bench_closed_until = case when p_closed then p_until else null end, bench_own_only = false
   where code = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.set_lab(p_code text, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.branches;
begin
  if p_mode not in ('on', 'inhouse', 'off') then raise exception 'Unknown lab setting %', p_mode; end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  if b.role <> 'fitting' then raise exception '% has no lab', b.name; end if;
  if not (public.jwt_branch() = p_code or public.has_perm('accounts')) then
    raise exception 'Only % itself (or the office) can change its lab', b.name;
  end if;
  update public.branches
     set bench_closed = (p_mode = 'off'), bench_closed_until = null, bench_own_only = (p_mode = 'inhouse')
   where code = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.set_insurance_export(p_code text, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.has_perm('accounts') then raise exception 'Only the office may change this'; end if;
  update public.branches set can_export_insurance = coalesce(p_on, false) where code = p_code;
  if not found then raise exception 'No profile %', p_code; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.complete_stock_request(p_request uuid)
 RETURNS stock_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.stock_requests;
begin
  if not public.has_perm('office_queue') then raise exception 'Only the office may complete a request'; end if;
  select * into r from public.stock_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'placed' then raise exception 'Request is already %', r.status; end if;
  update public.stock_request_lines set done_at = now() where request_id = p_request and done_at is null;
  update public.stock_requests set status = 'completed', updated_at = now() where id = p_request returning * into r;
  insert into public.stock_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(), 'Fulfilled and completed at the warehouse');
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.complete_stock_lines(p_request uuid, p_lines uuid[])
 RETURNS stock_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r     public.stock_requests;
  names text;
  left_ int;
begin
  if not public.has_perm('office_queue') then raise exception 'Only the office may complete a request'; end if;
  select * into r from public.stock_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'placed' then raise exception 'Request is already %', r.status; end if;

  with done as (
    update public.stock_request_lines set done_at = now()
     where request_id = p_request and id = any(p_lines) and done_at is null
    returning category, brand, position
  )
  select string_agg(category || coalesce(' · ' || brand, ''), ', ' order by position) into names from done;
  if names is null then raise exception 'Choose what was sent'; end if;

  select count(*) into left_ from public.stock_request_lines where request_id = p_request and done_at is null;
  if left_ = 0 then
    update public.stock_requests set status = 'completed', updated_at = now() where id = p_request returning * into r;
    insert into public.stock_request_events (request_id, by_code, text)
    values (p_request, public.jwt_branch(), format('Sent: %s — request completed', names));
  else
    update public.stock_requests set updated_at = now() where id = p_request returning * into r;
    insert into public.stock_request_events (request_id, by_code, text)
    values (p_request, public.jwt_branch(), format('Sent: %s — %s still to come', names, left_));
  end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.schedule_view()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(w.published order by w.week_start), '[]'::jsonb)
    from public.schedule_weeks w
   where w.published is not null
     and w.week_start > (now() at time zone 'Asia/Muscat')::date - 7
     and (public.has_perm('lists') or not (public.disabled_tabs() ? 'schedule'))
$function$;

CREATE OR REPLACE FUNCTION public.add_branch(p_code text, p_name text, p_role text, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  v_code  text := upper(trim(coalesce(p_code, '')));
  nm    text := trim(coalesce(p_name, ''));
  v_email text;
  uid   uuid := gen_random_uuid();
  src   auth.users;
begin
  if not public.has_perm('accounts') then
    raise exception 'Only the office may add branches';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9]{1,9}$' then
    raise exception 'The code is 2 to 10 letters or digits, starting with a letter';
  end if;
  if nm = '' then
    raise exception 'Give it a name';
  end if;
  -- A person is one kind now: what it may do is its permissions (schema-50).
  if p_role in ('manager', 'scheduler', 'admin') then p_role := 'person'; end if;
  if p_role not in ('retail', 'fitting', 'clinic', 'person') then
    raise exception 'Unknown kind of account %', p_role;
  end if;
  if exists (select 1 from public.branches b where b.code = v_code) then
    raise exception 'There is already a profile %', v_code;
  end if;
  perform public.assert_good_pin(p_pin);

  v_email := lower(v_code) || '@finlandoptical.om';
  if exists (select 1 from auth.users u where u.email = v_email) then
    raise exception 'A sign-in account % already exists', v_email;
  end if;

  -- A new person starts able to look, not to change: the office ticks more.
  insert into public.branches (code, name, role, holds_lens_stock, active, position, perms)
  values (v_code, nm, p_role, false, true,
          coalesce((select max(position) from public.branches), 0) + 1,
          case when p_role = 'person' then array['see_all', 'view_only'] else '{}'::text[] end);

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
end $function$;

CREATE OR REPLACE FUNCTION public.save_branch(p_code text, p_name text, p_role text, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  b  public.branches;
  nm text := trim(coalesce(p_name, ''));
begin
  if not public.has_perm('accounts') then
    raise exception 'Only the office may change branches';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then
    raise exception 'No branch %', p_code;
  end if;
  if nm = '' then
    raise exception 'Give it a name';
  end if;
  -- Every account is a branch (retail / fitting / clinic) or a person (view-
  -- only admin, schedule editor, office admin), and can be switched - as long
  -- as one open office admin is left (schema-41).
  if p_role in ('manager', 'scheduler', 'admin') then p_role := 'person'; end if;
  if p_role not in ('retail', 'fitting', 'clinic', 'person') then
    raise exception 'Unknown kind of account %', p_role;
  end if;
  -- Never close the last account that can manage the accounts (schema-50).
  if not p_active and public.manages_accounts(b) and not exists (
       select 1 from public.branches o where o.code <> p_code and o.active and public.manages_accounts(o)) then
    raise exception '% is the last account that can manage accounts - give that to another first', b.name;
  end if;
  if b.holds_lens_stock and (p_role <> 'fitting' or not p_active) then
    raise exception '% holds the lens stock, so it has to stay an open fitting centre', b.name;
  end if;

  update public.branches set name = nm, role = p_role, active = p_active,
         -- only a fitting centre has a lab
         bench_closed = case when p_role = 'fitting' then bench_closed else false end,
         bench_closed_until = case when p_role = 'fitting' then bench_closed_until else null end,
         bench_own_only = case when p_role = 'fitting' then bench_own_only else false end
   where code = p_code;

  update auth.users
     set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('branch_role', p_role),
         banned_until = case when p_active then null else now() + interval '100 years' end,
         updated_at = now()
   where (raw_app_meta_data ->> 'branch_code') = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_branch(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  b    public.branches;
  used text[] := '{}';
  n    int;
begin
  if not public.has_perm('accounts') then
    raise exception 'Only the office may delete branches';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  -- Any account can go (schema-41) - but never the last office admin, and
  -- never the account doing the deleting.
  if p_code = public.jwt_branch() then
    raise exception 'You cannot delete the account you are signed in with';
  end if;
  if public.manages_accounts(b) and not exists (
       select 1 from public.branches o where o.code <> p_code and o.active and public.manages_accounts(o)) then
    raise exception '% is the last account that can manage accounts', b.name;
  end if;
  if b.holds_lens_stock then
    raise exception '% holds lens stock - stop that first', b.name;
  end if;

  select count(*) into n from public.orders where origin_code = p_code or fitter_code = p_code;
  if n > 0 then used := used || format('%s fitting order%s', n, case when n = 1 then '' else 's' end); end if;
  select count(*) into n from public.stock_requests where branch_code = p_code;
  if n > 0 then used := used || format('%s stock request%s', n, case when n = 1 then '' else 's' end); end if;
  select count(*) into n from public.lens_requests where branch_code = p_code or holder_code = p_code;
  if n > 0 then used := used || format('%s lens request%s', n, case when n = 1 then '' else 's' end); end if;
  select count(*) into n from public.claims where branch_code = p_code or created_by = p_code;
  if n > 0 then used := used || format('%s claim%s', n, case when n = 1 then '' else 's' end); end if;
  select (select count(*) from public.order_events where by_code = p_code)
       + (select count(*) from public.stock_request_events where by_code = p_code)
       + (select count(*) from public.lens_request_events where by_code = p_code) into n;
  if n > 0 then used := used || format('%s timeline entr%s', n, case when n = 1 then 'y' else 'ies' end); end if;

  if array_length(used, 1) is not null then
    raise exception '% has records (%) - close it instead, which keeps them', b.name, array_to_string(used, ', ');
  end if;

  delete from public.lens_stock where holder_code = p_code;   -- an emptied shelf, if it ever had one
  delete from auth.identities where user_id in
    (select id from auth.users where (raw_app_meta_data ->> 'branch_code') = p_code);
  delete from auth.users where (raw_app_meta_data ->> 'branch_code') = p_code;
  delete from public.branches where code = p_code;
end $function$;

-- Omar, as a person of his own (OFC is the Office). A random code nobody sees.
do $$
declare pin text;
begin
  if not exists (select 1 from public.branches where code = 'OMAR') then
    perform set_config('request.jwt.claims', '{"role": "authenticated", "app_metadata": {"branch_code": "OFC"}}', true);
    loop
      pin := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');
      begin
        perform public.add_branch('OMAR', 'Omar', 'person', pin);
        exit;
      exception when others then
        if sqlerrm ilike '%code%' or sqlerrm ilike '%pin%' then continue; end if;
        raise;
      end;
    end loop;
    perform set_config('request.jwt.claims', '', true);
  end if;
  update public.branches set perms = array['see_all', 'act_all', 'office_queue', 'accounts', 'lists', 'insurance_dash', 'export_insurance', 'schedule_edit']
   where code = 'OMAR';
end $$;
-- Office first, then its people: Omar, Ghiath, Sarah, Mohammad Azmi, Wijdan.
update public.branches b set position = v.p
  from (values ('OFC', 100), ('OMAR', 101), ('GHIATH', 102), ('SARAH', 103), ('AZMI', 104), ('WIJDAN', 105)) v(code, p)
 where b.code = v.code;

commit;
