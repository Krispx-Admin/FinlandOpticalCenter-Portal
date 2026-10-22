-- ════════════════════════════════════════════════════════════════════════════
--  64 · Tablet Mode is allowed per account
--  STATUS: applied 2026-10-22 (by Claude)
--
--  The user (2026-10-22): Tablet Mode not for everyone — Muscat Grand Mall for
--  now — and a switch in the account settings to allow it. A new tick,
--  'tablet', kept with the permissions (Settings → Accounts → an account →
--  "Tablet mode"). Without it there is no Tablet mode button and the mode
--  stays off on that account's devices. Given to MGM. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches drop constraint if exists branches_perms_check;
alter table public.branches add constraint branches_perms_check check (perms <@ array['see_all', 'act_all', 'office_queue', 'accounts', 'lists', 'insurance_dash', 'export_insurance', 'schedule_edit', 'view_only', 'demo', 'tablet']::text[]);

CREATE OR REPLACE FUNCTION public.set_permissions(p_code text, p_perms text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.branches; nxt text[];
begin
  if not public.has_perm('accounts') then raise exception 'Only an account that manages accounts can change permissions'; end if;
  select * into b from public.branches where code = p_code for update;
  if not found then raise exception 'No account %', p_code; end if;
  nxt := array(select distinct unnest(coalesce(p_perms, '{}')) order by 1);
  if not (nxt <@ array['see_all', 'act_all', 'office_queue', 'accounts', 'lists', 'insurance_dash', 'export_insurance', 'schedule_edit', 'view_only', 'demo', 'tablet']::text[]) then
    raise exception 'Unknown permission in %', p_perms;
  end if;
  if public.manages_accounts(b) and not ('accounts' = any(nxt) and not 'view_only' = any(nxt))
     and not exists (select 1 from public.branches o where o.code <> p_code and o.active and public.manages_accounts(o)) then
    raise exception '% is the last account that can manage accounts - give that to another first', b.name;
  end if;
  update public.branches set perms = nxt where code = p_code;
end $function$;

update public.branches set perms = array(select distinct unnest(perms || array['tablet']) order by 1)
 where code = 'MGM' and not ('tablet' = any(perms));

commit;
