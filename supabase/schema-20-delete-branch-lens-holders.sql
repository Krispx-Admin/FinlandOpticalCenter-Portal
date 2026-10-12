-- ════════════════════════════════════════════════════════════════════════════
--  20 · Deleting a branch · more than one branch holding lens stock
--  STATUS: applied 2026-10-12 (by Claude)
--
--  1. delete_branch(code) — the office removes a branch for good: its row and
--     its sign-in account. Only a branch with NOTHING recorded against it can
--     go (a misclick, a branch added by mistake); one with orders, requests,
--     claims or events is refused with what it has, and the office closes it
--     instead (schema-19), which keeps its history. The office, Ghiath and a
--     lens-stock holder cannot be deleted.
--
--  2. Lens stock can be held by several fitting centres. Each shelf row and
--     each lens request now names its holder (holder_code; everything that
--     existed belongs to the one holder there was, MGM). A holder edits only
--     its own shelf and answers only the requests made to it; a branch asks a
--     chosen holder; "frame goes over" sends the frame to that holder.
--     set_lens_holder(code, on) — the office makes an open fitting centre a
--     holder, or stops one (only once its shelf is empty and nothing waits on
--     it). The lens lists (types / indices / coatings) stay shared.
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1 · delete a branch ─────────────────────────────────────────────────────
create or replace function public.delete_branch(p_code text) returns void
  language plpgsql security definer set search_path = public, auth as $$
declare
  b    public.branches;
  used text[] := '{}';
  n    int;
begin
  if not public.is_admin() then
    raise exception 'Only the office may delete branches';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  if b.role in ('admin', 'scheduler') then
    raise exception '% cannot be deleted', b.name;
  end if;
  if b.holds_lens_stock then
    raise exception '% holds lens stock — stop that first', b.name;
  end if;

  select count(*) into n from public.orders where origin_code = p_code or fitter_code = p_code;
  if n > 0 then used := used || format('%s fitting order%s', n, case when n = 1 then '' else 's' end); end if;
  select count(*) into n from public.stock_requests where branch_code = p_code;
  if n > 0 then used := used || format('%s stock request%s', n, case when n = 1 then '' else 's' end); end if;
  select count(*) into n from public.lens_requests where branch_code = p_code or holder_code = p_code;
  if n > 0 then used := used || format('%s lens request%s', n, case when n = 1 then '' else 's' end); end if;
  select count(*) into n from public.claims where branch_code = p_code or created_by = p_code;
  if n > 0 then used := used || format('%s claim%s', n, case when n = 1 then '' else 's' end); end if;
  select (select count(*) from public.order_events where by_code = p_code)
       + (select count(*) from public.stock_request_events where by_code = p_code)
       + (select count(*) from public.lens_request_events where by_code = p_code) into n;
  if n > 0 then used := used || format('%s timeline entr%s', n, case when n = 1 then 'y' else 'ies' end); end if;

  if array_length(used, 1) is not null then
    raise exception '% has records (%) — close it instead, which keeps them', b.name, array_to_string(used, ', ');
  end if;

  delete from public.lens_stock where holder_code = p_code;   -- an emptied shelf, if it ever had one
  delete from auth.identities where user_id in
    (select id from auth.users where (raw_app_meta_data ->> 'branch_code') = p_code);
  delete from auth.users where (raw_app_meta_data ->> 'branch_code') = p_code;
  delete from public.branches where code = p_code;
end $$;

-- ── 2 · lens stock held by several branches ────────────────────────────────
alter table public.lens_stock    add column if not exists holder_code text references public.branches(code);
alter table public.lens_requests add column if not exists holder_code text references public.branches(code);

update public.lens_stock    set holder_code = coalesce((select code from public.branches where holds_lens_stock order by position limit 1), 'MGM') where holder_code is null;
update public.lens_requests set holder_code = coalesce((select code from public.branches where holds_lens_stock order by position limit 1), 'MGM') where holder_code is null;
alter table public.lens_stock    alter column holder_code set not null;
alter table public.lens_requests alter column holder_code set not null;

-- The same lens may sit on two shelves.
alter table public.lens_stock drop constraint if exists lens_stock_lens_type_lens_index_coating_sph_cyl_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lens_stock_holder_spec_key') then
    alter table public.lens_stock add constraint lens_stock_holder_spec_key
      unique (holder_code, lens_type, lens_index, coating, sph, cyl);
  end if;
end $$;

-- The first holder, for anything still asking for "the" holder.
create or replace function public.lens_owner_code() returns text
  language sql stable security definer set search_path = public as
$$ select code from public.branches where holds_lens_stock and active order by position limit 1 $$;

