-- ════════════════════════════════════════════════════════════════════════════
--  47 · Direct Insurance: cancel instead of delete
--  STATUS: applied 2026-10-18 (by Claude)
--
--  The user (2026-10-18): "Cancel instead of delete so it doesn't delete from
--  the system, it just gets canceled, and shows that it's been canceled but
--  can still be exported". A Direct Insurance record is never deleted now:
--  cancel_claim() stamps it canceled (when, by whom) — or takes the cancel
--  back. The Reimbursement Invoice can still be deleted as before.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.claims add column if not exists canceled_at timestamptz;
alter table public.claims add column if not exists canceled_by text;

-- Deleting: the Reimbursement Invoice only.
drop policy if exists claims_delete on public.claims;
create policy claims_delete on public.claims for delete to authenticated
  using (((branch_code = (select public.jwt_branch())) or (select public.is_admin())) and kind <> 'direct');

-- Cancel (or take the cancel back): the branch that raised it, or the office.
create or replace function public.cancel_claim(p_id uuid, p_cancel boolean)
 returns public.claims
 language plpgsql security definer
 set search_path to 'public'
as $$
declare
  c  public.claims;
  me text := public.jwt_branch();
begin
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception 'Record not found'; end if;
  if not (c.branch_code = me or public.is_admin()) then
    raise exception 'Only the branch that raised it, or the office, can cancel it';
  end if;
  if c.kind <> 'direct' then raise exception 'Only Direct Insurance records are canceled — delete an invoice instead'; end if;
  update public.claims
     set canceled_at = case when p_cancel then coalesce(canceled_at, now()) end,
         canceled_by = case when p_cancel then coalesce(canceled_by, me) end,
         updated_at = now()
   where id = p_id
   returning * into c;
  return c;
end $$;
revoke all on function public.cancel_claim(uuid, boolean) from public, anon;
grant execute on function public.cancel_claim(uuid, boolean) to authenticated;

commit;
