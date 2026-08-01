-- The grants 20260731000001_recipe_steps.sql forgot.
--
-- That migration created the table, enabled RLS and wrote all three policies —
-- and never granted the privileges the policies sit on top of. Postgres checks
-- table privileges before it consults RLS, so `authenticated` was refused at the
-- door: every select came back 42501, "permission denied for table
-- recipe_steps", and the policies were never reached. Correct policies on a table
-- nobody may touch look exactly like working ones until something reads it.
--
-- What that cost, because it is worth recording: `pull` fetches every synced
-- table in one Promise.all and treats any error as the server being unreachable,
-- so one denied table took the whole app offline. The header read
-- "Offline · last synced ..." with a time that never moved, nothing arrived from
-- the server on any device, and every write banked up in the queue — for a
-- database that was up the entire time and answering all fourteen other tables.
-- The failure was silent because it was indistinguishable from bad signal, which
-- is the one thing this app is designed to shrug off.
--
-- Identical to the grants recipe_ingredients gets in
-- 20260730000001_phase2_recipes_plan.sql, which is what a step should have had
-- from the start: the two tables are the same shape and the same migration
-- comment says so. No delete for `authenticated` — deletion here is soft, an
-- update setting deleted_at, so nothing needs the privilege. `anon` is granted
-- nothing, as everywhere else: an unauthenticated client only ever talks to
-- /auth.

grant select, insert, update on public.recipe_steps to authenticated;

grant all on public.recipe_steps to service_role;
