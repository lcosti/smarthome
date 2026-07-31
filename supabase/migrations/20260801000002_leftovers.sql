-- Leftovers nights.
--
-- A real week rarely has seven distinct dinners. Sunday's chilli feeds Monday as
-- well, and until now the plan had no way to say so: a night needed its own
-- recipe entry, the generator refused to repeat a recipe within a week, and
-- planning the same recipe twice made the shopping list buy the ingredients
-- twice. People worked around it by leaving the night empty, which then reads as
-- "nothing planned" on the board and invites the generator to fill it.
--
-- One nullable column, pointing at the night the food was cooked on.

alter table public.meal_plan_entries
  -- The night this is leftovers of. Null on a normal night.
  --
  -- NO foreign key, unlike cook_person_id above. This is a self-reference within
  -- one table, and the sync layer pulls a table's rows in no particular order:
  -- a device can receive the leftovers night before the night it points at, and
  -- an upsert rejected with 23503 is classified permanent — it burns five
  -- retries, gets dropped, and leaves that device holding a row the server never
  -- saw. The same reasoning as the missing unique (household_id, date, meal) in
  -- 20260730000001: last-write-wins cannot enforce cross-row constraints, so we
  -- do not ask it to. A dangling reference is readable — the app falls back to
  -- the row's own recipe_id — and is tidied by the next edit.
  add column leftover_of_entry_id uuid;

-- recipe_id stays NOT NULL on these rows: a leftovers night carries its own copy
-- of the source's recipe. That copy is what makes a dangling reference harmless
-- (the night still shows a dish name), and it costs nothing, because the UI
-- prefers the source's recipe whenever the source is still there — so swapping
-- Sunday's dinner updates Monday's leftovers with no cascading write.

-- Not backfilled. Nothing that exists today is leftovers of anything, and null
-- already means "a normal night".
