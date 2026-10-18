-- ── FOC Portal practice copy: the database layout ──
-- GENERATED from the live database's catalog by demo/build.py —
-- do not edit by hand; regenerate after a migration (HANDOFF: PRACTICE COPY).
-- Runs inside the browser (PGlite) after demo/prelude.sql.
set check_function_bodies = off;


create sequence public."req_seq" start 1001;

create sequence public."lens_seq" start 1001;

create sequence public."damage_seq" start 1001;

create sequence public."claim_seq" start 3001;

create table public."app_settings" (
  "id" integer default 1 not null,
  "brand_groups" jsonb default '[]'::jsonb not null,
  "categories" jsonb default '[]'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null,
  "insurers" jsonb default '[]'::jsonb not null,
  "disabled_tabs" jsonb default '[]'::jsonb not null,
  "outside_cutters" jsonb default '[]'::jsonb not null,
  "outside_lens_handler" text default 'AV'::text not null
);

create table public."branches" (
  "code" text not null,
  "name" text not null,
  "role" text not null,
  "holds_lens_stock" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "active" boolean default true not null,
  "position" integer default 0 not null,
  "bench_closed" boolean default false not null,
  "bench_closed_until" date,
  "bench_own_only" boolean default false not null,
  "can_export_insurance" boolean default false not null
);

create table public."claim_items" (
  "id" uuid default gen_random_uuid() not null,
  "claim_id" uuid not null,
  "position" integer default 0 not null,
  "name" text not null,
  "price" numeric(12,3) default 0 not null,
  "kind" text,
  "qty" integer default 1 not null
);

create table public."claim_prescriptions" (
  "claim_id" uuid not null,
  "line" text not null,
  "od_sph" text,
  "od_cyl" text,
  "od_axis" text,
  "od_va" text,
  "ipd" text,
  "os_sph" text,
  "os_cyl" text,
  "os_axis" text,
  "os_va" text
);

create table public."claims" (
  "id" uuid default gen_random_uuid() not null,
  "ref" text default ('INV-'::text || nextval('claim_seq'::regclass)) not null,
  "claim_date" date not null,
  "branch_code" text not null,
  "bill_no" text,
  "customer" text not null,
  "payment" text default 'cash'::text not null,
  "add_od" text,
  "add_os" text,
  "sh_od" text,
  "sh_os" text,
  "total" numeric(12,3) default 0 not null,
  "created_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "member_id" text,
  "insurer" text,
  "kind" text default 'claim'::text not null,
  "employee_id" text,
  "employee_name" text,
  "canceled_at" timestamp with time zone,
  "canceled_by" text
);

create table public."damaged_lines" (
  "id" uuid default gen_random_uuid() not null,
  "report_id" uuid not null,
  "position" integer default 0 not null,
  "name" text not null,
  "barcode" text default ''::text not null,
  "qty" integer not null
);

