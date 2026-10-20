-- ════════════════════════════════════════════════════════════════════════════
--  53 · Which sidebar tabs each account sees
--  STATUS: applied 2026-10-20 (by Claude)
--
--  The user (2026-10-20): a Data tab for the office and its people, and "I
--  should be able to select which tabs show for which branches and people" —
--  every sidebar tab. branches.tabs_hidden lists the tabs an account does not
--  see; a tick can only hide a tab, never open one the account may not use
--  (Lens Stock, Outside Lens Orders and Settings keep their own rules). Data
--  starts hidden for every branch — those there now, and any added later
--  (trigger). Set in Settings → Accounts by 'accounts' (set_tabs_hidden).
--  It shapes the sidebar; what each account may read is still the row rules.
--  The sign-in screen (anon) cannot read it. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches add column if not exists tabs_hidden text[] not null default '{}';

-- Data: hidden for the branches, from the start.
update public.branches
   set tabs_hidden = array_append(tabs_hidden, 'data')
 where role in ('retail', 'fitting', 'clinic') and not ('data' = any(tabs_hidden));

create or replace function public.branches_hide_data()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  if new.role in ('retail', 'fitting', 'clinic') and not ('data' = any(coalesce(new.tabs_hidden, '{}'))) then
    new.tabs_hidden := array_append(coalesce(new.tabs_hidden, '{}'), 'data');
  end if;
  return new;
end $$;
drop trigger if exists branches_hide_data on public.branches;
create trigger branches_hide_data before insert on public.branches
  for each row execute function public.branches_hide_data();

create or replace function public.set_tabs_hidden(p_code text, p_tabs text[])
 returns void
 language plpgsql security definer
 set search_path to 'public'
as $$
begin
  if not public.has_perm('accounts') then raise exception 'Only the office can choose the tabs'; end if;
  update public.branches
     set tabs_hidden = coalesce((select array_agg(distinct t order by t) from unnest(p_tabs) t
                                  where t in ('fitting', 'stock', 'lens', 'outside', 'claims', 'direct', 'damaged', 'schedule', 'data')), '{}')
   where code = p_code;
  if not found then raise exception 'No such account'; end if;
end $$;
revoke all on function public.set_tabs_hidden(text, text[]) from public, anon;
grant execute on function public.set_tabs_hidden(text, text[]) to authenticated;

commit;
