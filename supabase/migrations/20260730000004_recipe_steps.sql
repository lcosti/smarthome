-- Recipe steps: the method as an ordered list of rows rather than a wall of text
-- in `recipes.method`.
--
-- Until now everything a recipe told you to do lived in one textarea labelled
-- Notes. That is fine to write and miserable to cook from — you lose your place
-- on a phone propped against the kettle, you cannot reorder anything, and an
-- imported recipe arrives as an undifferentiated blob. Steps are the unit people
-- actually work in, so they get to be rows.
--
-- Rows rather than a json array on `recipes` for the reason everything else here
-- is rows: last-write-wins compares whole rows. Two people tidying different
-- steps of the same recipe on different devices both keep their edit; a json
-- column would make the later write clobber the earlier one wholesale.
--
-- Every convention from 20260729000001_init.sql applies unchanged:
--
--   1. Ids are minted on the device with crypto.randomUUID(), so a step can be
--      written in airplane mode and upserted later. No id default.
--   2. `updated_at` is set by the client, never by a trigger. It is the
--      last-write-wins comparison key.
--   3. Deletes are soft (`deleted_at`), so every queued mutation stays a plain
--      idempotent full-row upsert and there are no delete policies.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.recipe_steps (
  id uuid primary key,
  -- Denormalised for the same reason as recipe_ingredients.household_id: RLS,
  -- the realtime publication and the per-household pull all key on it.
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  -- One instruction, as prose. Not split into sub-fields (temperature, minutes,
  -- equipment): a step is read by a person mid-cook, and structure nobody fills
  -- in is structure that gets in the way of typing "simmer until it looks right".
  text text not null,
  -- Same ordering scheme as recipe_ingredients: a gapped integer that reordering
  -- swaps between neighbours, so a move is two row writes and nothing renumbers.
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipe_steps_household_id_idx on public.recipe_steps (household_id);
create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id);

-- ---------------------------------------------------------------------------
-- Backfill: the methods already written as notes
-- ---------------------------------------------------------------------------

-- Every recipe imported before this migration has its method sitting in
-- `recipes.method`, which is exactly the problem being fixed. Split it here so
-- the library arrives already stepped rather than needing 20 recipes opened by
-- hand.
--
-- The split is deliberately conservative: paragraphs if the text has any, else
-- lines. A method that yields only one part is left completely alone — its notes
-- stay put, and the app offers a smarter split (it also understands "1) … 2) …"
-- run together on one line) on the recipe page for whoever opens it next. Better
-- to under-migrate and leave a button to press than to mangle a paragraph.
--
-- `method` is then cleared on the recipes that were split, because the text has
-- moved rather than been copied — leaving it would show the same prose twice.
-- Bumping `updated_at` is what makes offline devices accept the change on their
-- next pull. A device holding an unsynced edit to one of these recipes would
-- push its old method back; with four users and a one-off migration, that is a
-- fair trade against carrying the duplication forever.

with part as (
  select
    r.id as recipe_id,
    r.household_id,
    p.position,
    -- "1. ", "2) ", "Step 3:" — the app numbers steps itself, so a number
    -- carried over from the page would render as "1  1. Soak the rice".
    -- Punctuation after the digits is required, or "400g flour" would lose
    -- its quantity.
    trim(regexp_replace(p.text, '^\s*(?:step\s+)?\d{1,2}\s*[.):]\s+', '', 'i')) as text
  from public.recipes r
  cross join lateral unnest(
    case
      when r.method ~ '\n[ \t]*\n' then regexp_split_to_array(r.method, '\n[ \t]*\n')
      else regexp_split_to_array(r.method, '\n')
    end
  ) with ordinality as p(text, position)
  where r.method is not null and r.deleted_at is null
),
kept as (
  select * from part where text <> ''
),
splittable as (
  select recipe_id from kept group by recipe_id having count(*) > 1
)
insert into public.recipe_steps (id, household_id, recipe_id, text, sort_order)
select gen_random_uuid(), k.household_id, k.recipe_id, k.text, k.position
from kept k
join splittable s on s.recipe_id = k.recipe_id;

update public.recipes r
set method = null, updated_at = now()
where exists (select 1 from public.recipe_steps s where s.recipe_id = r.id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.recipe_steps enable row level security;

create policy "member reads recipe steps" on public.recipe_steps
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts recipe steps" on public.recipe_steps
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates recipe steps" on public.recipe_steps
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

-- No delete policy, as everywhere else: deletion is `deleted_at`, an update.

grant select, insert, update on public.recipe_steps to authenticated;
grant all on public.recipe_steps to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.recipe_steps;