create table public."damaged_reports" (
  "id" uuid default gen_random_uuid() not null,
  "ref" text default ('DS-'::text || nextval('damage_seq'::regclass)) not null,
  "branch_code" text not null,
  "note" text default ''::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."employees" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."lens_catalogue" (
  "id" integer default 1 not null,
  "types" jsonb default '[]'::jsonb not null,
  "indices" jsonb default '[]'::jsonb not null,
  "coatings" jsonb default '[]'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."lens_request_events" (
  "id" uuid default gen_random_uuid() not null,
  "request_id" uuid not null,
  "at" timestamp with time zone default now() not null,
  "by_code" text,
  "text" text not null
);

create table public."lens_request_lines" (
  "id" uuid default gen_random_uuid() not null,
  "request_id" uuid not null,
  "stock_id" uuid,
  "lens_type" text not null,
  "lens_index" text not null,
  "coating" text default 'None'::text not null,
  "sph" numeric(5,2) not null,
  "cyl" numeric(5,2) default 0 not null,
  "qty" integer not null
);

create table public."lens_requests" (
  "id" uuid default gen_random_uuid() not null,
  "ref" text default ('LR-'::text || nextval('lens_seq'::regclass)) not null,
  "branch_code" text not null,
  "status" text default 'requested'::text not null,
  "note" text,
  "reason" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "customer" text default ''::text not null,
  "fulfilment" text default 'send_frames'::text not null,
  "order_id" uuid,
  "holder_code" text not null
);

create table public."lens_stock" (
  "id" uuid default gen_random_uuid() not null,
  "lens_type" text not null,
  "lens_index" text not null,
  "coating" text default 'None'::text not null,
  "sph" numeric(5,2) not null,
  "cyl" numeric(5,2) default 0 not null,
  "qty" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  "holder_code" text not null
);

create table public."order_events" (
  "id" uuid default gen_random_uuid() not null,
  "order_id" uuid not null,
  "at" timestamp with time zone default now() not null,
  "by_code" text,
  "text" text not null
);

create table public."orders" (
  "id" uuid default gen_random_uuid() not null,
  "ref" text not null,
  "origin_code" text not null,
  "fitter_code" text,
  "customer" text,
  "phone" text,
  "brand" text,
  "model" text,
  "lens" text,
  "urgent" boolean default false not null,
  "note" text,
  "status" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "outside_cutter" text,
  "collect_code" text,
  "frame_at" text,
  "to_code" text,
  "stops" text[] default '{}'::text[] not null
);

create table public."outside_lens_orders" (
  "id" uuid default gen_random_uuid() not null,
  "order_id" uuid not null,
  "branch_code" text not null,
  "rx" jsonb default '{}'::jsonb not null,
  "lens_type" text not null,
  "status" text default 'to_order'::text not null,
  "ordered_at" timestamp with time zone,
  "ordered_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "fulfilment" text default 'send_frames'::text not null,
  "sent_at" timestamp with time zone,
  "dest_code" text,
  "received_at" timestamp with time zone,
  "arrived_at" timestamp with time zone
);

create table public."schedule_branches" (
  "code" text not null,
  "name" text not null,
  "city" text,
  "needs_optom" boolean default false not null,
  "keep" boolean default false not null,
  "split" boolean,
  "days" jsonb default '{}'::jsonb not null,
  "position" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" text
);

create table public."schedule_defaults" (
  "id" integer default 1 not null,
  "employees" jsonb default '[]'::jsonb not null,
  "branches" jsonb default '[]'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."schedule_employees" (
  "id" text not null,
  "name" text not null,
  "optom" boolean default false not null,
  "type" text default 'High'::text not null,
  "weekend_days" text[] default '{}'::text[] not null,
  "priority" text[] default '{}'::text[] not null,
  "position" integer default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" text
);

create table public."schedule_state" (
  "id" integer default 1 not null,
  "vacations" jsonb default '{}'::jsonb not null,
  "overrides" jsonb default '[]'::jsonb not null,
  "pt_days" jsonb default '{}'::jsonb not null,
  "pins" jsonb default '{}'::jsonb not null,
  "presets" jsonb default '[]'::jsonb not null,
  "week_start" date,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" text
);

create table public."schedule_weeks" (
  "week_start" date not null,
  "result" jsonb not null,
  "employees" jsonb default '[]'::jsonb not null,
  "branches" jsonb default '[]'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" text,
  "published" jsonb,
  "published_at" timestamp with time zone,
  "published_by" text
);

create table public."stock_request_events" (
  "id" uuid default gen_random_uuid() not null,
  "request_id" uuid not null,
  "at" timestamp with time zone default now() not null,
  "by_code" text,
  "text" text not null
);

create table public."stock_request_lines" (
  "id" uuid default gen_random_uuid() not null,
  "request_id" uuid not null,
  "position" integer default 0 not null,
  "category" text not null,
  "brand" text,
  "audience" text,
  "qty" integer,
  "unit" text,
  "note" text,
  "done_at" timestamp with time zone
);

create table public."stock_requests" (
  "id" uuid default gen_random_uuid() not null,
  "ref" text default ('SR-'::text || nextval('req_seq'::regclass)) not null,
  "branch_code" text not null,
  "status" text default 'placed'::text not null,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

alter table public."app_settings" add constraint "app_settings_id_check" CHECK ((id = 1));

alter table public."app_settings" add constraint "app_settings_pkey" PRIMARY KEY (id);

alter table public."branches" add constraint "branches_role_check" CHECK ((role = ANY (ARRAY['retail'::text, 'fitting'::text, 'clinic'::text, 'admin'::text, 'scheduler'::text, 'manager'::text])));

alter table public."branches" add constraint "branches_pkey" PRIMARY KEY (code);

alter table public."claim_items" add constraint "claim_items_kind_check" CHECK (((kind IS NULL) OR (kind = ANY (ARRAY['frame'::text, 'lens'::text]))));

alter table public."claim_items" add constraint "claim_items_price_check" CHECK ((price >= (0)::numeric));

alter table public."claim_items" add constraint "claim_items_qty_check" CHECK ((qty > 0));

alter table public."claim_items" add constraint "claim_items_pkey" PRIMARY KEY (id);

alter table public."claim_prescriptions" add constraint "claim_prescriptions_line_check" CHECK ((line = ANY (ARRAY['d'::text, 'n'::text])));

alter table public."claim_prescriptions" add constraint "claim_prescriptions_pkey" PRIMARY KEY (claim_id, line);

alter table public."claims" add constraint "claims_kind_check" CHECK ((kind = ANY (ARRAY['claim'::text, 'direct'::text])));

alter table public."claims" add constraint "claims_payment_check" CHECK ((payment = ANY (ARRAY['cash'::text, 'card'::text, 'both'::text])));

alter table public."claims" add constraint "claims_pkey" PRIMARY KEY (id);

alter table public."claims" add constraint "claims_ref_key" UNIQUE (ref);

alter table public."damaged_lines" add constraint "damaged_lines_qty_check" CHECK ((qty > 0));

alter table public."damaged_lines" add constraint "damaged_lines_pkey" PRIMARY KEY (id);

alter table public."damaged_reports" add constraint "damaged_reports_pkey" PRIMARY KEY (id);

alter table public."damaged_reports" add constraint "damaged_reports_ref_key" UNIQUE (ref);

alter table public."employees" add constraint "employees_name_check" CHECK ((btrim(name) <> ''::text));

alter table public."employees" add constraint "employees_pkey" PRIMARY KEY (id);

alter table public."lens_catalogue" add constraint "lens_catalogue_id_check" CHECK ((id = 1));

alter table public."lens_catalogue" add constraint "lens_catalogue_pkey" PRIMARY KEY (id);

alter table public."lens_request_events" add constraint "lens_request_events_pkey" PRIMARY KEY (id);

alter table public."lens_request_lines" add constraint "lens_request_lines_qty_check" CHECK ((qty > 0));

alter table public."lens_request_lines" add constraint "lens_request_lines_pkey" PRIMARY KEY (id);

alter table public."lens_requests" add constraint "lens_requests_fulfilment_check" CHECK ((fulfilment = ANY (ARRAY['send_frames'::text, 'receive_lens'::text])));

alter table public."lens_requests" add constraint "lens_requests_status_check" CHECK ((status = ANY (ARRAY['requested'::text, 'reserved'::text, 'sent'::text, 'confirmed'::text, 'declined'::text])));

alter table public."lens_requests" add constraint "lens_requests_pkey" PRIMARY KEY (id);

alter table public."lens_requests" add constraint "lens_requests_ref_key" UNIQUE (ref);

alter table public."lens_stock" add constraint "lens_stock_qty_check" CHECK ((qty >= 0));

alter table public."lens_stock" add constraint "lens_stock_pkey" PRIMARY KEY (id);

alter table public."lens_stock" add constraint "lens_stock_holder_spec_key" UNIQUE (holder_code, lens_type, lens_index, coating, sph, cyl);

alter table public."order_events" add constraint "order_events_pkey" PRIMARY KEY (id);

alter table public."orders" add constraint "orders_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'lenses_in'::text, 'to_fitter'::text, 'at_fitter'::text, 'ready'::text, 'returning'::text, 'delivered'::text, 'collected'::text])));

alter table public."orders" add constraint "orders_pkey" PRIMARY KEY (id);

alter table public."outside_lens_orders" add constraint "outside_lens_orders_fulfilment_check" CHECK ((fulfilment = ANY (ARRAY['send_frames'::text, 'receive_lens'::text])));

alter table public."outside_lens_orders" add constraint "outside_lens_orders_status_check" CHECK ((status = ANY (ARRAY['to_order'::text, 'ordered'::text])));

alter table public."outside_lens_orders" add constraint "outside_lens_orders_pkey" PRIMARY KEY (id);

alter table public."outside_lens_orders" add constraint "outside_lens_orders_order_id_key" UNIQUE (order_id);

alter table public."schedule_branches" add constraint "schedule_branches_pkey" PRIMARY KEY (code);

alter table public."schedule_defaults" add constraint "schedule_defaults_id_check" CHECK ((id = 1));

alter table public."schedule_defaults" add constraint "schedule_defaults_pkey" PRIMARY KEY (id);

alter table public."schedule_employees" add constraint "schedule_employees_pkey" PRIMARY KEY (id);

alter table public."schedule_state" add constraint "schedule_state_id_check" CHECK ((id = 1));

alter table public."schedule_state" add constraint "schedule_state_pkey" PRIMARY KEY (id);

alter table public."schedule_weeks" add constraint "schedule_weeks_pkey" PRIMARY KEY (week_start);

alter table public."stock_request_events" add constraint "stock_request_events_pkey" PRIMARY KEY (id);

alter table public."stock_request_lines" add constraint "stock_request_lines_pkey" PRIMARY KEY (id);

alter table public."stock_requests" add constraint "stock_requests_status_check" CHECK ((status = ANY (ARRAY['placed'::text, 'completed'::text])));

alter table public."stock_requests" add constraint "stock_requests_pkey" PRIMARY KEY (id);

alter table public."stock_requests" add constraint "stock_requests_ref_key" UNIQUE (ref);

alter table public."claim_items" add constraint "claim_items_claim_id_fkey" FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE;

alter table public."claim_prescriptions" add constraint "claim_prescriptions_claim_id_fkey" FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE;

alter table public."claims" add constraint "claims_branch_code_fkey" FOREIGN KEY (branch_code) REFERENCES branches(code);

alter table public."claims" add constraint "claims_created_by_fkey" FOREIGN KEY (created_by) REFERENCES branches(code);

alter table public."damaged_lines" add constraint "damaged_lines_report_id_fkey" FOREIGN KEY (report_id) REFERENCES damaged_reports(id) ON DELETE CASCADE;

alter table public."damaged_reports" add constraint "damaged_reports_branch_code_fkey" FOREIGN KEY (branch_code) REFERENCES branches(code);

alter table public."lens_request_events" add constraint "lens_request_events_by_code_fkey" FOREIGN KEY (by_code) REFERENCES branches(code);

alter table public."lens_request_events" add constraint "lens_request_events_request_id_fkey" FOREIGN KEY (request_id) REFERENCES lens_requests(id) ON DELETE CASCADE;

alter table public."lens_request_lines" add constraint "lens_request_lines_request_id_fkey" FOREIGN KEY (request_id) REFERENCES lens_requests(id) ON DELETE CASCADE;

alter table public."lens_request_lines" add constraint "lens_request_lines_stock_id_fkey" FOREIGN KEY (stock_id) REFERENCES lens_stock(id) ON DELETE SET NULL;

alter table public."lens_requests" add constraint "lens_requests_branch_code_fkey" FOREIGN KEY (branch_code) REFERENCES branches(code);

alter table public."lens_requests" add constraint "lens_requests_holder_code_fkey" FOREIGN KEY (holder_code) REFERENCES branches(code);

alter table public."lens_requests" add constraint "lens_requests_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

alter table public."lens_stock" add constraint "lens_stock_holder_code_fkey" FOREIGN KEY (holder_code) REFERENCES branches(code);

alter table public."order_events" add constraint "order_events_by_code_fkey" FOREIGN KEY (by_code) REFERENCES branches(code);

alter table public."order_events" add constraint "order_events_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

alter table public."orders" add constraint "orders_collect_code_fkey" FOREIGN KEY (collect_code) REFERENCES branches(code);

alter table public."orders" add constraint "orders_fitter_code_fkey" FOREIGN KEY (fitter_code) REFERENCES branches(code);

alter table public."orders" add constraint "orders_frame_at_fkey" FOREIGN KEY (frame_at) REFERENCES branches(code);

alter table public."orders" add constraint "orders_origin_code_fkey" FOREIGN KEY (origin_code) REFERENCES branches(code);

alter table public."orders" add constraint "orders_to_code_fkey" FOREIGN KEY (to_code) REFERENCES branches(code);

alter table public."outside_lens_orders" add constraint "outside_lens_orders_branch_code_fkey" FOREIGN KEY (branch_code) REFERENCES branches(code);

alter table public."outside_lens_orders" add constraint "outside_lens_orders_dest_code_fkey" FOREIGN KEY (dest_code) REFERENCES branches(code);

alter table public."outside_lens_orders" add constraint "outside_lens_orders_order_id_fkey" FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

alter table public."outside_lens_orders" add constraint "outside_lens_orders_ordered_by_fkey" FOREIGN KEY (ordered_by) REFERENCES branches(code);

alter table public."stock_request_events" add constraint "stock_request_events_by_code_fkey" FOREIGN KEY (by_code) REFERENCES branches(code);

alter table public."stock_request_events" add constraint "stock_request_events_request_id_fkey" FOREIGN KEY (request_id) REFERENCES stock_requests(id) ON DELETE CASCADE;

alter table public."stock_request_lines" add constraint "stock_request_lines_request_id_fkey" FOREIGN KEY (request_id) REFERENCES stock_requests(id) ON DELETE CASCADE;

alter table public."stock_requests" add constraint "stock_requests_branch_code_fkey" FOREIGN KEY (branch_code) REFERENCES branches(code);

CREATE INDEX claim_items_claim_idx ON public.claim_items USING btree (claim_id, "position");

CREATE INDEX claims_branch_idx ON public.claims USING btree (branch_code);

CREATE INDEX claims_customer_idx ON public.claims USING btree (customer);

CREATE INDEX claims_date_idx ON public.claims USING btree (claim_date DESC);

CREATE INDEX claims_kind_date_idx ON public.claims USING btree (kind, claim_date DESC);

CREATE INDEX claims_member_idx ON public.claims USING btree (member_id);

CREATE INDEX damaged_lines_report ON public.damaged_lines USING btree (report_id);

CREATE INDEX damaged_reports_branch_idx ON public.damaged_reports USING btree (branch_code, created_at DESC);

CREATE UNIQUE INDEX employees_name_key ON public.employees USING btree (lower(btrim(name)));

CREATE INDEX lens_request_events_req_idx ON public.lens_request_events USING btree (request_id, at);

CREATE INDEX lens_request_lines_req_idx ON public.lens_request_lines USING btree (request_id);

CREATE INDEX lens_request_lines_stock_idx ON public.lens_request_lines USING btree (stock_id);

CREATE INDEX lens_requests_branch_idx ON public.lens_requests USING btree (branch_code);

CREATE INDEX lens_requests_holder_idx ON public.lens_requests USING btree (holder_code);

CREATE INDEX lens_requests_order_idx ON public.lens_requests USING btree (order_id);

CREATE INDEX lens_requests_status_idx ON public.lens_requests USING btree (status, updated_at DESC);

CREATE INDEX order_events_order_idx ON public.order_events USING btree (order_id, at);

CREATE INDEX orders_collect_idx ON public.orders USING btree (collect_code);

CREATE INDEX orders_fitter_idx ON public.orders USING btree (fitter_code);

CREATE INDEX orders_frame_at_idx ON public.orders USING btree (frame_at);

CREATE INDEX orders_origin_idx ON public.orders USING btree (origin_code);

CREATE UNIQUE INDEX orders_ref_per_branch ON public.orders USING btree (origin_code, ref);

CREATE INDEX orders_status_idx ON public.orders USING btree (status, updated_at DESC);

CREATE INDEX orders_to_code_idx ON public.orders USING btree (to_code);

CREATE INDEX orders_updated_idx ON public.orders USING btree (updated_at DESC);

CREATE INDEX outside_lens_orders_branch_idx ON public.outside_lens_orders USING btree (branch_code);

CREATE INDEX outside_lens_orders_dest_idx ON public.outside_lens_orders USING btree (dest_code);

CREATE INDEX outside_lens_orders_status_idx ON public.outside_lens_orders USING btree (status, created_at);

CREATE INDEX stock_request_events_req_idx ON public.stock_request_events USING btree (request_id, at);

CREATE INDEX stock_request_lines_req_idx ON public.stock_request_lines USING btree (request_id, "position");

CREATE INDEX stock_requests_branch_idx ON public.stock_requests USING btree (branch_code);

CREATE INDEX stock_requests_status_idx ON public.stock_requests USING btree (status, updated_at DESC);

CREATE OR REPLACE FUNCTION public.add_branch(p_code text, p_name text, p_role text, p_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  v_code  text := upper(trim(coalesce(p_code, '')));
  nm    text := trim(coalesce(p_name, ''));
  v_email text;
  uid   uuid := gen_random_uuid();
  src   auth.users;
begin
  if not public.is_admin() then
    raise exception 'Only the office may add branches';
  end if;
  if v_code !~ '^[A-Z][A-Z0-9]{1,9}$' then
    raise exception 'The code is 2 to 10 letters or digits, starting with a letter';
  end if;
  if nm = '' then
    raise exception 'Give it a name';
  end if;
  if p_role not in ('retail', 'fitting', 'clinic', 'manager', 'scheduler', 'admin') then
    raise exception 'Unknown kind of account %', p_role;
  end if;
  if exists (select 1 from public.branches b where b.code = v_code) then
    raise exception 'There is already a profile %', v_code;
  end if;
  perform public.assert_good_pin(p_pin);

  v_email := lower(v_code) || '@finlandoptical.om';
  if exists (select 1 from auth.users u where u.email = v_email) then
    raise exception 'A sign-in account % already exists', v_email;
  end if;

  insert into public.branches (code, name, role, holds_lens_stock, active, position)
  values (v_code, nm, p_role, false, true,
          coalesce((select max(position) from public.branches), 0) + 1);

  -- Shaped exactly like the accounts the branches already sign in with.
  select * into src from auth.users where raw_app_meta_data ? 'branch_code' limit 1;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token,
    raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous,
    created_at, updated_at)
  values (
    src.instance_id, uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_pin, extensions.gen_salt('bf')), now(),
    '', '', '', '', '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                       'branch_code', v_code, 'branch_role', p_role),
    '{"email_verified": true}'::jsonb, src.is_super_admin, false, false,
    now(), now());

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values (uid::text, uid,
          jsonb_build_object('sub', uid::text, 'email', v_email,
                             'email_verified', false, 'phone_verified', false),
          'email', now(), now());
end $function$;

CREATE OR REPLACE FUNCTION public.add_lens_stock(p_type text, p_index text, p_coating text, p_sph numeric, p_cyl numeric, p_qty integer, p_holder text DEFAULT NULL::text)
 RETURNS lens_stock
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

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
    raise exception 'That code is too easy to guess â€” choose another';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.bench_closed(p_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.bench_off(p_code)
      or coalesce((select b.bench_own_only from public.branches b where b.code = p_code), false)
$function$;

CREATE OR REPLACE FUNCTION public.bench_lock_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status is not distinct from old.status then return new; end if;
  if current_setting('foc.undo', true) = '1' then return new; end if;
  -- Another branch's frame cannot go to a lab that is off or in-house only.
  if new.status = 'to_fitter' and new.fitter_code is not null and public.bench_closed(new.fitter_code) then
    raise exception '% is not taking frames — lab %', (select name from public.branches where code = new.fitter_code),
      case when public.bench_off(new.fitter_code) then 'off' else 'in-house only' end;
  end if;
  -- A branch's own job: only when its lab is off altogether.
  if new.status = 'at_fitter' and old.status in ('pending', 'lenses_in') and new.fitter_code = new.origin_code
     and public.bench_off(new.fitter_code) then
    raise exception 'Your lab is off. Send it to another fitter';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.bench_off(p_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select b.bench_closed and (b.bench_closed_until is null
                          or b.bench_closed_until >= (now() at time zone 'Asia/Muscat')::date)
                     from public.branches b where b.code = p_code), false)
$function$;

CREATE OR REPLACE FUNCTION public.branch_access()
 RETURNS TABLE(code text, name text, role text, active boolean, "position" integer, holds_lens_stock boolean, has_account boolean, last_sign_in timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select b.code, b.name, b.role, b.active, b.position, b.holds_lens_stock,
         u.id is not null as has_account,
         u.last_sign_in_at
    from public.branches b
    left join auth.users u on (u.raw_app_meta_data ->> 'branch_code') = b.code
   where public.is_admin()
   order by b.position, b.code
$function$;

CREATE OR REPLACE FUNCTION public.can_schedule()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.role in ('admin', 'scheduler')) $function$;

CREATE OR REPLACE FUNCTION public.cancel_claim(p_id uuid, p_cancel boolean)
 RETURNS claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c  public.claims;
  me text := public.jwt_branch();
begin
  select * into c from public.claims where id = p_id for update;
  if not found then raise exception 'Record not found'; end if;
  if not (c.branch_code = me or public.is_admin()) then
    raise exception 'Only the branch that raised it, or the office, can cancel it';
  end if;
  if c.kind <> 'direct' then raise exception 'Only Direct Insurance records are canceled — delete an invoice instead'; end if;
  update public.claims
     set canceled_at = case when p_cancel then coalesce(canceled_at, now()) end,
         canceled_by = case when p_cancel then coalesce(canceled_by, me) end,
         updated_at = now()
   where id = p_id
   returning * into c;
  return c;
end $function$;

CREATE OR REPLACE FUNCTION public.change_lens_fulfilment(p_request uuid, p_fulfilment text)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r    public.lens_requests;
  o    public.orders;
  me   text := public.jwt_branch();
  cuts boolean;
begin
  if p_fulfilment not in ('send_frames', 'receive_lens') then
    raise exception 'Unknown fulfilment %', p_fulfilment;
  end if;
  select * into r from public.lens_requests where id = p_request for update;
  if not found then raise exception 'request not found'; end if;
  if not (r.branch_code = me or public.is_admin()) then
    raise exception 'Only the branch that ordered the lenses (or the office) can change this';
  end if;
  if r.fulfilment = p_fulfilment then return r; end if;
  if r.status = 'declined' then raise exception 'This request was declined'; end if;
  select * into o from public.orders where id = r.order_id for update;
  if not found then raise exception 'The fitting order for this request is gone'; end if;

  if p_fulfilment = 'send_frames' then
    if o.status <> 'pending' then
      raise exception 'Too late to change â€” the lenses have already been marked delivered';
    end if;
    update public.lens_requests set fulfilment = 'send_frames', status = 'reserved', updated_at = now()
     where id = r.id returning * into r;
    if public.bench_closed(r.holder_code) then
      raise exception '% is closed — fitter on leave', (select name from public.branches where code = r.holder_code);
    end if;
    update public.orders set fitter_code = r.holder_code, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    if o.status <> 'lenses_in' or o.fitter_code is distinct from r.holder_code then
      raise exception 'Too late to change â€” the frame has already been sent';
    end if;
    cuts := exists (select 1 from public.branches where code = r.branch_code and role in ('fitting', 'admin'));
    update public.lens_requests set fulfilment = 'receive_lens', status = 'requested', updated_at = now()
     where id = r.id returning * into r;
    update public.orders set fitter_code = null,
                             status = 'pending', updated_at = now() where id = o.id;
  end if;

  insert into public.lens_request_events (request_id, by_code, text)
  values (r.id, coalesce(nullif(me, ''), r.branch_code),
          case when p_fulfilment = 'send_frames'
               then format('Changed: the frame goes to %s; the lenses stay set aside there', r.holder_code)
               else format('Changed: %s sends the lenses to %s', r.holder_code, r.branch_code) end);
  insert into public.order_events (order_id, by_code, text)
  values (o.id, coalesce(nullif(me, ''), r.branch_code),
          case when p_fulfilment = 'send_frames'
               then format('Changed: the frame goes to %s for cutting â€” the lenses wait there', r.holder_code)
               else format('Changed: %s sends the lenses here', r.holder_code) end);
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.change_outside_fulfilment(p_id uuid, p_fulfilment text, p_dest text DEFAULT NULL::text)
 RETURNS outside_lens_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x    public.outside_lens_orders;
  o    public.orders;
  me   text := public.jwt_branch();
  h    text := public.outside_lens_handler();
  dest text;
begin
  if p_fulfilment not in ('send_frames', 'receive_lens') then raise exception 'Unknown fulfilment %', p_fulfilment; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if not (x.branch_code = me or public.is_admin()) then raise exception 'Only the branch that ordered (or the office) can change this'; end if;
  if x.branch_code = h then raise exception 'The lenses arrive at % — nothing to change', h; end if;
  select * into o from public.orders where id = x.order_id for update;
  if x.sent_at is not null then raise exception 'Too late to change — the lenses have already been sent'; end if;
  if not ((x.fulfilment = 'receive_lens' and o.status = 'pending')
       or (x.fulfilment = 'send_frames' and o.status = 'lenses_in' and o.fitter_code = x.dest_code)) then
    raise exception 'Too late to change — the frame has already been sent';
  end if;
  if p_fulfilment = 'send_frames' then
    dest := nullif(p_dest, '');
    if dest is null or dest = x.branch_code then raise exception 'Choose the fitter'; end if;
    if not public.open_fitter(dest) then raise exception '% is not an open fitting centre', coalesce((select name from public.branches where code = dest), dest); end if;
  else
    dest := x.branch_code;
  end if;
  if x.fulfilment = p_fulfilment and x.dest_code = dest then return x; end if;

  update public.outside_lens_orders set fulfilment = p_fulfilment, dest_code = dest, updated_at = now() where id = p_id returning * into x;
  if p_fulfilment = 'send_frames' then
    update public.orders set fitter_code = dest, status = 'lenses_in', updated_at = now() where id = o.id;
  else
    update public.orders set fitter_code = null, status = 'pending', updated_at = now() where id = o.id;
  end if;
  insert into public.order_events (order_id, by_code, text)
  values (o.id, me, case when p_fulfilment = 'send_frames'
                         then format('Changed: the frame and the lenses go to %s', dest)
                         else format('Changed: %s sends the lenses here', h) end);
  return x;
end $function$;

CREATE OR REPLACE FUNCTION public.claims_ref_by_kind()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.kind = 'direct' then
    if new.ref like 'INV-%' then new.ref := 'DI-' || substr(new.ref, 5);
    elsif new.ref like 'IC-%' then new.ref := 'DI-' || substr(new.ref, 4);
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.complete_stock_lines(p_request uuid, p_lines uuid[])
 RETURNS stock_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.complete_stock_request(p_request uuid)
 RETURNS stock_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_lens_request(p_request uuid)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'Lens requests are no longer confirmed â€” reload the page';
end $function$;

CREATE OR REPLACE FUNCTION public.create_damaged_report(p_lines jsonb, p_note text DEFAULT ''::text)
 RETURNS damaged_reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me  text := public.jwt_branch();
  r   public.damaged_reports;
  l   record;
  i   int := 0;
begin
  if not exists (select 1 from public.branches where code = me and role in ('retail', 'fitting', 'clinic') and active) then
    raise exception 'Only a branch can send a damaged stock report';
  end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Add at least one item'; end if;
  insert into public.damaged_reports (branch_code, note) values (me, trim(coalesce(p_note, ''))) returning * into r;
  for l in select trim(coalesce(x->>'name', '')) as name, trim(coalesce(x->>'barcode', '')) as barcode,
                  coalesce(nullif(x->>'qty', '')::int, 0) as qty
             from jsonb_array_elements(p_lines) x loop
    if l.name = '' then raise exception 'Every line needs the name of the glasses'; end if;
    if l.qty <= 0 then raise exception 'Every line needs a quantity'; end if;
    insert into public.damaged_lines (report_id, position, name, barcode, qty) values (r.id, i, l.name, l.barcode, l.qty);
    i := i + 1;
  end loop;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.create_lens_request(p_bill text, p_customer text, p_fulfilment text, p_lines jsonb, p_holder text DEFAULT NULL::text)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me     text := public.jwt_branch();
  owner  text := coalesce(nullif(p_holder, ''), public.lens_owner_code());
  cuts   boolean;
  fitter text;
  ord    public.orders;
  req    public.lens_requests;
  l      record;
  have   int;
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
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'No lenses in the request'; end if;

  -- Receiving: a fitting centre cuts them itself; anyone else sends the frame
  -- and the lenses on to a fitter afterwards (chosen then).
  cuts := exists (select 1 from public.branches where code = me and role in ('fitting', 'admin'));
  -- Receiving: no fitter yet — once the lenses arrive the branch keeps it
  -- (if it has an open bench) or sends frame + lenses to a fitter (schema-29).
  fitter := case when p_fulfilment = 'send_frames' then owner else null end;
  if p_fulfilment = 'send_frames' and public.bench_closed(owner) then
    raise exception '% is closed — fitter on leave. Choose to receive the lenses', (select name from public.branches where code = owner);
  end if;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, fitter, trim(p_customer),
          case when p_fulfilment = 'send_frames' then 'lenses_in' else 'pending' end)
  returning * into ord;

  insert into public.lens_requests (branch_code, holder_code, status, note, customer, fulfilment, order_id)
  values (me, owner, case when p_fulfilment = 'send_frames' then 'reserved' else 'requested' end,
          trim(p_bill), trim(p_customer), p_fulfilment, ord.id)
  returning * into req;

  -- Take each line off that holder's shelf now. Rows are locked, so two
  -- branches ordering the last lens at the same instant cannot both get it.
  for l in select (x->>'itemId')::uuid as item, x->>'type' as t, x->>'index' as i,
                  coalesce(nullif(x->>'coating', ''), 'None') as c,
                  (x->>'sph')::numeric as sph, coalesce((x->>'cyl')::numeric, 0) as cyl, (x->>'qty')::int as qty
             from jsonb_array_elements(p_lines) x loop
    if l.qty is null or l.qty <= 0 then raise exception 'A lens line has no quantity'; end if;
    select qty into have from public.lens_stock where id = l.item and holder_code = owner for update;
    if have is null then
      raise exception '% % % SPH % is no longer on %''s shelf', l.t, l.i, l.c, l.sph, owner;
    end if;
    if have < l.qty then
      raise exception 'Only % left of % % % SPH % â€” ask for % or fewer', have, l.t, l.i, l.c, l.sph, have;
    end if;
    update public.lens_stock set qty = qty - l.qty, updated_at = now() where id = l.item;
    insert into public.lens_request_lines (request_id, stock_id, lens_type, lens_index, coating, sph, cyl, qty)
    values (req.id, l.item, l.t, l.i, l.c, l.sph, l.cyl, l.qty);
  end loop;

  select count(*), coalesce(sum(qty), 0) into kinds, pcs
    from public.lens_request_lines where request_id = req.id;

  insert into public.lens_request_events (request_id, by_code, text)
  values (req.id, me, format('Requested %s lens type%s, %s pcs from %s â€” bill %s, %s; taken off %s''s shelf',
            kinds, case when kinds = 1 then '' else 's' end, pcs, owner, trim(p_bill),
            case when p_fulfilment = 'receive_lens' then 'lenses to come here' else 'frame to go over' end,
            owner));

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Opened from lens request %s â€” %s',
            req.ref,
            case when p_fulfilment = 'send_frames'
                   then format('lenses set aside at %s; the frame goes there for cutting', owner)
                 else format('%s sends the lenses here; then cut here or send to a fitter', owner) end));

  return req;
