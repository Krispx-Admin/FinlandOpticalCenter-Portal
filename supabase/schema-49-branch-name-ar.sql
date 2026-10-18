-- ════════════════════════════════════════════════════════════════════════════
--  49 · Each branch's name in Arabic
--  STATUS: applied 2026-10-18 (by Claude)
--
--  The user (2026-10-18): the Arabic half of the WhatsApp message should name
--  the branch in Arabic. branches.name_ar holds it; the office edits it in
--  Settings → Accounts (set_branch_name_ar). Filled in for the branches there
--  are today — only where it is still empty, so an edit is never overwritten.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.branches add column if not exists name_ar text;

update public.branches b set name_ar = v.ar
  from (values
    ('SCC', 'سيتي سنتر السيب'), ('AV', 'أفنيوز مول'), ('QCC', 'سيتي سنتر القرم'), ('SUR', 'صور'),
    ('SAL', 'صلالة'), ('MOUJ', 'الموج'), ('MOO', 'مول عُمان'), ('MGM', 'مسقط جراند مول'),
    ('QURFEC', 'عيادة القرم'), ('SALFEC', 'عيادة صلالة'), ('SOHFEC', 'عيادة صحار'), ('NIZFEC', 'عيادة نزوى')
  ) as v(code, ar)
 where b.code = v.code and b.name_ar is null;

create or replace function public.set_branch_name_ar(p_code text, p_name text)
 returns void
 language plpgsql security definer
 set search_path to 'public'
as $$
begin
  if not public.is_admin() then raise exception 'Only the office can rename a branch'; end if;
  update public.branches set name_ar = nullif(btrim(p_name), '') where code = p_code;
  if not found then raise exception 'No such branch'; end if;
end $$;
revoke all on function public.set_branch_name_ar(text, text) from public, anon;
grant execute on function public.set_branch_name_ar(text, text) to authenticated;

commit;
