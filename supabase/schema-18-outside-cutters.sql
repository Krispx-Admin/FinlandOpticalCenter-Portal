-- ════════════════════════════════════════════════════════════════════════════
--  18 · Fitting Log: sending a frame Outside, to a 3rd-party cutter
--  STATUS: applied 2026-10-12 (by Claude)
--
--  orders.outside_cutter  — the 3rd-party cutter the frame went to; null for
--                           every frame that stays with our own fitting
--                           centres. An outside order keeps fitter_code null.
--                           Its road: lenses_in -> to_fitter ("At <cutter>")
--                           -> delivered ("Received back"), every step done
--                           by the origin branch (the cutter has no account).
--  app_settings.outside_cutters — the cutters offered in "Send to fitter",
--                           edited by the office in Settings › Fitting Log.
--                           Empty: the picker offers one "Outside cutter".
--  No policy changes: the origin branch may already update its own orders,
--  and app_settings is already readable by all and writable by the office.
--  Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists outside_cutter text;

alter table public.app_settings
  add column if not exists outside_cutters jsonb not null default '[]'::jsonb;