end $function$;

CREATE OR REPLACE FUNCTION public.create_outside_lens_order(p_bill text, p_customer text, p_rx jsonb, p_lens_type text, p_fulfilment text DEFAULT 'send_frames'::text, p_dest text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me   text := public.jwt_branch();
  h    text := public.outside_lens_handler();
  how  text := coalesce(nullif(p_fulfilment, ''), 'send_frames');
  dest text;
  ord  public.orders;
begin
  if me = '' then raise exception 'Not signed in'; end if;
  if how not in ('send_frames', 'receive_lens') then raise exception 'Unknown fulfilment %', how; end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if coalesce(trim(p_lens_type), '') = '' then raise exception 'Type the lens type'; end if;
  if coalesce(trim(p_rx #>> '{r,sph}'), '') = '' and coalesce(trim(p_rx #>> '{l,sph}'), '') = '' then
    raise exception 'Enter the prescription (at least the SPH)';
  end if;
  -- The handler's own orders, and a fitter picking itself, are "receive".
  if me = h or nullif(p_dest, '') = me then how := 'receive_lens'; end if;
  if how = 'send_frames' then
    dest := nullif(p_dest, '');
    if dest is null then raise exception 'Choose the fitter the frame and lenses go to'; end if;
    if not public.open_fitter(dest) then
      raise exception '% cannot take it — not an open fitting centre', coalesce((select name from public.branches where code = dest), dest);
    end if;
  else
    dest := me;
  end if;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, case when how = 'send_frames' then dest else null end, trim(p_customer),
          case when how = 'send_frames' then 'lenses_in' else 'pending' end)
  returning * into ord;

  insert into public.outside_lens_orders (order_id, branch_code, rx, lens_type, fulfilment, dest_code)
  values (ord.id, me, coalesce(p_rx, '{}'::jsonb), trim(p_lens_type), how, dest);

  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Order logged at %s with outside lenses (%s) — %s orders them; %s',
            me, trim(p_lens_type), h,
            case when me = h then 'they arrive here'
                 when how = 'send_frames' then format('the frame and the lenses go to %s, which cuts it', dest)
                 else format('%s sends the lenses here', h) end));
  return ord;
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
    raise exception 'request is already % â€” it can only be declined before the lenses are sent', r.status;
  end if;

  update public.lens_stock s set qty = s.qty + l.qty, updated_at = now()
    from public.lens_request_lines l
   where l.request_id = p_request and s.id = l.stock_id;

  update public.lens_requests set status = 'declined', reason = why, updated_at = now()
   where id = p_request returning * into r;
  insert into public.lens_request_events (request_id, by_code, text)
  values (p_request, public.jwt_branch(), 'Declined' || case when why <> '' then ' â€” ' || why else '' end || '; lenses back on the shelf');
  if r.order_id is not null then
    insert into public.order_events (order_id, by_code, text)
    values (r.order_id, public.jwt_branch(),
            format('%s declined the lenses%s', r.holder_code, case when why <> '' then ' â€” ' || why else '' end));
    update public.orders set updated_at = now() where id = r.order_id;
  end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_branch(p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
  -- Any account can go (schema-41) - but never the last office admin, and
  -- never the account doing the deleting.
  if p_code = public.jwt_branch() then
    raise exception 'You cannot delete the account you are signed in with';
  end if;
  if b.role = 'admin' and not exists (select 1 from public.branches where role = 'admin' and active and code <> p_code) then
    raise exception '% is the last office admin', b.name;
  end if;
  if b.holds_lens_stock then
    raise exception '% holds lens stock - stop that first', b.name;
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
    raise exception '% has records (%) - close it instead, which keeps them', b.name, array_to_string(used, ', ');
  end if;

  delete from public.lens_stock where holder_code = p_code;   -- an emptied shelf, if it ever had one
  delete from auth.identities where user_id in
    (select id from auth.users where (raw_app_meta_data ->> 'branch_code') = p_code);
  delete from auth.users where (raw_app_meta_data ->> 'branch_code') = p_code;
  delete from public.branches where code = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.delete_order(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o  public.orders;
  me text := public.jwt_branch();
  lr public.lens_requests;
  ol public.outside_lens_orders;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (o.origin_code = me or public.is_admin()) then raise exception 'Only % (or the office) can delete this order', o.origin_code; end if;
  if o.status not in ('pending', 'lenses_in') then raise exception 'Too late to delete — the frame has already moved. Undo the steps first'; end if;
  select * into ol from public.outside_lens_orders where order_id = p_id;
  if ol.id is not null and ol.status <> 'to_order' then
    raise exception 'Too late to delete — % has already confirmed the outside lenses with the supplier', public.outside_lens_handler();
  end if;
  for lr in select * from public.lens_requests where order_id = p_id for update loop
    -- Lenses from the branch's own shelf never left it: they go back too (schema-42).
    if lr.status in ('sent', 'confirmed') and lr.holder_code <> lr.branch_code then raise exception 'Too late to delete — the stock lenses have been sent'; end if;
    -- Reserved or requested lenses go back on the shelf (declined ones already did).
    if lr.status in ('reserved', 'requested') or (lr.holder_code = lr.branch_code and lr.status <> 'declined') then
      update public.lens_stock s set qty = s.qty + l.qty, updated_at = now()
        from public.lens_request_lines l where l.request_id = lr.id and s.id = l.stock_id;
    end if;
    delete from public.lens_requests where id = lr.id;
  end loop;
  delete from public.orders where id = p_id;   -- events and the outside lens order go with it
end $function$;

CREATE OR REPLACE FUNCTION public.disabled_tabs()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select disabled_tabs from public.app_settings where id = 1), '[]'::jsonb) $function$;

