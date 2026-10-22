-- ════════════════════════════════════════════════════════════════════════════
--  60 · Bill numbers: the branch's prefix, and whether a bill is used already
--  STATUS: applied 2026-10-22 (by Claude)
--
--  The user (2026-10-22): the portal puts the branch's letters in front of a
--  bill by itself (SEEB, MGM, MOUJ, SAL, SALFEC…) and staff type the number
--  only; a bill already used cannot be used again — once in the Fitting Log
--  (several pairs on one bill are "(1/3)", "(2/3)", "(3/3)"), once in Direct
--  Insurance, once in Reimbursement Invoice. Tried in the Admin Demo first.
--  branches.bill_prefix: empty = the account's code (Seeb City Centre: SEEB).
--  bills_used(kind, base): the bills already there that start with it, across
--  every branch (the check needs the old ones too, not only those on screen).
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches add column if not exists bill_prefix text;
update public.branches set bill_prefix = 'SEEB' where code = 'SCC' and bill_prefix is null;

create or replace function public.set_bill_prefix(p_code text, p_prefix text)
 returns void
 language plpgsql security definer
 set search_path to 'public'
as $$
declare px text := upper(btrim(coalesce(p_prefix, '')));
begin
  if not public.has_perm('accounts') then raise exception 'Only the office can set the bill letters'; end if;
  if px <> '' and px !~ '^[A-Z]{1,8}$' then raise exception 'The bill letters are 1 to 8 letters, A to Z'; end if;
  update public.branches set bill_prefix = nullif(px, '') where code = p_code;
  if not found then raise exception 'No such account'; end if;
end $$;
revoke all on function public.set_bill_prefix(text, text) from public, anon;
grant execute on function public.set_bill_prefix(text, text) to authenticated;

-- kind: 'order' (the Fitting Log), 'direct' or 'claim'. base: e.g. 'SEEB 10020'.
create or replace function public.bills_used(p_kind text, p_base text)
 returns setof text
 language sql stable security definer
 set search_path to 'public'
as $$
  select ref from public.orders
   where p_kind = 'order' and (ref = p_base or ref like p_base || ' (%')
  union all
  select bill_no from public.claims
   where p_kind in ('direct', 'claim') and coalesce(kind, 'claim') = p_kind and bill_no = p_base
$$;
revoke all on function public.bills_used(text, text) from public, anon;
grant execute on function public.bills_used(text, text) to authenticated;

commit;
