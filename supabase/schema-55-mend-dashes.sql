-- ════════════════════════════════════════════════════════════════════════════
--  55 · Mend the garbled dashes in four functions' messages
--  STATUS: applied 2026-10-20 (by Claude)
--
--  Found 2026-10-20: an earlier apply read the migration in the wrong text
--  encoding, so the dash was stored garbled (three odd characters) inside
--  these functions' messages, e.g. "That code is too easy to guess — choose
--  another". Same functions, the dash put right. Migrations are now applied
--  as UTF-8. Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

CREATE OR REPLACE FUNCTION public.assert_good_pin(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    raise exception 'The code must be exactly 6 digits';
  end if;
  -- The handful of codes an attacker would try first.
  if p_code in ('000000','111111','222222','333333','444444','555555',
                '666666','777777','888888','999999','123456','654321',
                '012345','121212','112233')
     or length(regexp_replace(p_code, '(.)\1*', '\1', 'g')) < 3 then
    raise exception 'That code is too easy to guess — choose another';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_lens_request(p_request uuid)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'Lens requests are no longer confirmed — reload the page';
end $function$;

CREATE OR REPLACE FUNCTION public.decline_lens_request(p_request uuid, p_reason text DEFAULT ''::text)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r   public.lens_requests;
  why text := trim(coalesce(p_reason, ''));
begin
  select * into r from public.lens_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not ((r.holder_code = public.jwt_branch() and public.is_lens_owner()) or public.is_admin()) then
    raise exception 'only the lens-holding branch may decline this request';
  end if;
  if r.status <> 'requested' then
    raise exception 'request is already % — it can only be declined before the lenses are sent', r.status;
  end if;

  update public.lens_stock s set qty = s.qty + l.qty, updated_at = now()
    from public.lens_request_lines l
   where l.request_id = p_request and s.id = l.stock_id;

  update public.lens_requests set status = 'declined', reason = why, updated_at = now()
   where id = p_request returning * into r;
  insert into public.lens_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(), 'Declined' || case when why <> '' then ' — ' || why else '' end || '; lenses back on the shelf');
  if r.order_id is not null then
    insert into public.order_events (order_id, by_code, text)
    values (r.order_id, public.jwt_branch(),
            format('%s declined the lenses%s', r.holder_code, case when why <> '' then ' — ' || why else '' end));
    update public.orders set updated_at = now() where id = r.order_id;
  end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.send_lens_request(p_request uuid)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.lens_requests;
begin
  select * into r from public.lens_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not ((r.holder_code = public.jwt_branch() and public.is_lens_owner()) or public.is_admin()) then
    raise exception 'only the lens-holding branch may send these lenses';
  end if;
  if r.status <> 'requested' then raise exception 'request is already %', r.status; end if;

  update public.lens_requests set status = 'sent', updated_at = now() where id = p_request returning * into r;
  insert into public.lens_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(), format('Lenses sent to %s', r.branch_code));
  if r.order_id is not null then
    insert into public.order_events (order_id, by_code, text)
    values (r.order_id, public.jwt_branch(), format('%s sent the lenses — on their way to %s', r.holder_code, r.branch_code));
    update public.orders set updated_at = now() where id = r.order_id;
  end if;
  return r;
end $function$;

commit;