CREATE OR REPLACE FUNCTION public.edit_order(p_id uuid, p_ref text, p_customer text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o   public.orders;
  me  text := public.jwt_branch();
  v_ref text := trim(coalesce(p_ref, ''));
  v_cus text := trim(coalesce(p_customer, ''));
  what text[] := '{}';
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (o.origin_code = me or public.is_admin()) then raise exception 'Only % (or the office) can edit this order', o.origin_code; end if;
  if v_ref = '' then raise exception 'A bill number is needed'; end if;
  if v_cus = '' then raise exception 'A customer name is needed'; end if;
  if v_ref = o.ref and v_cus = coalesce(o.customer, '') then return o; end if;
  if v_ref <> o.ref then what := what || format('bill %s → %s', o.ref, v_ref); end if;
  if v_cus <> coalesce(o.customer, '') then what := what || format('customer %s → %s', coalesce(nullif(o.customer, ''), '—'), v_cus); end if;
  update public.orders set ref = v_ref, customer = v_cus where id = p_id returning * into o;
  -- The lens request carries the same bill and name.
  update public.lens_requests set note = v_ref, customer = v_cus, updated_at = now() where order_id = p_id;
  insert into public.order_events (order_id, by_code, text)
  values (p_id, coalesce(nullif(me, ''), o.origin_code), 'Edited: ' || array_to_string(what, '; '));
  return o;
end $function$;

CREATE OR REPLACE FUNCTION public.edit_outside_lens(p_id uuid, p_rx jsonb, p_lens_type text)
 RETURNS outside_lens_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
begin
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if not (x.branch_code = me or public.is_admin()) then raise exception 'Only % (or the office) can edit this', x.branch_code; end if;
  if x.status <> 'to_order' then raise exception 'Too late to change — % has already confirmed the order with the supplier', public.outside_lens_handler(); end if;
  if coalesce(trim(p_lens_type), '') = '' then raise exception 'Type the lens type'; end if;
  if coalesce(trim(p_rx #>> '{r,sph}'), '') = '' and coalesce(trim(p_rx #>> '{l,sph}'), '') = '' then
    raise exception 'Enter the prescription (at least the SPH)';
  end if;
  update public.outside_lens_orders set rx = coalesce(p_rx, '{}'::jsonb), lens_type = trim(p_lens_type), updated_at = now()
   where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, coalesce(nullif(me, ''), x.branch_code), format('Edited: outside lenses — %s', trim(p_lens_type)));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.role = 'admin') $function$;

CREATE OR REPLACE FUNCTION public.is_lens_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.holds_lens_stock) $function$;

