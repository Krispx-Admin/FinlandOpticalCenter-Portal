-- ════════════════════════════════════════════════════════════════════════════
--  51 · The outside-lens supplier's WhatsApp number
--  STATUS: applied 2026-10-19 (by Claude)
--
--  The user (2026-10-19): Outside Lens Orders keeps the supplier's phone
--  number, so the handler (Avenues) picks orders and presses WhatsApp — the
--  supplier's chat opens with them typed — instead of copying and pasting.
--  Copy for WhatsApp stays. Set by the handler or anyone allowed to edit the
--  lists (app_settings itself is lists-only, so it goes through a function).
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.app_settings add column if not exists outside_supplier_name text;
alter table public.app_settings add column if not exists outside_supplier_phone text;

create or replace function public.set_outside_supplier(p_name text, p_phone text)
 returns void
 language plpgsql security definer
 set search_path to 'public'
as $$
declare
  ph text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  if not (public.jwt_branch() = public.outside_lens_handler() or public.has_perm('lists')) then
    raise exception 'Only % (or the office) can set the supplier', public.outside_lens_handler();
  end if;
  if ph is not null and length(ph) not between 8 and 15 then
    raise exception 'That phone number does not look right';
  end if;
  update public.app_settings
     set outside_supplier_name = nullif(btrim(coalesce(p_name, '')), ''),
         outside_supplier_phone = ph
   where id = 1;
end $$;
revoke all on function public.set_outside_supplier(text, text) from public, anon;
grant execute on function public.set_outside_supplier(text, text) to authenticated;

commit;
