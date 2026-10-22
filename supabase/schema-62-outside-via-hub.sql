-- ════════════════════════════════════════════════════════════════════════════
--  62 · Outside cutting through a hub (MGM)
--  STATUS: applied 2026-10-22 (by Claude)
--
--  The user (2026-10-22), to try in the Admin Demo first: a frame for an
--  outside cutter goes branch → MGM; MGM picks the cutter and sends it out,
--  receives it back, and sends it to the branch. The hub is a setting
--  (app_settings.outside_cut_hub, MGM to start).
--  On the order: fitter_code = the hub, outside_hub = true; outside_cutter is
--  filled when the hub sends it out (outside_out_at), outside_back_at when it
--  comes back — the order is "at_fitter" all that time, then "ready" at the
--  hub and on the usual road to the branch.
--  orders_route_gate: "ready" puts the frame at the branch only for a frame
--  sent out directly (no fitter); through the hub it is at the hub.
--  Direct outside cutting (no fitter) is unchanged. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.app_settings add column if not exists outside_cut_hub text;
update public.app_settings set outside_cut_hub = 'MGM' where id = 1 and outside_cut_hub is null;

alter table public.orders add column if not exists outside_hub boolean not null default false;
alter table public.orders add column if not exists outside_out_at timestamptz;
alter table public.orders add column if not exists outside_back_at timestamptz;

create or replace function public.orders_route_gate()
 returns trigger
 language plpgsql security definer
 set search_path to 'public'
as $function$
declare
  c text := coalesce(new.collect_code, new.origin_code);
  x text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if current_setting('foc.undo', true) = '1' or current_setting('foc.route', true) = '1' then return new; end if;

  if new.status = 'ready' and old.status in ('at_fitter', 'to_fitter') then
    -- Ready at the fitter (or, sent out directly to a cutter, back at the branch;
    -- through the hub it is at the hub — schema-62).
    new.frame_at := case when new.outside_cutter is not null and new.fitter_code is null then new.origin_code else new.fitter_code end;
    if new.frame_at = c then new.status := 'delivered'; end if;          -- collected right here
  elsif new.status = 'delivered' and old.status = 'at_fitter' and c <> new.fitter_code then
    new.status := 'ready'; new.frame_at := new.fitter_code;             -- in-house job collected elsewhere
  elsif new.status = 'delivered' and old.status = 'to_fitter' and new.outside_cutter is not null and c <> new.origin_code then
    new.status := 'ready'; new.frame_at := new.origin_code;             -- back from the cutter, collected elsewhere
  elsif new.status = 'returning' and old.status = 'ready' then
    new.to_code := c;
  elsif new.status = 'delivered' and old.status = 'returning' then
    x := coalesce(new.to_code, c);
    new.to_code := null;
    new.frame_at := x;
    if x <> c then                                                      -- the customer moved it meanwhile: transfer from here
      new.status := 'ready';
      new.stops := new.stops || x;
    end if;
  end if;
  return new;
end $function$;

commit;