CREATE OR REPLACE FUNCTION public.is_scheduler()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.branches b where b.code = public.jwt_branch() and b.role in ('scheduler', 'manager')) $function$;

CREATE OR REPLACE FUNCTION public.jwt_branch()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select coalesce(auth.jwt() -> 'app_metadata' ->> 'branch_code', '') $function$;

CREATE OR REPLACE FUNCTION public.lens_owner_code()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select code from public.branches where holds_lens_stock and active order by position limit 1 $function$;

CREATE OR REPLACE FUNCTION public.open_fitter(p_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from public.branches where code = p_code and role = 'fitting' and active) and not public.bench_closed(p_code) $function$;

CREATE OR REPLACE FUNCTION public.orders_route_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c text := coalesce(new.collect_code, new.origin_code);
  x text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if current_setting('foc.undo', true) = '1' or current_setting('foc.route', true) = '1' then return new; end if;

  if new.status = 'ready' and old.status in ('at_fitter', 'to_fitter') then
    -- Ready at the fitter (or, from an outside cutter, back at the branch).
    new.frame_at := case when new.outside_cutter is not null then new.origin_code else new.fitter_code end;
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

CREATE OR REPLACE FUNCTION public.outside_lens_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x public.outside_lens_orders;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into x from public.outside_lens_orders where order_id = new.id;
  if not found then return new; end if;
  -- The fitter cannot finish the cut before the lenses have reached it.
  if x.fulfilment = 'send_frames' and x.received_at is null and old.status = 'at_fitter' and new.status in ('ready', 'delivered') then
    raise exception 'The outside lenses have not arrived here yet';
  end if;
  -- Lenses coming to the branch: received only once sent (or, at the
  -- handler itself, once ordered).
  if x.fulfilment = 'receive_lens' and old.status = 'pending' and new.status <> 'pending' then
    if x.sent_at is null and not (x.branch_code = public.outside_lens_handler() and x.status = 'ordered') then
      raise exception 'The outside lenses have not been sent yet';
    end if;
    update public.outside_lens_orders
       set received_at = coalesce(received_at, now()), arrived_at = coalesce(arrived_at, now()), updated_at = now()
     where id = x.id;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.outside_lens_handler()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select coalesce((select nullif(outside_lens_handler, '') from public.app_settings where id = 1), 'AV') $function$;

CREATE OR REPLACE FUNCTION public.outside_lenses_arrived(p_id uuid)
 RETURNS outside_lens_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
  h  text := public.outside_lens_handler();
begin
  if not (me = h or public.is_admin()) then raise exception 'Only % (or the office) can mark these lenses received', h; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if x.status <> 'ordered' then raise exception 'Confirm the order first'; end if;
  if x.arrived_at is not null then return x; end if;
  update public.outside_lens_orders set arrived_at = now(), updated_at = now() where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, me, format('The outside lenses arrived at %s', h));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $function$;

CREATE OR REPLACE FUNCTION public.publish_schedule_week(p_week date)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  at timestamptz;
begin
  if not public.can_schedule() then
    raise exception 'Only the office or Ghiath can publish the schedule';
  end if;

  update public.schedule_weeks
     set published = jsonb_build_object('week_start', week_start, 'result', result,
                                        'employees', employees, 'branches', branches),
         published_at = now(),
         published_by = nullif(public.jwt_branch(), '')
   where week_start = p_week
  returning published_at into at;

  if not found then
    raise exception 'There is no schedule for that week yet';
  end if;
  return at;
end $function$;

CREATE OR REPLACE FUNCTION public.recalc_claim_total()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare target uuid := coalesce(new.claim_id, old.claim_id);
begin
  update public.claims c
     set total = coalesce((select sum(case when c.kind = 'direct' then i.price else i.price * i.qty end)
                             from public.claim_items i where i.claim_id = target), 0),
         updated_at = now()
   where c.id = target;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.receive_outside_lenses(p_id uuid)
 RETURNS outside_lens_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
