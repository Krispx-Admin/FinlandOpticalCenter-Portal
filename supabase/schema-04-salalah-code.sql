-- ════════════════════════════════════════════════════════════════════════════
--  04 · Salalah Shop: SLS → SAL
--  STATUS: applied
--
--  The branch code is three things at once: the primary key every record
--  points at, the branch_code claim inside the JWT that every RLS policy reads,
--  and the local part of the sign-in address the app derives from it. Renaming
--  it means moving all three together, which is why this is one transaction.
--
--  Safe to run once. No rows referenced SLS when it ran, so the foreign keys
--  (NO ACTION, not CASCADE) had nothing to object to. The six-digit code is the
--  account's password and is untouched — Salalah signs in exactly as before.
-- ════════════════════════════════════════════════════════════════════════════

begin;

update public.branches
   set code = 'SAL'
 where code = 'SLS';

-- The claim the policies read, and the address auth.js builds from the code.
update auth.users
   set email             = 'sal@finlandoptical.om',
       raw_app_meta_data = jsonb_set(raw_app_meta_data, '{branch_code}', '"SAL"')
 where raw_app_meta_data->>'branch_code' = 'SLS';

-- GoTrue resolves an email sign-in through the identity row, so it has to move
-- with the user or the address stops matching anything.
update auth.identities
   set identity_data = jsonb_set(identity_data, '{email}', '"sal@finlandoptical.om"')
 where provider = 'email'
   and identity_data->>'email' = 'sls@finlandoptical.om';

commit;
