-- ════════════════════════════════════════════════════════════════════════════
--  52 · Data usage: how full the database is, and how fast it grows
--  STATUS: applied 2026-10-20 (by Claude)
--
--  The user (2026-10-20): the office sees in Settings how much of the Pro
--  plan's 8 GB is used, and watches it grow. storage_usage_log keeps one
--  reading a day — taken every night by pg_cron, and on opening the page —
--  so the growth shows even if nobody looks for a month. storage_usage()
--  (accounts permission) returns today's sizes, per table, a few counts and
--  the readings. Nobody reads the log table directly. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.storage_usage_log (
  day        date primary key,
  db_bytes   bigint not null,     -- the whole database (pg_database_size)
  data_bytes bigint not null      -- the portal's own tables (public schema)
);
alter table public.storage_usage_log enable row level security;
revoke all on public.storage_usage_log from anon, authenticated;

-- Today's reading (Oman date); run by the nightly job and by storage_usage().
create or replace function public.record_storage_usage()
 returns void
 language sql security definer
 set search_path to 'public'
as $$
  insert into public.storage_usage_log (day, db_bytes, data_bytes)
  select (now() at time zone 'Asia/Muscat')::date,
         pg_database_size(current_database()),
         coalesce(sum(pg_total_relation_size(c.oid)), 0)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'm')
  on conflict (day) do update set db_bytes = excluded.db_bytes, data_bytes = excluded.data_bytes;
$$;
revoke all on function public.record_storage_usage() from public, anon, authenticated;

create or replace function public.storage_usage()
 returns jsonb
 language plpgsql security definer
 set search_path to 'public'
as $$
begin
  if not public.has_perm('accounts') then raise exception 'Only the office can see the data usage'; end if;
  perform public.record_storage_usage();
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'limit_bytes', 8::bigint * 1024 * 1024 * 1024,
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('t', c.relname, 'bytes', pg_total_relation_size(c.oid))), '[]'::jsonb)
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r', 'm')),
    'counts', jsonb_build_object(
      'orders', (select count(*) from public.orders),
      'claims', (select count(*) from public.claims),
      'stock_requests', (select count(*) from public.stock_requests),
      'lens_requests', (select count(*) from public.lens_requests),
      'outside', (select count(*) from public.outside_lens_orders),
      'damaged', (select count(*) from public.damaged_reports)),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'db', db_bytes, 'data', data_bytes) order by day), '[]'::jsonb)
                  from public.storage_usage_log where day > current_date - 400));
end $$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;

-- Every night at 23:50 Oman time (19:50 UTC).
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'storage-usage-daily';
select cron.schedule('storage-usage-daily', '50 19 * * *', 'select public.record_storage_usage()');

select public.record_storage_usage();

commit;