begin
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if not (me = x.dest_code or public.is_admin()) then raise exception 'Only % can mark these lenses received', x.dest_code; end if;
  if x.sent_at is null then raise exception 'The lenses have not been sent yet'; end if;
  if x.received_at is not null then return x; end if;
  update public.outside_lens_orders set received_at = now(), updated_at = now() where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, me, format('%s received the outside lenses', x.dest_code));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_branch(p_code text, p_name text, p_role text, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  b  public.branches;
  nm text := trim(coalesce(p_name, ''));
begin
  if not public.is_admin() then
    raise exception 'Only the office may change branches';
  end if;
  select * into b from public.branches where code = p_code;
  if not found then
    raise exception 'No branch %', p_code;
  end if;
  if nm = '' then
    raise exception 'Give it a name';
  end if;
  -- Every account is a branch (retail / fitting / clinic) or a person (view-
  -- only admin, schedule editor, office admin), and can be switched - as long
  -- as one open office admin is left (schema-41).
  if p_role not in ('retail', 'fitting', 'clinic', 'manager', 'scheduler', 'admin') then
    raise exception 'Unknown kind of account %', p_role;
  end if;
  if b.role = 'admin' and (p_role <> 'admin' or not p_active)
     and not exists (select 1 from public.branches where role = 'admin' and active and code <> p_code) then
    raise exception '% is the last office admin - make another account office admin first', b.name;
  end if;
  if b.holds_lens_stock and (p_role <> 'fitting' or not p_active) then
    raise exception '% holds the lens stock, so it has to stay an open fitting centre', b.name;
  end if;

  update public.branches set name = nm, role = p_role, active = p_active,
         -- only a fitting centre has a lab
         bench_closed = case when p_role = 'fitting' then bench_closed else false end,
         bench_closed_until = case when p_role = 'fitting' then bench_closed_until else null end,
         bench_own_only = case when p_role = 'fitting' then bench_own_only else false end
   where code = p_code;

  update auth.users
     set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('branch_role', p_role),
         banned_until = case when p_active then null else now() + interval '100 years' end,
         updated_at = now()
   where (raw_app_meta_data ->> 'branch_code') = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.save_schedule_roster(p_employees jsonb, p_branches jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.can_schedule() then
    raise exception 'Only the office or Ghiath can change the schedule roster';
  end if;
  if coalesce(jsonb_array_length(p_employees), 0) = 0 or coalesce(jsonb_array_length(p_branches), 0) = 0 then
    raise exception 'Refusing to save an empty roster';
  end if;

  delete from public.schedule_employees
   where id not in (select e->>'id' from jsonb_array_elements(p_employees) e);
  insert into public.schedule_employees (id, name, optom, type, weekend_days, priority, position)
  select e->>'id', e->>'name', coalesce((e->>'optom')::boolean, false), coalesce(e->>'type', 'High'),
         array(select jsonb_array_elements_text(coalesce(e->'weekendDays', '[]'::jsonb))),
         array(select jsonb_array_elements_text(coalesce(e->'priority', '[]'::jsonb))),
         (n - 1)::int
    from jsonb_array_elements(p_employees) with ordinality as x(e, n)
  on conflict (id) do update
     set name = excluded.name, optom = excluded.optom, type = excluded.type,
         weekend_days = excluded.weekend_days, priority = excluded.priority, position = excluded.position;

  delete from public.schedule_branches
   where code not in (select b->>'code' from jsonb_array_elements(p_branches) b);
  insert into public.schedule_branches (code, name, city, needs_optom, keep, split, days, position)
  select b->>'code', b->>'name', b->>'city',
         coalesce((b->>'needsOptom')::boolean, false), coalesce((b->>'keep')::boolean, false),
         (b->>'split')::boolean, coalesce(b->'days', '{}'::jsonb), (n - 1)::int
    from jsonb_array_elements(p_branches) with ordinality as x(b, n)
  on conflict (code) do update
     set name = excluded.name, city = excluded.city, needs_optom = excluded.needs_optom,
         keep = excluded.keep, split = excluded.split, days = excluded.days, position = excluded.position;
end $function$;

CREATE OR REPLACE FUNCTION public.schedule_view()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(w.published order by w.week_start), '[]'::jsonb)
    from public.schedule_weeks w
   where w.published is not null
     and w.week_start > (now() at time zone 'Asia/Muscat')::date - 7
     and (public.is_admin() or not (public.disabled_tabs() ? 'schedule'))
$function$;

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
    values (r.order_id, public.jwt_branch(), format('%s sent the lenses â€” on their way to %s', r.holder_code, r.branch_code));
    update public.orders set updated_at = now() where id = r.order_id;
  end if;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.send_outside_lenses(p_id uuid)
 RETURNS outside_lens_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  x  public.outside_lens_orders;
  me text := public.jwt_branch();
  h  text := public.outside_lens_handler();
begin
  if not (me = h or public.is_admin()) then raise exception 'Only % (or the office) can send these lenses', h; end if;
  select * into x from public.outside_lens_orders where id = p_id for update;
  if not found then raise exception 'Outside lens order not found'; end if;
  if x.dest_code = h then raise exception 'These lenses stay at %', h; end if;
  if x.status <> 'ordered' then raise exception 'Confirm the order first'; end if;
  if x.arrived_at is null then raise exception 'Mark the lenses received at % first', h; end if;
  if x.sent_at is not null then raise exception 'These lenses were already sent'; end if;
  if x.dest_code <> x.branch_code and public.bench_closed(x.dest_code) then
    raise exception '% lab is off. The branch has to choose another fitter', (select name from public.branches where code = x.dest_code);
  end if;
  update public.outside_lens_orders set sent_at = now(), updated_at = now() where id = p_id returning * into x;
  insert into public.order_events (order_id, by_code, text)
  values (x.order_id, me, format('%s sent the outside lenses to %s', h, x.dest_code));
  update public.orders set updated_at = now() where id = x.order_id;
  return x;
end $function$;

CREATE OR REPLACE FUNCTION public.set_bench(p_code text, p_closed boolean, p_until date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.branches;
begin
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  if b.role <> 'fitting' then raise exception '% has no lab', b.name; end if;
  if not (public.jwt_branch() = p_code or public.is_admin()) then
    raise exception 'Only % itself (or the office) can change its lab', b.name;
  end if;
  if p_closed and p_until is not null and p_until < (now() at time zone 'Asia/Muscat')::date then
    raise exception 'The reopening date is in the past';
  end if;
  update public.branches
     set bench_closed = p_closed, bench_closed_until = case when p_closed then p_until else null end, bench_own_only = false
   where code = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.set_branch_code(p_branch text, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception 'Only the office may change branch codes';
  end if;
  perform public.assert_good_pin(p_code);

  update auth.users
     set encrypted_password = extensions.crypt(p_code, extensions.gen_salt('bf')),
         updated_at = now()
   where (raw_app_meta_data ->> 'branch_code') = p_branch;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'No sign-in account exists for branch %', p_branch;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_collect(p_id uuid, p_code text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o     public.orders;
  me    text := public.jwt_branch();
  p     text;
  old_c text;
  l     text;
  n     int;
  note  text := '';
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (me in (o.origin_code, o.fitter_code, o.collect_code, o.to_code, o.frame_at) or me = any(o.stops) or public.is_admin()) then
    raise exception 'Only a branch on this order''s route (or the office) can change where it is collected';
  end if;
  if o.status = 'collected' then raise exception 'Already handed to the customer'; end if;
  p := coalesce(nullif(p_code, ''), o.origin_code);
  -- A branch only — never a person's profile (the office, Ghiath, Wijdan, Sarah).
  if not exists (select 1 from public.branches where code = p and active and role in ('retail', 'fitting', 'clinic')) then
    raise exception '% is not an open branch', p;
  end if;
  old_c := coalesce(o.collect_code, o.origin_code);
  if p = old_c then return o; end if;

  perform set_config('foc.route', '1', true);
  if o.status = 'ready' then
    l := coalesce(o.frame_at, case when o.outside_cutter is not null then o.origin_code else o.fitter_code end);
    if p = l then                                                       -- it is already there
      n := coalesce(array_length(o.stops, 1), 0);
      update public.orders set status = 'delivered', frame_at = l,
             stops = case when n > 0 and o.stops[n] = l then o.stops[1:n - 1] else o.stops end
       where id = p_id;
      note := ' — it is already there: ready for collection';
    end if;
  elsif o.status = 'delivered' then
    l := coalesce(o.frame_at, old_c);
    update public.orders set status = 'ready', frame_at = l,
           stops = case when l = o.fitter_code or (o.outside_cutter is not null and l = o.origin_code) then o.stops else o.stops || l end
     where id = p_id;
    note := format(' — %s transfers it', l);
  elsif o.status = 'returning' then
    note := format(' — it reaches %s first, then is transferred', coalesce(o.to_code, old_c));
  end if;
  update public.orders set collect_code = case when p = o.origin_code then null else p end, updated_at = now()
   where id = p_id returning * into o;
  perform set_config('foc.route', '', true);

  insert into public.order_events (order_id, by_code, text)
  values (p_id, coalesce(nullif(me, ''), o.origin_code), format('Collection moved: %s → %s%s', old_c, p, note));
  return o;
end $function$;

CREATE OR REPLACE FUNCTION public.set_insurance_export(p_code text, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then raise exception 'Only the office may change this'; end if;
  update public.branches set can_export_insurance = coalesce(p_on, false) where code = p_code;
  if not found then raise exception 'No profile %', p_code; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.set_lab(p_code text, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.branches;
begin
  if p_mode not in ('on', 'inhouse', 'off') then raise exception 'Unknown lab setting %', p_mode; end if;
  select * into b from public.branches where code = p_code;
  if not found then raise exception 'No branch %', p_code; end if;
  if b.role <> 'fitting' then raise exception '% has no lab', b.name; end if;
  if not (public.jwt_branch() = p_code or public.is_admin()) then
    raise exception 'Only % itself (or the office) can change its lab', b.name;
  end if;
  update public.branches
     set bench_closed = (p_mode = 'off'), bench_closed_until = null, bench_own_only = (p_mode = 'inhouse')
   where code = p_code;
end $function$;

CREATE OR REPLACE FUNCTION public.set_lens_holder(p_code text, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      raise exception 'Only an open fitting centre can hold lens stock â€” frames are sent to it for cutting';
    end if;
  else
    select coalesce(sum(qty), 0) into n from public.lens_stock where holder_code = p_code;
    if n > 0 then
      raise exception '% still has % lenses on its shelf â€” clear them first', b.name, n;
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_outside_lens_status(p_ids uuid[], p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me text := public.jwt_branch();
  n  int;
begin
  if not (me = public.outside_lens_handler() or public.is_admin()) then
    raise exception 'Only % (or the office) can confirm outside lens orders', public.outside_lens_handler();
  end if;
  if p_status not in ('to_order', 'ordered') then raise exception 'Unknown status %', p_status; end if;
  if p_status = 'to_order' and exists (
       select 1 from public.outside_lens_orders x join public.orders o on o.id = x.order_id
        where x.id = any(p_ids) and (x.arrived_at is not null or x.sent_at is not null
                                     or o.status in ('ready', 'returning', 'delivered', 'collected')
                                     or (o.fitter_code = o.origin_code and o.status = 'at_fitter'))) then
    raise exception 'Too late to undo — the lenses have arrived or cutting has started';
  end if;

  with changed as (
    update public.outside_lens_orders
       set status = p_status,
           ordered_at = case when p_status = 'ordered' then now() else null end,
           ordered_by = case when p_status = 'ordered' then me else null end,
           updated_at = now()
     where id = any(p_ids) and status <> p_status
    returning order_id
  ), ev as (
    insert into public.order_events (order_id, by_code, text)
    select order_id, me, case when p_status = 'ordered'
                              then 'Outside lenses ordered from the supplier'
                              else 'Outside lenses put back to "to order"' end
      from changed
    returning order_id
  )
  update public.orders o set updated_at = now() from ev where o.id = ev.order_id;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.staff_list()
 RETURNS TABLE(id text, name text, branches text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select e.id::text, e.name, '{}'::text[] from public.employees e order by lower(e.name) $function$;

CREATE OR REPLACE FUNCTION public.touch_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  new.updated_by = nullif(public.jwt_branch(), '');
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ begin new.updated_at = now(); return new; end $function$;

CREATE OR REPLACE FUNCTION public.undo_order_step(p_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o    public.orders;
  me   text := public.jwt_branch();
  lr   public.lens_requests;
  ol   public.outside_lens_orders;
  c    text;
  flow text[];
  i    int;
  prev text;
  keep_fitter boolean;
begin
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (me in (o.origin_code, o.fitter_code, o.collect_code, o.to_code, o.frame_at) or public.is_admin()) then
    raise exception 'Only a branch on this order''s route (or the office) can undo a step';
  end if;
  if coalesce(array_length(o.stops, 1), 0) > 0 then
    raise exception 'This frame has been transferred — change where it is collected instead';
  end if;
  select * into lr from public.lens_requests where order_id = p_id order by created_at desc limit 1;
  select * into ol from public.outside_lens_orders where order_id = p_id;
  c := coalesce(o.collect_code, o.origin_code);

  -- The road this order is on (as in the app's data.js, flowFor).
  flow := case
    when o.outside_cutter is not null then
      case when c = o.origin_code then array['pending','lenses_in','to_fitter','delivered','collected']
           else array['pending','lenses_in','to_fitter','ready','returning','delivered','collected'] end
    when o.fitter_code is not null and o.fitter_code = o.origin_code then
      case when c = o.origin_code then array['pending','lenses_in','at_fitter','delivered','collected']
           else array['pending','lenses_in','at_fitter','ready','returning','delivered','collected'] end
    when o.fitter_code is not null and c = o.fitter_code then array['pending','lenses_in','to_fitter','at_fitter','delivered','collected']
    else array['pending','lenses_in','to_fitter','at_fitter','ready','returning','delivered','collected'] end;
  i := array_position(flow, o.status);
  if i is null or i = 1 then raise exception 'Nothing to undo — this is the first step'; end if;
  prev := flow[i - 1];

  keep_fitter := (lr.id is not null and lr.fulfilment = 'send_frames') or (ol.id is not null and ol.fulfilment = 'send_frames');
  if prev = 'pending' and keep_fitter then raise exception 'Nothing to undo — this is the first step'; end if;
  if prev = 'pending' and ((lr.id is not null and lr.status in ('sent', 'confirmed')) or (ol.id is not null and ol.branch_code <> public.outside_lens_handler())) then
    raise exception 'The lenses are here — that step can''t be undone';
  end if;

  perform set_config('foc.undo', '1', true);
  update public.orders
     set status = prev,
         fitter_code = case when prev in ('pending', 'lenses_in') and not keep_fitter then null else fitter_code end,
         outside_cutter = case when prev in ('pending', 'lenses_in') then null else outside_cutter end,
         to_code = case when prev = 'returning' then c else null end,
         frame_at = case when prev = 'returning' and o.outside_cutter is not null then o.origin_code
                         when prev = 'ready' then o.frame_at
                         else null end
   where id = p_id returning * into o;
  perform set_config('foc.undo', '', true);
  if prev = 'pending' and ol.id is not null then
    update public.outside_lens_orders set received_at = null, arrived_at = null, updated_at = now() where id = ol.id;
  end if;

  insert into public.order_events (order_id, by_code, text)
  values (p_id, coalesce(nullif(me, ''), o.origin_code), format('Step undone — back to %s', prev));
  return o;
end $function$;

CREATE OR REPLACE FUNCTION public.use_own_lens_stock(p_bill text, p_customer text, p_lines jsonb)
 RETURNS lens_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me    text := public.jwt_branch();
  ord   public.orders;
  req   public.lens_requests;
  l     record;
  have  int;
  pcs   int;
  kinds int;
begin
  if not exists (select 1 from public.branches where code = me and holds_lens_stock and active) then
    raise exception 'Your branch does not hold lens stock';
  end if;
  if coalesce(trim(p_bill), '') = '' then raise exception 'A bill number is needed'; end if;
  if coalesce(trim(p_customer), '') = '' then raise exception 'A customer name is needed'; end if;
  if coalesce(jsonb_array_length(p_lines), 0) = 0 then raise exception 'Choose the lenses'; end if;

  insert into public.orders (ref, origin_code, fitter_code, customer, status)
  values (trim(p_bill), me, null, trim(p_customer), 'lenses_in')
  returning * into ord;

  insert into public.lens_requests (branch_code, holder_code, status, note, customer, fulfilment, order_id)
  values (me, me, 'confirmed', trim(p_bill), trim(p_customer), 'receive_lens', ord.id)
  returning * into req;

  for l in select (x->>'itemId')::uuid as item, x->>'type' as t, x->>'index' as i,
                  coalesce(nullif(x->>'coating', ''), 'None') as c,
                  (x->>'sph')::numeric as sph, coalesce((x->>'cyl')::numeric, 0) as cyl, (x->>'qty')::int as qty
             from jsonb_array_elements(p_lines) x loop
    if l.qty is null or l.qty <= 0 then raise exception 'A lens line has no quantity'; end if;
    select qty into have from public.lens_stock where id = l.item and holder_code = me for update;
    if have is null then raise exception '% % % SPH % is no longer on your shelf', l.t, l.i, l.c, l.sph; end if;
    if have < l.qty then raise exception 'Only % left of % % % SPH %', have, l.t, l.i, l.c, l.sph; end if;
    update public.lens_stock set qty = qty - l.qty, updated_at = now() where id = l.item;
    insert into public.lens_request_lines (request_id, stock_id, lens_type, lens_index, coating, sph, cyl, qty)
    values (req.id, l.item, l.t, l.i, l.c, l.sph, l.cyl, l.qty);
  end loop;

  select count(*), coalesce(sum(qty), 0) into kinds, pcs from public.lens_request_lines where request_id = req.id;
  insert into public.lens_request_events (request_id, by_code, text)
  values (req.id, me, format('Taken off %s''s own shelf — %s lens type%s, %s pcs, bill %s', me, kinds, case when kinds = 1 then '' else 's' end, pcs, trim(p_bill)));
  insert into public.order_events (order_id, by_code, text)
  values (ord.id, me, format('Order logged at %s with %s pcs from its own lens stock — lenses in hand', me, pcs));
  return req;
end $function$;

CREATE TRIGGER app_settings_touch BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER claim_items_total AFTER INSERT OR DELETE OR UPDATE ON public.claim_items FOR EACH ROW EXECUTE FUNCTION recalc_claim_total();

CREATE TRIGGER claims_ref_kind BEFORE INSERT ON public.claims FOR EACH ROW EXECUTE FUNCTION claims_ref_by_kind();

CREATE TRIGGER claims_touch BEFORE UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER lens_catalogue_touch BEFORE UPDATE ON public.lens_catalogue FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER lens_requests_touch BEFORE UPDATE ON public.lens_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER orders_bench_lock BEFORE UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION bench_lock_gate();

CREATE TRIGGER orders_outside_lens_gate BEFORE UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION outside_lens_gate();

CREATE TRIGGER orders_route_gate BEFORE UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_route_gate();

CREATE TRIGGER orders_touch BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER schedule_branches_touch BEFORE INSERT OR UPDATE ON public.schedule_branches FOR EACH ROW EXECUTE FUNCTION touch_schedule();

CREATE TRIGGER schedule_employees_touch BEFORE INSERT OR UPDATE ON public.schedule_employees FOR EACH ROW EXECUTE FUNCTION touch_schedule();

CREATE TRIGGER schedule_state_touch BEFORE INSERT OR UPDATE ON public.schedule_state FOR EACH ROW EXECUTE FUNCTION touch_schedule();

CREATE TRIGGER schedule_weeks_touch BEFORE INSERT OR UPDATE ON public.schedule_weeks FOR EACH ROW EXECUTE FUNCTION touch_schedule();

CREATE TRIGGER stock_requests_touch BEFORE UPDATE ON public.stock_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

alter table public."claims" enable row level security;

alter table public."claim_prescriptions" enable row level security;

alter table public."order_events" enable row level security;

alter table public."lens_request_events" enable row level security;

alter table public."lens_request_lines" enable row level security;

alter table public."lens_requests" enable row level security;

alter table public."orders" enable row level security;

alter table public."lens_stock" enable row level security;

alter table public."branches" enable row level security;

alter table public."employees" enable row level security;

alter table public."app_settings" enable row level security;

alter table public."stock_request_events" enable row level security;

alter table public."stock_request_lines" enable row level security;

alter table public."stock_requests" enable row level security;

alter table public."claim_items" enable row level security;

alter table public."damaged_reports" enable row level security;

alter table public."lens_catalogue" enable row level security;

alter table public."schedule_branches" enable row level security;

alter table public."schedule_employees" enable row level security;

alter table public."schedule_defaults" enable row level security;

alter table public."schedule_weeks" enable row level security;

alter table public."schedule_state" enable row level security;

alter table public."outside_lens_orders" enable row level security;

alter table public."damaged_lines" enable row level security;

create policy "app_settings_read" on public."app_settings" as permissive for select to authenticated using (true);

create policy "app_settings_write" on public."app_settings" as permissive for all to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));

create policy "branches_read" on public."branches" as permissive for select to authenticated using (true);

create policy "branches_read_anon" on public."branches" as permissive for select to anon using (true);

create policy "claim_items_all" on public."claim_items" as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM claims c
  WHERE ((c.id = claim_items.claim_id) AND ((c.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)))))) with check ((EXISTS ( SELECT 1
   FROM claims c
  WHERE ((c.id = claim_items.claim_id) AND ((c.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin))))));

create policy "claim_items_scheduler_read" on public."claim_items" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "claim_prescriptions_scheduler_read" on public."claim_prescriptions" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "claim_rx_all" on public."claim_prescriptions" as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM claims c
  WHERE ((c.id = claim_prescriptions.claim_id) AND ((c.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)))))) with check ((EXISTS ( SELECT 1
   FROM claims c
  WHERE ((c.id = claim_prescriptions.claim_id) AND ((c.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin))))));

create policy "claims_delete" on public."claims" as permissive for delete to authenticated using ((((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)) AND (kind <> 'direct'::text)));

create policy "claims_read" on public."claims" as permissive for select to authenticated using (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)));

create policy "claims_scheduler_read" on public."claims" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "claims_update" on public."claims" as permissive for update to authenticated using (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin))) with check (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)));

