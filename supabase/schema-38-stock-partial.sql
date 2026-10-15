-- ════════════════════════════════════════════════════════════════════════════
--  38 · Complete a stock request part by part
--  STATUS: applied 2026-10-15 (by Claude)
--
--  The user (2026-10-15): a branch asks for sunglasses, optical frames and
--  books; the office may send the books first. Pressing Complete asks which
--  lines were sent (or all). Each line gets done_at; the request stays open
--  ("Placed", n of m done) until every line is done, then it is Completed.
--  complete_stock_request (all at once) still works and marks every line.
--  Safe to run again.
-- ════════════════════════════════════════════════════════════════════════════

begin;

alter table public.stock_request_lines add column if not exists done_at timestamptz;
-- Requests already completed: every line was sent.
update public.stock_request_lines l set done_at = r.updated_at
  from public.stock_requests r where r.id = l.request_id and r.status = 'completed' and l.done_at is null;

create or replace function public.complete_stock_lines(p_request uuid, p_lines uuid[]) returns public.stock_requests
  language plpgsql security definer set search_path = public as $$
declare
  r     public.stock_requests;
  names text;
  left_ int;
begin
  if not public.is_admin() then raise exception 'Only the office may complete a request'; end if;
  select * into r from public.stock_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'placed' then raise exception 'Request is already %', r.status; end if;

  with done as (
    update public.stock_request_lines set done_at = now()
     where request_id = p_request and id = any(p_lines) and done_at is null
    returning category, brand, position
  )
  select string_agg(category || coalesce(' · ' || brand, ''), ', ' order by position) into names from done;
  if names is null then raise exception 'Choose what was sent'; end if;

  select count(*) into left_ from public.stock_request_lines where request_id = p_request and done_at is null;
  if left_ = 0 then
    update public.stock_requests set status = 'completed', updated_at = now() where id = p_request returning * into r;
    insert into public.stock_request_events (request_id, by_code, text)
    values (p_request, public.jwt_branch(), format('Sent: %s — request completed', names));
  else
    update public.stock_requests set updated_at = now() where id = p_request returning * into r;
    insert into public.stock_request_events (request_id, by_code, text)
    values (p_request, public.jwt_branch(), format('Sent: %s — %s still to come', names, left_));
  end if;
  return r;
end $$;

-- All at once: every line is marked sent too.
create or replace function public.complete_stock_request(p_request uuid) returns public.stock_requests
  language plpgsql security definer set search_path = public as $$
declare r public.stock_requests;
begin
  if not public.is_admin() then raise exception 'Only the office may complete a request'; end if;
  select * into r from public.stock_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'placed' then raise exception 'Request is already %', r.status; end if;
  update public.stock_request_lines set done_at = now() where request_id = p_request and done_at is null;
  update public.stock_requests set status = 'completed', updated_at = now() where id = p_request returning * into r;
  insert into public.stock_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(), 'Fulfilled and completed at the warehouse');
  return r;
end $$;

revoke all on function public.complete_stock_lines(uuid, uuid[]) from public, anon;
grant execute on function public.complete_stock_lines(uuid, uuid[]) to authenticated;

commit;