-- Who may touch what: a holder its own shelf and the requests made to it.
drop policy if exists lens_stock_write on public.lens_stock;
create policy lens_stock_write on public.lens_stock for all
  using ((holder_code = public.jwt_branch() and public.is_lens_owner()) or public.is_admin())
  with check ((holder_code = public.jwt_branch() and public.is_lens_owner()) or public.is_admin());

drop policy if exists lens_requests_read on public.lens_requests;
create policy lens_requests_read on public.lens_requests for select
  using (branch_code = public.jwt_branch() or holder_code = public.jwt_branch() or public.is_admin());

drop policy if exists lens_requests_update on public.lens_requests;
create policy lens_requests_update on public.lens_requests for update
  using (holder_code = public.jwt_branch() or public.is_admin())
  with check (holder_code = public.jwt_branch() or public.is_admin());

drop policy if exists lens_lines_all on public.lens_request_lines;
create policy lens_lines_all on public.lens_request_lines for all
  using (exists (select 1 from public.lens_requests r where r.id = lens_request_lines.request_id
                 and (r.branch_code = public.jwt_branch() or r.holder_code = public.jwt_branch() or public.is_admin())))
  with check (exists (select 1 from public.lens_requests r where r.id = lens_request_lines.request_id
                 and r.branch_code = public.jwt_branch()));

drop policy if exists lens_events_all on public.lens_request_events;
create policy lens_events_all on public.lens_request_events for all
  using (exists (select 1 from public.lens_requests r where r.id = lens_request_events.request_id
                 and (r.branch_code = public.jwt_branch() or r.holder_code = public.jwt_branch() or public.is_admin())))
  with check (exists (select 1 from public.lens_requests r where r.id = lens_request_events.request_id
                 and (r.branch_code = public.jwt_branch() or r.holder_code = public.jwt_branch() or public.is_admin())));

-- Adding to a shelf: your own, or (the office) the one named.
drop function if exists public.add_lens_stock(text, text, text, numeric, numeric, integer);
create or replace function public.add_lens_stock(p_type text, p_index text, p_coating text, p_sph numeric,
                                                 p_cyl numeric, p_qty integer, p_holder text default null)
  returns public.lens_stock
  language plpgsql security definer set search_path = public as $$
declare
  holder text := coalesce(nullif(p_holder, ''), public.jwt_branch());
  added  int := greatest(coalesce(p_qty, 0), 0);
  out    public.lens_stock;
begin
  if not ((holder = public.jwt_branch() and public.is_lens_owner()) or public.is_admin()) then
    raise exception 'only the lens-holding branch may change the shelf';
  end if;
  if not exists (select 1 from public.branches where code = holder and holds_lens_stock) then
    raise exception '% does not hold lens stock', holder;
  end if;

  insert into public.lens_stock (holder_code, lens_type, lens_index, coating, sph, cyl, qty)
  values (holder, p_type, p_index, coalesce(nullif(p_coating, ''), 'None'), p_sph, coalesce(p_cyl, 0), added)
  on conflict (holder_code, lens_type, lens_index, coating, sph, cyl)
    do update set qty = lens_stock.qty + added, updated_at = now()
  returning * into out;
  return out;
end $$;

-- Asking a chosen holder.
drop function if exists public.create_lens_request(text, text, text, jsonb);
create or replace function public.create_lens_request(p_bill text, p_customer text, p_fulfilment text,
                                                      p_lines jsonb, p_holder text default null)
  returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  me     text := public.jwt_branch();
  owner  text := coalesce(nullif(p_holder, ''), public.lens_owner_code());
  fitter text;
  ord    public.orders;
  req    public.lens_requests;
  pcs    int;
  kinds  int;
begin
  if me = '' then raise exception 'Not signed in'; end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if p_fulfilment not in ('send_frames', 'receive_lens') then
    raise exception 'Unknown fulfilment %', p_fulfilment;
  end if;
  if not exists (select 1 from public.branches where code = owner and holds_lens_stock and active) then
    raise exception '% does not hold lens stock', owner;
  end if;
  if owner = me then raise exception 'That is your own shelf'; end if;

  -- Only somewhere with a bench can keep the job.
  if p_fulfilment = 'receive_lens'
     and not exists (select 1 from public.branches where code = me and role in ('fitting', 'admin')) then
    raise exception 'Only a fitting centre can cut its own lenses';
  end if;

  -- Cutting it yourself means you are the fitter; otherwise the frame goes to
  -- whoever holds the lenses.
  fitter := case when p_fulfilment = 'receive_lens' then me else owner end;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, fitter, trim(p_customer), 'pending')
  returning * into ord;

  insert into public.lens_requests (branch_code, holder_code, status, note, customer, fulfilment, order_id)
  values (me, owner, 'requested', trim(p_bill), trim(p_customer), p_fulfilment, ord.id)
  returning * into req;

  insert into public.lens_request_lines
         (request_id, stock_id, lens_type, lens_index, coating, sph, cyl, qty)
  select req.id, nullif(l->>'itemId', '')::uuid, l->>'type', l->>'index',
         coalesce(nullif(l->>'coating', ''), 'None'),
         (l->>'sph')::numeric, coalesce((l->>'cyl')::numeric, 0), (l->>'qty')::int
    from jsonb_array_elements(p_lines) l;

  select count(*), coalesce(sum(qty), 0) into kinds, pcs
    from public.lens_request_lines where request_id = req.id;

  insert into public.lens_request_events (request_id, by_code, text)
  values (req.id, me, format('Requested %s lens type%s, %s pcs from %s — bill %s, %s',
            kinds, case when kinds = 1 then '' else 's' end, pcs, owner, trim(p_bill),
            case when p_fulfilment = 'receive_lens'
                 then 'lenses to come here' else 'frame to go over' end));

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Opened from lens request %s — %s',
            req.ref,
            case when p_fulfilment = 'receive_lens'
                 then format('fitting here once %s sends the lenses', owner)
                 else format('frame goes to %s for cutting', owner) end));

  return req;
