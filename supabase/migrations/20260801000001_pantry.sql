-- The pantry: what is already in the house, so the list stops asking for it.
--
-- A recipe wants one onion and onions come in threes. Two are left over, and
-- until now the app had no idea — so next week's list asked for another onion.
-- This closes that loop, which is the "minus pantry stock" the shopping list was
-- always meant to have.
--
-- Every convention from 20260729000001_init.sql applies unchanged:
--
--   1. Ids are minted on the device, so stock can be adjusted in airplane mode
--      and upserted later. No id defaults.
--   2. `updated_at` is set by the client, never by a trigger. It is the
--      last-write-wins comparison key.
--   3. Deletes are soft (`deleted_at`), so every queued mutation stays a plain
--      idempotent full-row upsert and there are no delete policies.
--
-- And the one that matters most here: there is deliberately NO unique constraint
-- on either table, for the reason set out in 20260730000001_phase2_recipes_plan.sql
-- — a 23505 is classified as a permanent error, so it burns its retries, gets
-- dropped, and leaves that device holding a row the server has never seen. Both
-- tables get uniqueness the way alias rows do instead: the primary key is a
-- uuidv5 of what identifies the row, so two devices writing the same fact mint
-- the same id and converge through the ordinary last-write-wins path.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.pantry_items (
  -- uuidv5(PANTRY_NAMESPACE, '<household>:<ingredient>'). See app/utils/pantry.ts.
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  -- How much is in the house, in the ingredient's own base_unit. Two onions is 2
  -- because onions are counted; half a bag of flour is 500 because flour is grams.
  --
  -- Written as a full-row snapshot and never as a delta, which is what keeps this
  -- safe under a queue that may replay. "Add two" replayed twice is four onions
  -- that do not exist; "it is now four" replayed twice is still four.
  on_hand numeric not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pantry_items_household_id_idx on public.pantry_items (household_id);
create index pantry_items_ingredient_id_idx on public.pantry_items (ingredient_id);

-- What a planned night has spoken for.
--
-- This exists because deriving a week is not a one-off. The button gets pressed
-- again every time somebody changes Thursday, and if deriving simply decremented
-- the pantry, the second press would spend the same onions twice. A reservation
-- is keyed on (plan entry, ingredient), so re-deriving rewrites the same row
-- rather than taking more — the same idea that makes derived list items safe.
--
-- Stock is not actually decremented at derive time either. The reservation just
-- says "this is spoken for" until its night has passed, at which point it is
-- settled: on_hand comes down once and settled_at is stamped so it can never
-- come down again. That ordering is what lets a plan change give the onions back
-- (the reservation is soft-deleted, released) right up until the night is cooked.
create table public.pantry_reservations (
  -- uuidv5(PANTRY_RESERVATION_NAMESPACE, '<plan entry>:<ingredient>').
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  plan_entry_id uuid not null references public.meal_plan_entries(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  -- Base units the night needs, already scaled for its servings.
  amount numeric not null,
  -- The night, denormalised off the plan entry so settlement is a scan of this
  -- table alone. A device that has not pulled meal_plan_entries yet can still
  -- settle correctly, and settling has to work offline like everything else.
  date date not null,
  -- Set once, when the night has passed and on_hand has been reduced for it.
  -- A settled row is frozen: never rewritten, never released, never counted again.
  settled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pantry_reservations_household_id_idx on public.pantry_reservations (household_id);
create index pantry_reservations_ingredient_id_idx on public.pantry_reservations (ingredient_id);
create index pantry_reservations_plan_entry_id_idx on public.pantry_reservations (plan_entry_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.pantry_items enable row level security;
alter table public.pantry_reservations enable row level security;

create policy "member reads pantry items" on public.pantry_items
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts pantry items" on public.pantry_items
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates pantry items" on public.pantry_items
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy "member reads pantry reservations" on public.pantry_reservations
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts pantry reservations" on public.pantry_reservations
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates pantry reservations" on public.pantry_reservations
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

-- No delete policies, as in init.sql: deletion is `deleted_at`, which is an update.

grant select, insert, update on public.pantry_items to authenticated;
grant select, insert, update on public.pantry_reservations to authenticated;

grant all on public.pantry_items to service_role;
grant all on public.pantry_reservations to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.pantry_items;
alter publication supabase_realtime add table public.pantry_reservations;
