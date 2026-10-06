-- ════════════════════════════════════════════════════════════════════════════
--  06 · orders: drop brand, model and lens
--  STATUS: NOT YET APPLIED — see the note below
--
--  Three columns left over from an earlier design where an order described the
--  frame as well as tracking it. Nothing ever wrote them: the composer asks for
--  a bill number and a customer name and that is all. So every row reads EMPTY
--  in the table editor, and the order list rendered a subtitle that was always
--  blank. A column nobody fills is not a spare field, it is a standing question
--  about whether something is missing.
--
--  The app has already stopped reading and writing them, so it behaves the same
--  whether or not this has run. Dropping a column cannot be undone, which is
--  why this is left for a deliberate hand rather than applied automatically.
--
--  Verified before writing this: all 6 rows were empty in all three columns.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders
  drop column if exists brand,
  drop column if exists model,
  drop column if exists lens;

-- `phone` and `note` are in the same position — never written, shown in the
-- drawer only when set, so always hidden. They are left alone for now because
-- unlike the three above, the drawer does have a place to put them.
