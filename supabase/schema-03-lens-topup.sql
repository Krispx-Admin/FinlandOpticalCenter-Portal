-- ============================================================================
--  FOC Portal — migration 03: topping up the lens shelf, atomically
-- ============================================================================
--  Adding stock for a spec that is already on the shelf must ADD to the count,
--  not create a second row — lens_stock has a unique constraint on the spec,
--  so the browser's old "look it up, then update or insert" would either fail
--  or double-count when MGM has the shelf open in two tabs. One statement with
--  ON CONFLICT settles it in the database.
-- ============================================================================

create or replace function public.add_lens_stock(
  p_type    text,
  p_index   text,
  p_coating text,
  p_sph     numeric,
  p_cyl     numeric,
  p_qty     int
) returns public.lens_stock
  language plpgsql security definer set search_path = public as $$
declare
  added int := greatest(coalesce(p_qty, 0), 0);
  out   public.lens_stock;
begin
  if not (public.is_lens_owner() or public.is_admin()) then
    raise exception 'only the lens-holding branch may change the shelf';
  end if;

  insert into public.lens_stock (lens_type, lens_index, coating, sph, cyl, qty)
  values (p_type, p_index, coalesce(nullif(p_coating, ''), 'None'), p_sph, coalesce(p_cyl, 0), added)
  on conflict (lens_type, lens_index, coating, sph, cyl)
    do update set qty = lens_stock.qty + added, updated_at = now()
  returning * into out;

  return out;
end $$;

revoke all on function public.add_lens_stock(text, text, text, numeric, numeric, int) from public;
grant execute on function public.add_lens_stock(text, text, text, numeric, numeric, int) to authenticated;
