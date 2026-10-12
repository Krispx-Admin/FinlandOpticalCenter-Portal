-- ════════════════════════════════════════════════════════════════════════════
--  19 · Branches are edited in Settings, not in the code
--  STATUS: applied 2026-10-12 (by Claude)
--
--  The portal's list of locations now comes from public.branches (the app
--  keeps its old built-in list only as a fallback). The office, in Settings ›
--  Branches, can:
--    · add a branch — add_branch() makes the row AND its sign-in account
--      (<code>@finlandoptical.om, shaped exactly like the existing ones; see
--      schema-10 for the same recipe), with the 6-digit code it signs in with;
--    · rename a branch, change what it is (retail / fitting / clinic — e.g. a
--      shop that gets a cutting machine becomes a fitting centre), or close and
--      reopen it — save_branch(). The server's own rules (is_admin, RLS, …)
--      already read the role from this table, so a change takes effect at once.
--  Closing keeps every record (orders, claims … point at the branch), hides it
--  from the sign-in screen and the pickers, and blocks its sign-in
--  (auth.users.banned_until). The office and Ghiath keep their roles and
--  cannot be closed; the branch holding the lens stock must stay an open
--  fitting centre.
--  Also: branches gain `active` and `position` (display order); the sign-in
--  screen may read the list before signing in (anon read policy); branches is
--  on realtime so every open portal picks up a change. set_branch_code shares
--  the "is this code too easy" check with add_branch. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches add column if not exists active   boolean not null default true;
alter table public.branches add column if not exists position integer not null default 0;

-- The order they have always been shown in.
update public.branches b set position = o.n
  from (values ('SCC',1),('AV',2),('QCC',3),('SAL',4),('SUR',5),('MOUJ',6),('MOO',7),('MGM',8),
               ('QURFEC',9),('SALFEC',10),('SOHFEC',11),('NIZFEC',12),('OFC',13),('GHIATH',14)) as o(code, n)
 where b.code = o.code and b.position = 0;

-- The sign-in screen lists the locations before anyone has signed in. Codes,
-- names and kinds of shop are what that screen has always shown.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'branches' and policyname = 'branches_read_anon') then
    create policy branches_read_anon on public.branches for select to anon using (true);
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'branches') then
    alter publication supabase_realtime add table public.branches;
  end if;
end $$;

-- ── the one check for a sign-in code ──
create or replace function public.assert_good_pin(p_code text) returns void
  language plpgsql immutable as $$
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    raise exception 'The code must be exactly 6 digits';
  end if;
  -- The handful of codes an attacker would try first.
  if p_code in ('000000','111111','222222','333333','444444','555555',
                '666666','777777','888888','999999','123456','654321',
                '012345','121212','112233')
     or length(regexp_replace(p_code, '(.)\1*', '\1', 'g')) < 3 then
    raise exception 'That code is too easy to guess — choose another';
  end if;
end $$;

create or replace function public.set_branch_code(p_branch text, p_code text) returns void
  language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  n int;
begin
  if not public.is_admin() then
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
end $$;

-- ── add a branch and its sign-in account ──
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
    raise exception 'The branch code is 2 to 10 letters or digits, starting with a letter';
  end if;
  if nm = '' then
    raise exception 'Give the branch a name';
  end if;
  if p_role not in ('retail', 'fitting', 'clinic') then
    raise exception 'A branch is a retail shop, a fitting centre or a clinic';
  end if;
  if exists (select 1 from public.branches b where b.code = v_code) then
    raise exception 'There is already a branch %', v_code;
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

-- ── rename, change what it is, close or reopen ──
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
    raise exception 'Give the branch a name';
  end if;
  if b.role in ('admin', 'scheduler') then
    if p_role is distinct from b.role or not p_active then
      raise exception '% keeps its role and cannot be closed', b.name;
    end if;
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

-- ── what Settings › Branches lists ──
drop function if exists public.branch_access();
create function public.branch_access()
  returns table(code text, name text, role text, active boolean, "position" integer,
                holds_lens_stock boolean, has_account boolean, last_sign_in timestamptz)
  language sql security definer set search_path = public, auth as $$
  select b.code, b.name, b.role, b.active, b.position, b.holds_lens_stock,
         u.id is not null as has_account,
         u.last_sign_in_at
    from public.branches b
    left join auth.users u on (u.raw_app_meta_data ->> 'branch_code') = b.code
   where public.is_admin()
   order by b.position, b.code
$$;

revoke all on function public.add_branch(text, text, text, text)       from public, anon;
revoke all on function public.save_branch(text, text, text, boolean)   from public, anon;
revoke all on function public.branch_access()                          from public, anon;
grant execute on function public.add_branch(text, text, text, text)     to authenticated;
grant execute on function public.save_branch(text, text, text, boolean) to authenticated;
grant execute on function public.branch_access()                        to authenticated;

commit;
