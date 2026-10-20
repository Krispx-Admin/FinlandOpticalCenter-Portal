-- ════════════════════════════════════════════════════════════════════════════
--  57 · A tab can be given, not only hidden
--  STATUS: applied 2026-10-20 (by Claude)
--
--  The user (2026-10-20): the "Tabs it sees" ticks showed Lens Stock and
--  Outside Lens Orders ticked for every branch though they cannot see them,
--  and the office wants to be able to switch them on for a branch later.
--  branches.tabs_shown lists the tabs given to an account on top of what it
--  sees by itself (Lens Stock: lens-stock holders; Outside Lens Orders: the
--  handler; both: anyone who sees every branch). tabs_hidden still hides.
--  set_tabs(code, hidden, shown) saves both ('accounts'). It shapes the
--  sidebar only: what an account may read and do is still the row rules and
--  its permissions. The sign-in screen (anon) cannot read it. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches add column if not exists tabs_shown text[] not null default '{}';

create or replace function public.set_tabs(p_code text, p_hidden text[], p_shown text[])
 returns void
 language plpgsql security definer
 set search_path to 'public'
as $$
declare
  ok text[] := array['fitting', 'stock', 'lens', 'outside', 'claims', 'direct', 'damaged', 'schedule', 'data'];
begin
  if not public.has_perm('accounts') then raise exception 'Only the office can choose the tabs'; end if;
  update public.branches
     set tabs_hidden = coalesce((select array_agg(distinct t order by t) from unnest(p_hidden) t where t = any(ok)), '{}'),
         tabs_shown  = coalesce((select array_agg(distinct t order by t) from unnest(p_shown) t where t = any(ok)
                                   and not (t = any(coalesce(p_hidden, '{}')))), '{}')
   where code = p_code;
  if not found then raise exception 'No such account'; end if;
end $$;
revoke all on function public.set_tabs(text, text[], text[]) from public, anon;
grant execute on function public.set_tabs(text, text[], text[]) to authenticated;

commit;
