-- Which meals a recipe suits.
--
-- The plan grew breakfast and lunch alongside dinner, and the editor's recipe
-- list did not: opening Tuesday's breakfast offers the same alphabetical library
-- as Tuesday's dinner, so finding porridge means scrolling past every casserole
-- the house owns. This is the fact that fixes it, and it is a fact about the
-- recipe rather than about any night.
--
-- Stored rather than derived, which is the opposite of the call
-- buildRecipeLibrary makes for every other facet in app/utils/board.ts — quick,
-- big batch, on the plan, never cooked. Those are all things the app already
-- knows from what has happened. This one is not: deriving "is a breakfast" from
-- what a recipe has been planned as is circular for the case that matters, since
-- a recipe added this morning has been planned as nothing, and the whole point is
-- to find it in a list before you have ever used it. One mis-planned lunch would
-- also label it for good, with nowhere to say otherwise.
--
-- Three booleans rather than one text[] of meals, on the precedent
-- 20260801000004_recipe_nutrition.sql set for the same choice: the generated
-- types then say `boolean` and every consumer gets a typed field instead of an
-- array of strings it has to check against a union at runtime. It also keeps the
-- row a flat record of primitives, which is what plainCopy in app/utils/sync.ts
-- documents itself as copying — chores.weekdays is the one array in this schema
-- and it has to be rebuilt by hand before every commit to stay clear of the
-- reactive proxy. A wider alter is cheap; the row is upserted whole anyway.
--
-- All three default false, and **false everywhere means no opinion, not "suits
-- nothing"**. That is what makes this safe to land against a library nobody has
-- labelled: an untagged recipe goes on being offered at every slot exactly as it
-- is today, and labelling is something you do to the handful of recipes where it
-- earns its keep. There is deliberately no backfill to `suits_dinner = true` —
-- every recipe in the library was added when dinner was the only meal, so the
-- column would be recording an assumption of this migration rather than anything
-- a person said, and it would sink every one of them out of the breakfast list.
--
-- Nothing hides. The editor orders its list by this rather than filtering on it
-- (see PlanNightEditor.vue): a recipe labelled for dinner is still reachable at
-- breakfast, still findable by typing its name, just no longer first. A filter
-- would make a label a thing you could regret.
--
-- Conventions from 20260729000001_init.sql are unchanged: the client sets
-- `updated_at` and upserts the whole row, so ticking one of these offline queues
-- as an ordinary last-write-wins snapshot. RLS is inherited from the recipes
-- policies — these are columns on a household-scoped row, not a surface.

alter table public.recipes
  add column suits_breakfast boolean not null default false,
  add column suits_lunch boolean not null default false,
  add column suits_dinner boolean not null default false;

comment on column public.recipes.suits_breakfast is
  'Somebody said this is a breakfast. All three false means no opinion, and such a recipe is offered at every meal — see suitsMeal and mealFitRank in app/utils/meal.ts, which are what the plan''s recipe list orders by.';

comment on column public.recipes.suits_lunch is
  'Somebody said this is a lunch. See recipes.suits_breakfast for what all-false means.';

comment on column public.recipes.suits_dinner is
  'Somebody said this is a dinner. See recipes.suits_breakfast for what all-false means.';

-- No index. A household library is tens of rows, every device holds all of them
-- in memory, and these are only ever read by sorting that array.
