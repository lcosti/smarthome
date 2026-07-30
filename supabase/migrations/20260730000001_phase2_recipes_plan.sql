-- Phase 2: the recipe library, a manual weekly plan, and provenance from a plan
-- entry back to the shopping list items it generated.
--
-- Every convention from 20260729000001_init.sql applies unchanged:
--
--   1. Ids are minted on the device with crypto.randomUUID(), so a recipe can be
--      written in airplane mode and upserted later. No id defaults.
--   2. `updated_at` is set by the client, never by a trigger. It is the
--      last-write-wins comparison key.
--   3. Deletes are soft (`deleted_at`), so every queued mutation stays a plain
--      idempotent full-row upsert and there are no delete policies.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.recipes (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  source_url text,
  -- What the quantities below are written for. The plan stores its own servings
  -- per night; the difference between the two is shown as a "x2" hint rather
  -- than used to scale, because the quantities are free text.
  base_servings integer not null default 2,
  prep_minutes integer,
  cook_minutes integer,
  method text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_household_id_idx on public.recipes (household_id);

create table public.recipe_ingredients (
  id uuid primary key,
  -- Denormalised deliberately. RLS, the realtime publication and the per-household
  -- pull all key on household_id; reaching it through recipes would complicate
  -- every one of them for no gain.
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  -- Free text, like shopping_list_items.name. "chopped tomatoes" and "tinned
  -- tomatoes" are two rows until Phase 3 canonicalises them.
  name text not null,
  quantity text,
  aisle_id uuid references public.aisles(id) on delete set null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipe_ingredients_household_id_idx on public.recipe_ingredients (household_id);
create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);

create table public.meal_plan_entries (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  -- A calendar date, not an instant: Tuesday dinner is the same night whatever
  -- timezone the phone happens to be in. It also keeps this column out of the
  -- timestamp-format comparison that `updated_at` needs care with.
  date date not null,
  -- Dinner only for now. The column exists so that adding lunches later is a
  -- code change rather than a migration. No check constraint for the same reason.
  meal text not null default 'dinner',
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  servings integer not null,
  note text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meal_plan_entries_household_id_idx on public.meal_plan_entries (household_id);
create index meal_plan_entries_household_date_idx on public.meal_plan_entries (household_id, date);

-- There is deliberately NO unique (household_id, date, meal).
--
-- Two phones planning Tuesday while both offline mint two different ids for the
-- same night. A unique constraint would turn the second device's upsert into a
-- 23505, which the sync layer classifies as permanent: it burns five retries,
-- gets dropped, raises a toast, and leaves that device with a local row the
-- server has never seen. `onConflict` cannot rescue it either, because the
-- conflicting payload carries a different primary key.
--
-- Last-write-wins cannot enforce cross-row uniqueness, so we don't ask it to.
-- Duplicate nights render side by side and a person deletes one. One-per-night
-- is enforced in the UI by setNight(), which replaces rather than appends, and
-- tolerating duplicates means "main plus a side" works for free.

-- Provenance for derived items. Two columns rather than the one the init
-- migration anticipated: the pair (plan_entry_id, recipe_ingredient_id) IS the
-- identity of a derived item. Item ids are minted as uuidv5 of that pair, which
-- is what lets two devices derive the same week offline and converge on one row
-- instead of two. Losing the line id would break re-derivation on a fresh device.
--
-- `on delete set null` only matters for manual cleanup in psql, since the app
-- only ever soft-deletes; an orphaned item is tidied by the next derive.
alter table public.shopping_list_items
  add column plan_entry_id uuid references public.meal_plan_entries(id) on delete set null,
  add column recipe_ingredient_id uuid references public.recipe_ingredients(id) on delete set null;

create index shopping_list_items_plan_entry_id_idx
  on public.shopping_list_items (plan_entry_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.meal_plan_entries enable row level security;

create policy "member reads recipes" on public.recipes
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts recipes" on public.recipes
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates recipes" on public.recipes
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy "member reads recipe ingredients" on public.recipe_ingredients
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts recipe ingredients" on public.recipe_ingredients
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates recipe ingredients" on public.recipe_ingredients
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy "member reads plan entries" on public.meal_plan_entries
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts plan entries" on public.meal_plan_entries
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates plan entries" on public.meal_plan_entries
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

-- No delete policies, as in init.sql: deletion is `deleted_at`, which is an update.

grant select, insert, update on public.recipes to authenticated;
grant select, insert, update on public.recipe_ingredients to authenticated;
grant select, insert, update on public.meal_plan_entries to authenticated;

grant all on public.recipes to service_role;
grant all on public.recipe_ingredients to service_role;
grant all on public.meal_plan_entries to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.recipes;
alter publication supabase_realtime add table public.recipe_ingredients;
alter publication supabase_realtime add table public.meal_plan_entries;
