-- Nights nobody is cooking on.
--
-- A takeaway, a meal out, somebody else feeding us. Until now the plan had two
-- states for a night — a dish, or nothing — and "we're getting a curry on
-- Friday" had to be recorded as nothing. That is the same shape as a night
-- nobody has thought about yet, so the generator offered to fill it, the aside
-- counted it as an empty night, and the board said "Nothing planned" on a night
-- that was very much planned.
--
-- Attendance already answers the other question. A night nobody is home for is
-- not a skipped night; it is a night with no table. This is for a table with no
-- cooking.

alter table public.meal_plan_entries
  -- A night that is not being cooked has no recipe. This is the marker: a live
  -- entry with a null recipe_id is a skipped night, and there is no second
  -- column that could disagree with it about what the row is.
  alter column recipe_id drop not null;

alter table public.meal_plan_entries
  -- Why it is being skipped, as one of the tokens in app/utils/skip.ts —
  -- 'takeaway', 'out', 'someone_else', 'other'.
  --
  -- Text with no check constraint, for the same reason `meal` has none: the set
  -- is a product decision that will change, and a constraint would make adding
  -- 'freezer night' a migration that has to reach every device before any of
  -- them may write one. An unknown token reads as the plain "Not cooking", so a
  -- row from a newer client is legible on an older one rather than broken.
  --
  -- Null on a cooking night, and also tolerated on a skipped one.
  add column skip_reason text;

-- Nothing is backfilled. Every existing row has a recipe and is therefore a
-- night being cooked, which is what it always was.
