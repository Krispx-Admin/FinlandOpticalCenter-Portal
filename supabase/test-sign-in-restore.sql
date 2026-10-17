-- ── TEST SIGN-IN: put the real branch codes back ──
-- 2026-10-17 the user asked for the codes out while testing: every branch was
-- set to the one code js/app.js fills in (TEST_SIGN_IN), after a sealed copy
-- of each branch's code (the stored hash only) went into
-- foc_private.code_backup. The people (Omar, Ghiath, Wijdan, Sarah) were never
-- changed.
--
-- To end testing:
--   1. js/app.js: TEST_SIGN_IN = ''  — publish.
--   2. Run this. Each branch gets its real code back; the copy is then dropped.
-- A branch added during testing has no copy: the office gives it a code in
-- Settings → Accounts.
begin;
update auth.users u set encrypted_password = c.encrypted_password
  from foc_private.code_backup c
 where u.id = c.user_id;
drop table foc_private.code_backup;
drop schema foc_private;
commit;