end $$;

-- Answering: only the holder asked (or the office).
create or replace function public.confirm_lens_request(p_request uuid) returns public.lens_requests
  language plpgsql security definer set search_path = public as $$
declare
  r public.lens_requests;
  l record;
  give int;
  sent int := 0;
  short text[] := '{}';
begin
  select * into r from public.lens_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not ((r.holder_code = public.jwt_branch() and public.is_lens_owner()) or public.is_admin()) then
    raise exception 'only the lens-holding branch may confirm requests';
  end if;
  if r.status <> 'requested' then raise exception 'request is already %', r.status; end if;

  for l in select * from public.lens_request_lines where request_id = p_request loop
    -- Lock the shelf row so a concurrent confirm cannot oversell it.
    select least(qty, l.qty) into give from public.lens_stock where id = l.stock_id for update;
    give := coalesce(give, 0);
    if give < l.qty then
      short := short || format('%s %s %s SPH %s — %s of %s',
                               l.lens_type, l.lens_index, l.coating, l.sph, give, l.qty);
    end if;
    if give > 0 then
      update public.lens_stock set qty = qty - give, updated_at = now() where id = l.stock_id;
      sent := sent + give;
    end if;
  end loop;

  update public.lens_requests set status = 'confirmed', updated_at = now()
   where id = p_request returning * into r;

  insert into public.lens_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(),
          format('Confirmed — %s pcs deducted from %s''s stock and sent to %s', sent, r.holder_code, r.branch_code));

  if array_length(short, 1) is not null then
    insert into public.lens_request_events (request_id, by_code, text)
    values (p_request, public.jwt_branch(), 'Short on: ' || array_to_string(short, '; '));
  end if;

  return r;
end $$;

-- The office makes a branch a holder, or stops one.
create or replace function public.set_lens_holder(p_code text, p_on boolean) returns void
  language plpgsql security definer set search_path = public as $$
declare
  b public.branches;
  n int;
begin
  if not public.is_admin() then
    raise exception 'Only the office may change who holds lens stock';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;

  if p_on then
    if b.role <> 'fitting' or not b.active then
      raise exception 'Only an open fitting centre can hold lens stock — frames are sent to it for cutting';
    end if;
  else
    select coalesce(sum(qty), 0) into n from public.lens_stock where holder_code = p_code;
    if n > 0 then
      raise exception '% still has % lenses on its shelf — clear them first', b.name, n;
    end if;
    select count(*) into n from public.lens_requests where holder_code = p_code and status = 'requested';
    if n > 0 then
      raise exception '% still has % lens request% to answer', b.name, n, case when n = 1 then '' else 's' end;
    end if;
    if (select count(*) from public.branches where holds_lens_stock and code <> p_code) = 0 then
      raise exception '% is the only branch holding lens stock', b.name;
    end if;
  end if;

  update public.branches set holds_lens_stock = p_on where code = p_code;
end $$;

-- branch_access already returns holds_lens_stock (schema-19).

revoke all on function public.delete_branch(text)                   from public, anon;
revoke all on function public.set_lens_holder(text, boolean)        from public, anon;
revoke all on function public.add_lens_stock(text, text, text, numeric, numeric, integer, text) from public, anon;
revoke all on function public.create_lens_request(text, text, text, jsonb, text)                 from public, anon;
grant execute on function public.delete_branch(text)                to authenticated;
grant execute on function public.set_lens_holder(text, boolean)     to authenticated;
grant execute on function public.add_lens_stock(text, text, text, numeric, numeric, integer, text) to authenticated;
grant execute on function public.create_lens_request(text, text, text, jsonb, text)                 to authenticated;

commit;