create policy "claims_write" on public."claims" as permissive for insert to authenticated with check (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)));

create policy "damaged_lines_read" on public."damaged_lines" as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM damaged_reports r
  WHERE ((r.id = damaged_lines.report_id) AND ((r.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin) OR ( SELECT is_scheduler() AS is_scheduler))))));

create policy "damaged_reports_delete" on public."damaged_reports" as permissive for delete to authenticated using (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)));

create policy "damaged_reports_read" on public."damaged_reports" as permissive for select to authenticated using (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin) OR ( SELECT is_scheduler() AS is_scheduler)));

create policy "employees_admin" on public."employees" as permissive for all to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));

create policy "lens_catalogue_read" on public."lens_catalogue" as permissive for select to authenticated using (true);

create policy "lens_catalogue_write" on public."lens_catalogue" as permissive for all to authenticated using ((( SELECT is_lens_owner() AS is_lens_owner) OR ( SELECT is_admin() AS is_admin))) with check ((( SELECT is_lens_owner() AS is_lens_owner) OR ( SELECT is_admin() AS is_admin)));

create policy "lens_events_all" on public."lens_request_events" as permissive for all to public using ((EXISTS ( SELECT 1
   FROM lens_requests r
  WHERE ((r.id = lens_request_events.request_id) AND ((r.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR (r.holder_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)))))) with check ((EXISTS ( SELECT 1
   FROM lens_requests r
  WHERE ((r.id = lens_request_events.request_id) AND ((r.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR (r.holder_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin))))));

create policy "lens_request_events_scheduler_read" on public."lens_request_events" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "lens_lines_all" on public."lens_request_lines" as permissive for all to public using ((EXISTS ( SELECT 1
   FROM lens_requests r
  WHERE ((r.id = lens_request_lines.request_id) AND ((r.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR (r.holder_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)))))) with check ((EXISTS ( SELECT 1
   FROM lens_requests r
  WHERE ((r.id = lens_request_lines.request_id) AND (r.branch_code = ( SELECT jwt_branch() AS jwt_branch))))));

create policy "lens_request_lines_scheduler_read" on public."lens_request_lines" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "lens_requests_insert" on public."lens_requests" as permissive for insert to authenticated with check ((branch_code = ( SELECT jwt_branch() AS jwt_branch)));

create policy "lens_requests_read" on public."lens_requests" as permissive for select to public using (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR (holder_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)));

create policy "lens_requests_scheduler_read" on public."lens_requests" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "lens_requests_update" on public."lens_requests" as permissive for update to public using (((holder_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin))) with check (((holder_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)));

create policy "lens_stock_read" on public."lens_stock" as permissive for select to authenticated using (true);

create policy "lens_stock_write" on public."lens_stock" as permissive for all to public using ((((holder_code = ( SELECT jwt_branch() AS jwt_branch)) AND ( SELECT is_lens_owner() AS is_lens_owner)) OR ( SELECT is_admin() AS is_admin))) with check ((((holder_code = ( SELECT jwt_branch() AS jwt_branch)) AND ( SELECT is_lens_owner() AS is_lens_owner)) OR ( SELECT is_admin() AS is_admin)));

create policy "order_events_all" on public."order_events" as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_events.order_id) AND ((o.origin_code = ( SELECT jwt_branch() AS jwt_branch)) OR (o.fitter_code = ( SELECT jwt_branch() AS jwt_branch)) OR (o.collect_code = ( SELECT jwt_branch() AS jwt_branch)) OR (o.to_code = ( SELECT jwt_branch() AS jwt_branch)) OR (o.frame_at = ( SELECT jwt_branch() AS jwt_branch)) OR (( SELECT jwt_branch() AS jwt_branch) = ANY (o.stops)) OR ( SELECT is_admin() AS is_admin)))))) with check ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_events.order_id) AND ((o.origin_code = ( SELECT jwt_branch() AS jwt_branch)) OR (o.fitter_code = ( SELECT jwt_branch() AS jwt_branch)) OR (o.collect_code = ( SELECT jwt_branch() AS jwt_branch)) OR (o.to_code = ( SELECT jwt_branch() AS jwt_branch)) OR (o.frame_at = ( SELECT jwt_branch() AS jwt_branch)) OR (( SELECT jwt_branch() AS jwt_branch) = ANY (o.stops)) OR ( SELECT is_admin() AS is_admin))))));

