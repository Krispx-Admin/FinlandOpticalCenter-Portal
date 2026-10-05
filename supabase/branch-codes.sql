-- ============================================================================
--  Letting the warehouse set each branch's 6-digit sign-in code
-- ============================================================================
--  Changing another account's password normally needs the service_role key,
--  which bypasses every security rule and so must never reach the browser.
--  Instead this is a SECURITY DEFINER function: it runs with the privileges it
--  needs, but its first act is to check the caller is the warehouse. The
--  browser only ever holds the anon key and its own session.
--
--  Passwords are written as bcrypt, matching what Supabase Auth already
--  stores ($2a$, 60 chars), so sign-in works unchanged afterwards.
-- ============================================================================

create or replace function public.set_branch_code(p_branch text, p_code text)
  returns void
  language plpgsql
  security definer
  set search_path = public, auth, extensions
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'Only the warehouse may change branch codes';
  end if;

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

  update auth.users
     set encrypted_password = extensions.crypt(p_code, extensions.gen_salt('bf')),
         updated_at = now()
   where (raw_app_meta_data ->> 'branch_code') = p_branch;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'No sign-in account exists for branch %', p_branch;
  end if;
end $$;

revoke all on function public.set_branch_code(text, text) from public, anon;
grant execute on function public.set_branch_code(text, text) to authenticated;

comment on function public.set_branch_code is
  'Warehouse-only: sets a branch''s 6-digit sign-in code. Rejects weak codes.';

-- ── Which branches can actually sign in ─────────────────────────────────────
-- Lets the Settings screen show account status without exposing auth.users.
create or replace function public.branch_access()
  returns table (code text, name text, role text, has_account boolean, last_sign_in timestamptz)
  language sql
  security definer
  set search_path = public, auth
as $$
  select b.code, b.name, b.role,
         u.id is not null as has_account,
         u.last_sign_in_at
    from public.branches b
    left join auth.users u on (u.raw_app_meta_data ->> 'branch_code') = b.code
   where public.is_admin()
   order by b.role desc, b.code
$$;

revoke all on function public.branch_access() from public, anon;
grant execute on function public.branch_access() to authenticated;
