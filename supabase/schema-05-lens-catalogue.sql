-- ════════════════════════════════════════════════════════════════════════════
--  05 · The lens catalogue: which types, indices and coatings exist
--  STATUS: applied
--
--  The three lists were hard-coded in data.js, so stocking a 1.80 index meant
--  a developer and a deploy. They are the lens-holding branch's own vocabulary,
--  so that branch owns them — the same hand that owns the shelf count.
--
--  Held as JSON for the same reason app_settings is: three short ordered lists
--  edited whole, never queried a value at a time.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.lens_catalogue (
  id         int primary key default 1 check (id = 1),
  types      jsonb not null default '[]'::jsonb,
  indices    jsonb not null default '[]'::jsonb,
  coatings   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists lens_catalogue_touch on public.lens_catalogue;
create trigger lens_catalogue_touch before update on public.lens_catalogue
  for each row execute function public.touch_updated_at();

-- Left empty on purpose: the app falls back to the defaults in data.js, so
-- they have one definition instead of two that can drift apart.
insert into public.lens_catalogue (id) values (1) on conflict (id) do nothing;

alter table public.lens_catalogue enable row level security;

-- Every branch reads the lists to shop the shelf; only the branch holding the
-- lenses — or the warehouse — decides what may go on it.
drop policy if exists lens_catalogue_read on public.lens_catalogue;
create policy lens_catalogue_read on public.lens_catalogue
  for select to authenticated using (true);

drop policy if exists lens_catalogue_write on public.lens_catalogue;
create policy lens_catalogue_write on public.lens_catalogue
  for all to authenticated
  using (public.is_lens_owner() or public.is_admin())
  with check (public.is_lens_owner() or public.is_admin());

-- The shelf used to name the three types itself, which would refuse the first
-- new one added above. The catalogue is the list now.
alter table public.lens_stock drop constraint if exists lens_stock_lens_type_check;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'lens_catalogue') then
    alter publication supabase_realtime add table public.lens_catalogue;
  end if;
end $$;