create policy "order_events_lens_holder_read" on public."order_events" as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM lens_requests r
  WHERE ((r.order_id = order_events.order_id) AND (r.holder_code = ( SELECT jwt_branch() AS jwt_branch))))));

create policy "order_events_outside_handler_read" on public."order_events" as permissive for select to authenticated using (((( SELECT jwt_branch() AS jwt_branch) = ( SELECT outside_lens_handler() AS outside_lens_handler)) AND (EXISTS ( SELECT 1
   FROM outside_lens_orders x
  WHERE (x.order_id = order_events.order_id)))));

create policy "order_events_scheduler_read" on public."order_events" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "orders_insert" on public."orders" as permissive for insert to authenticated with check (((origin_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)));

create policy "orders_lens_holder_read" on public."orders" as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM lens_requests r
  WHERE ((r.order_id = orders.id) AND (r.holder_code = ( SELECT jwt_branch() AS jwt_branch))))));

create policy "orders_outside_handler_read" on public."orders" as permissive for select to authenticated using (((( SELECT jwt_branch() AS jwt_branch) = ( SELECT outside_lens_handler() AS outside_lens_handler)) AND (EXISTS ( SELECT 1
   FROM outside_lens_orders x
  WHERE (x.order_id = orders.id)))));

create policy "orders_read" on public."orders" as permissive for select to authenticated using (((origin_code = ( SELECT jwt_branch() AS jwt_branch)) OR (fitter_code = ( SELECT jwt_branch() AS jwt_branch)) OR (collect_code = ( SELECT jwt_branch() AS jwt_branch)) OR (to_code = ( SELECT jwt_branch() AS jwt_branch)) OR (frame_at = ( SELECT jwt_branch() AS jwt_branch)) OR (( SELECT jwt_branch() AS jwt_branch) = ANY (stops)) OR ( SELECT is_admin() AS is_admin)));

create policy "orders_scheduler_read" on public."orders" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "orders_update" on public."orders" as permissive for update to authenticated using (((origin_code = ( SELECT jwt_branch() AS jwt_branch)) OR (fitter_code = ( SELECT jwt_branch() AS jwt_branch)) OR (collect_code = ( SELECT jwt_branch() AS jwt_branch)) OR (to_code = ( SELECT jwt_branch() AS jwt_branch)) OR (frame_at = ( SELECT jwt_branch() AS jwt_branch)) OR (( SELECT jwt_branch() AS jwt_branch) = ANY (stops)) OR ( SELECT is_admin() AS is_admin))) with check (((origin_code = ( SELECT jwt_branch() AS jwt_branch)) OR (fitter_code = ( SELECT jwt_branch() AS jwt_branch)) OR (collect_code = ( SELECT jwt_branch() AS jwt_branch)) OR (to_code = ( SELECT jwt_branch() AS jwt_branch)) OR (frame_at = ( SELECT jwt_branch() AS jwt_branch)) OR (( SELECT jwt_branch() AS jwt_branch) = ANY (stops)) OR ( SELECT is_admin() AS is_admin)));

create policy "outside_lens_orders_read" on public."outside_lens_orders" as permissive for select to authenticated using (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR (dest_code = ( SELECT jwt_branch() AS jwt_branch)) OR (( SELECT jwt_branch() AS jwt_branch) = ( SELECT outside_lens_handler() AS outside_lens_handler)) OR ( SELECT is_admin() AS is_admin) OR ( SELECT is_scheduler() AS is_scheduler)));

create policy "schedule_branches_all" on public."schedule_branches" as permissive for all to authenticated using (( SELECT can_schedule() AS can_schedule)) with check (( SELECT can_schedule() AS can_schedule));

create policy "schedule_defaults_read" on public."schedule_defaults" as permissive for select to authenticated using (( SELECT can_schedule() AS can_schedule));

create policy "schedule_employees_all" on public."schedule_employees" as permissive for all to authenticated using (( SELECT can_schedule() AS can_schedule)) with check (( SELECT can_schedule() AS can_schedule));

create policy "schedule_state_all" on public."schedule_state" as permissive for all to authenticated using (( SELECT can_schedule() AS can_schedule)) with check (( SELECT can_schedule() AS can_schedule));

create policy "schedule_weeks_all" on public."schedule_weeks" as permissive for all to authenticated using (( SELECT can_schedule() AS can_schedule)) with check (( SELECT can_schedule() AS can_schedule));

create policy "stock_events_all" on public."stock_request_events" as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM stock_requests r
  WHERE ((r.id = stock_request_events.request_id) AND ((r.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)))))) with check ((EXISTS ( SELECT 1
   FROM stock_requests r
  WHERE ((r.id = stock_request_events.request_id) AND ((r.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin))))));

create policy "stock_request_events_scheduler_read" on public."stock_request_events" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "stock_lines_all" on public."stock_request_lines" as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM stock_requests r
  WHERE ((r.id = stock_request_lines.request_id) AND ((r.branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)))))) with check ((EXISTS ( SELECT 1
   FROM stock_requests r
  WHERE ((r.id = stock_request_lines.request_id) AND (r.branch_code = ( SELECT jwt_branch() AS jwt_branch))))));

create policy "stock_request_lines_scheduler_read" on public."stock_request_lines" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "stock_requests_insert" on public."stock_requests" as permissive for insert to authenticated with check ((branch_code = ( SELECT jwt_branch() AS jwt_branch)));

create policy "stock_requests_read" on public."stock_requests" as permissive for select to authenticated using (((branch_code = ( SELECT jwt_branch() AS jwt_branch)) OR ( SELECT is_admin() AS is_admin)));

create policy "stock_requests_scheduler_read" on public."stock_requests" as permissive for select to authenticated using (( SELECT is_scheduler() AS is_scheduler));

create policy "stock_requests_update" on public."stock_requests" as permissive for update to authenticated using (( SELECT is_admin() AS is_admin)) with check (( SELECT is_admin() AS is_admin));

-- What the website's signed-in key may touch; the row rules above decide which rows.
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;
grant select on public.branches to anon;
reset check_function_bodies;
