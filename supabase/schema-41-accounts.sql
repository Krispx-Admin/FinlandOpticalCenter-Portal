-- ════════════════════════════════════════════════════════════════════════════
--  41 · Accounts: a branch can become a person, and back
--  STATUS: applied 2026-10-17 (by Claude)
--
--  The user (2026-10-17): Settings → Accounts — every account has the same
--  choices: a branch (retail / fitting / clinic) or a person (view-only
--  admin 'manager', schedule editor, office admin), switchable on any row,
--  addable, closable and deletable — except that one open office admin must
--  always remain, and you cannot delete the account you are signed in with.
--  A branch holding lens stock stays a fitting centre (unchanged); the lab
--  settings only stay on a fitting centre. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

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
  -- Every account is a branch (retail / fitting / clinic) or a person (view-
  -- only admin, schedule editor, office admin), and can be switched - as long
  -- as one open office admin is left (schema-41).
  if p_role not in ('retail', 'fitting', 'clinic', 'manager', 'scheduler', 'admin') then
    raise exception 'Unknown kind of account %', p_role;
  end if;
  if b.role = 'admin' and (p_role <> 'admin' or not p_active)
     and not exists (select 1 from public.branches where role = 'admin' and active and code <> p_code) then
    raise exception '% is the last office admin - make another account office admin first', b.name;
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
end $$;

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
  if p_role not in ('retail', 'fitting', 'clinic', 'manager', 'scheduler', 'admin') then
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
  if not public.is_admin() then
    raise exception 'Only the office may delete branches';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  -- Any account can go (schema-41) - but never the last office admin, and
  -- never the account doing the deleting.
  if p_code = public.jwt_branch() then
    raise exception 'You cannot delete the account you are signed in with';
  end if;
  if b.role = 'admin' and not exists (select 1 from public.branches where role = 'admin' and active and code <> p_code) then
    raise exception '% is the last office admin', b.name;
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

commit;
