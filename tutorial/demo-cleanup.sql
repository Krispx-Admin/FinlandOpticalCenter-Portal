-- ════════════════════════════════════════════════════════════════════════════
--  Remove everything the tutorial recording created
--
--  Run once the video is done (or between failed takes). Every record the tour
--  makes carries a DEMO- bill number, so this touches nothing else — except
--  the six demo shelf lines, which are removed by id, and the few names the
--  tour adds and normally removes again itself.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Lens requests first: they point at the orders they opened.
delete from public.lens_requests where note like 'DEMO-%';
delete from public.orders        where ref  like 'DEMO-%';
delete from public.claims        where bill_no like 'DEMO-%';

-- The stock request Seeb places in chapter 1.
delete from public.stock_requests
 where branch_code = 'SCC' and note = 'Weekend promotion';

-- The demo shelf, seeded before recording.
delete from public.lens_stock where id in (
  '32672a66-fa6c-45e7-ae45-523de6493abb',  -- Single vision 1.60 AR      SPH -2.50
  '14292ce9-28e0-405f-95ac-7584d4a47c1f',  -- Single vision 1.67 Blue-cut SPH -4.00
  '6dcfb51a-9ced-414e-919f-4272a28208c5',  -- Single vision 1.60 AR      SPH -1.75
  '53bef5a2-e218-428e-8a07-4a12793f6035',  -- Progressive 1.60 AR        SPH +1.50
  '51a98370-b3a3-41dd-8283-c5a12e7fd04f',  -- Bifocal 1.56 AR            SPH +2.25
  'd14540bd-3fe0-4d92-97ef-125de6fd623e'   -- Single vision 1.56 None    SPH -1.00
);

-- The tour adds these and takes them off again on camera. If a take stopped
-- half-way, they may still be there.
update public.lens_catalogue
   set indices = indices - '1.80', coatings = coatings - 'Anti-fog'
 where id = 1;

update public.app_settings
   set brand_groups = coalesce((
         select jsonb_agg(jsonb_set(g, '{brands}', (g -> 'brands') - 'Demo Optics') order by n)
           from jsonb_array_elements(brand_groups) with ordinality as x(g, n)
       ), '[]'::jsonb)
 where id = 1;

commit;
