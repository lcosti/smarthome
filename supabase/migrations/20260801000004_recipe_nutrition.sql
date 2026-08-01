-- Per-serving nutrition, when the source printed it.
--
-- Recipe sites publish a schema.org NutritionInformation node the URL importer
-- was already holding in memory and throwing away; cookbook pages print the same
-- panel next to the method. This keeps what they said — kcal and the seven gram
-- figures a UK label carries — so the recipe page can show it and a person can
-- correct or complete it by hand.
--
-- Capture and display only. This is not nutrition tracking: nothing sums across
-- a plan, counts a day, or sets a target — that remains out of scope. The
-- generator does not read these columns either; a nutrition-aware preference
-- ("high protein") is a later decision, taken once real data exists.
--
-- Eight scalar columns rather than one jsonb, on the prep_minutes precedent:
-- the generated types then say `number | null` and every consumer gets a typed
-- field instead of a cast, at the cost of a wider alter — cheap, since the row
-- is upserted whole anyway. All figures are per serving, because that is how
-- every source publishes them and base_servings already names the divisor.
-- Null means "the source didn't say", never zero.
--
-- Conventions from 20260729000001_init.sql are unchanged: the client sets
-- `updated_at` and the whole row is upserted, so a hand-typed correction offline
-- queues as an ordinary last-write-wins snapshot. RLS is inherited from the
-- recipes policies — these are columns on a household-scoped row, not a surface.

alter table public.recipes
  add column kcal numeric,
  add column fat_g numeric,
  add column saturates_g numeric,
  add column carbs_g numeric,
  add column sugars_g numeric,
  add column fibre_g numeric,
  add column protein_g numeric,
  add column salt_g numeric;

comment on column public.recipes.kcal is
  'Energy per serving, as the source printed it. Written by the importers (supabase/functions/_shared/jsonld.ts and RECIPE_SCHEMA) and editable on the recipe page; the field list lives in app/utils/nutrition.ts.';

-- No index, and no check constraints. A household library is tens of rows read
-- whole into memory, and the client coerces these to finite non-negative numbers
-- at its own boundary (app/utils/recipe-import.ts) before anything is committed.
