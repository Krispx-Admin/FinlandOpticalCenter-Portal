-- ════════════════════════════════════════════════════════════════════════════
--  17 · Tabs the office has switched off ("under maintenance")
--  STATUS: applied 2026-10-11 (by Claude)
--
--  app_settings.disabled_tabs holds the keys of the sidebar tabs the office has
--  switched off in Settings — e.g. ["lens", "direct"]. The keys are the app's
--  module names: fitting, stock, lens, claims, direct, schedule. Branches see a
--  switched-off tab greyed out with "— under maintenance" and cannot open it;
--  the office still can. app_settings is already readable by everyone signed
--  in, writable only by the office, and on realtime, so the sidebar changes
--  for everyone the moment the office flips a switch. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.app_settings
  add column if not exists disabled_tabs jsonb not null default '[]'::jsonb;
