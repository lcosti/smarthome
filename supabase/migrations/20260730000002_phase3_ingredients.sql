-- Phase 3: canonical ingredients, the aliases that resolve to them, and how each
-- one is bought — so that two recipes calling for tomatoes produce one line on the
-- shopping list instead of two.
--
-- Every convention from 20260729000001_init.sql applies unchanged:
--
--   1. Ids are minted on the device with crypto.randomUUID(), so an ingredient can
--      be created in airplane mode and upserted later. No id defaults.
--   2. `updated_at` is set by the client, never by a trigger. It is the
--      last-write-wins comparison key.
--   3. Deletes are soft (`deleted_at`), so every queued mutation stays a plain
--      idempotent full-row upsert and there are no delete policies.
--
-- What this migration deliberately does NOT do is aggregate anything. The list
-- keeps one row per (plan entry, recipe line) pair, because that row is the unit
-- last-write-wins already reconciles correctly. Combining them into "800g of
-- tomatoes" is a display concern, computed from these tables at render time and
-- never stored. See app/utils/aggregate.ts.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.ingredients (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  -- The unit everything about this ingredient is summed in. A closed set, so a
  -- check constraint is safe here in a way that a cross-row unique is not: it
  -- validates one row against a literal list, and the client only ever writes
  -- these three from a TypeScript union. Precedent is shopping_list_items.source.
  --
  -- 'count' is the default because most things are bought by the item, and it is
  -- the only honest answer when nothing in the recipe says otherwise.
  base_unit text not null default 'count' check (base_unit in ('g', 'ml', 'count')),
  -- Where this ingredient lives in the shop, once somebody has said so. Until now
  -- the aisle was re-inferred from the history of similarly named items every time
  -- (list.rememberedAisle). This makes it durable: file milk under Chilled once.
  aisle_id uuid references public.aisles(id) on delete set null,
  -- Set by a merge, alongside deleted_at: "this row turned out to be that row".
  --
  -- It exists so a merge needs no backfill. Rows all over the database still point
  -- at the loser, and readers follow this pointer to find the winner instead of the
  -- app having to rewrite them all — which matters because some of those rows live
  -- on a phone that is currently in a car park with no signal. Readers chase it
  -- with a depth cap; nothing here guarantees the graph is acyclic.
  merged_into uuid references public.ingredients(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingredients_household_id_idx on public.ingredients (household_id);

create table public.ingredient_aliases (
  id uuid primary key,
  -- Denormalised for the same reason as recipe_ingredients.household_id: RLS, the
  -- realtime publication and the per-household pull all key on it.
  household_id uuid not null references public.households(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  -- "tinned tomatoes", "canned tomatoes" -> one ingredient. Stored as typed; the
  -- client normalises for comparison rather than at rest, so the alias list still
  -- reads like something a person wrote.
  alias text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingredient_aliases_household_id_idx on public.ingredient_aliases (household_id);
create index ingredient_aliases_ingredient_id_idx on public.ingredient_aliases (ingredient_id);

create table public.ingredient_purchase_units (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  -- Singular, as it is written on a shelf: 'tin', 'pack', 'bunch'.
  name text not null,
  -- How much of the ingredient's base unit one of them holds. A 400g tin is 400.
  -- This is what turns a sum of 800g into "2 tins", which is the only form of the
  -- number anybody can act on while standing in an aisle.
  amount numeric not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingredient_purchase_units_household_id_idx
  on public.ingredient_purchase_units (household_id);
create index ingredient_purchase_units_ingredient_id_idx
  on public.ingredient_purchase_units (ingredient_id);

-- There is deliberately NO unique constraint on ingredients (household_id, name),
-- nor on ingredient_aliases (household_id, alias), for the reason set out at
-- length in 20260730000001_phase2_recipes_plan.sql: a 23505 is classified as a
-- permanent error, so it burns five retries, gets dropped with a toast, and leaves
-- that device holding a row the server has never seen. `onConflict` cannot rescue
-- it, because the conflicting payload carries a different primary key.
--
-- Two phones both typing "tomatoes" offline therefore create two canonical rows.
-- That is handled where it can be handled honestly:
--
--   - Resolution is deterministic. On a normalised-name tie every device picks the
--     same winner (oldest created_at, then lowest id), so typing resolves the same
--     way everywhere even before anybody tidies up.
--   - Alias ids are uuidv5 of (household, ingredient, normalised alias), so two
--     devices recording the same alias mint the same row and converge through the
--     ordinary last-write-wins path — the same trick derived item ids use.
--   - The loser stays visible on /ingredients until a person merges it, which is
--     one tap and needs no backfill thanks to merged_into.

-- The link from free text to a canonical ingredient. Nullable, and stays nullable:
-- an unresolved line is not broken, it just does not aggregate. Nothing about
-- Phase 2 stops working because a line has no ingredient yet, and existing
-- libraries resolve opportunistically as lines are next touched — there is no
-- backfill here, on purpose.
alter table public.recipe_ingredients
  add column ingredient_id uuid references public.ingredients(id) on delete set null;

create index recipe_ingredients_ingredient_id_idx
  on public.recipe_ingredients (ingredient_id);

-- Stamped onto the item when it is derived, rather than chased through
-- recipe_ingredient_id at read time. Three reasons, in order of how much they
-- matter:
--
--   1. Ad-hoc items have no recipe line to chase, and "milk" typed onto the list
--      should join the milk the plan already asked for.
--   2. Grouping has to work from item rows alone, so that it works offline on a
--      device that has not pulled recipes yet.
--   3. A checked item is frozen by design. Freezing what it was grouped as keeps
--      "2 tins of tomatoes, bought" from silently refiling itself under something
--      else because a recipe line was re-pointed at home.
alter table public.shopping_list_items
  add column ingredient_id uuid references public.ingredients(id) on delete set null;

create index shopping_list_items_ingredient_id_idx
  on public.shopping_list_items (ingredient_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.ingredients enable row level security;
alter table public.ingredient_aliases enable row level security;
alter table public.ingredient_purchase_units enable row level security;

create policy "member reads ingredients" on public.ingredients
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts ingredients" on public.ingredients
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates ingredients" on public.ingredients
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy "member reads ingredient aliases" on public.ingredient_aliases
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts ingredient aliases" on public.ingredient_aliases
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates ingredient aliases" on public.ingredient_aliases
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy "member reads ingredient purchase units" on public.ingredient_purchase_units
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts ingredient purchase units" on public.ingredient_purchase_units
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates ingredient purchase units" on public.ingredient_purchase_units
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

-- No delete policies, as in init.sql: deletion is `deleted_at`, which is an update.

grant select, insert, update on public.ingredients to authenticated;
grant select, insert, update on public.ingredient_aliases to authenticated;
grant select, insert, update on public.ingredient_purchase_units to authenticated;

grant all on public.ingredients to service_role;
grant all on public.ingredient_aliases to service_role;
grant all on public.ingredient_purchase_units to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.ingredients;
alter publication supabase_realtime add table public.ingredient_aliases;
alter publication supabase_realtime add table public.ingredient_purchase_units;
