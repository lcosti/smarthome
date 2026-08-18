-- Recipe adaptations: amendments on the base recipe for whoever at the table
-- needs them — a weaning baby, a toddler, an adult on a named diet.
--
-- The brief has promised this from the start ("an adult portion, a 3-year-old's
-- version, a weaning baby's version — same cooking session, different plates")
-- and sketched the table as (recipe_id, life_stage, guidance text). It lands as
-- two tables rather than one because the guidance turned out to be structured:
-- "swap the yoghurt", "at step 3 set the baby's portion aside" point at a
-- specific ingredient line or a specific step, and cook mode wants to draw the
-- amendment on the exact line it amends. Free-floating advice that targets
-- nothing lives in the adaptation's own note.
--
-- Nothing here is baked into the recipe. The base recipe stays the family meal;
-- an adaptation is a separate row that can change, or retire, without touching
-- it — and life-stage adaptations retire on their own, because the audience is
-- matched against ages derived from date_of_birth at read time (decision #3:
-- life stage is never stored on a person).

-- ---------------------------------------------------------------------------
-- A person can be on a named diet
-- ---------------------------------------------------------------------------

-- A fifth constraint kind. 'diet' is an audience label for adaptations ("high
-- protein"), not a scoring signal: unlike the four existing kinds it is neither
-- a hard filter nor a soft preference, and the generator deliberately ignores
-- it — a macro goal matched against ingredient names would match nonsense. The
-- client's constraint id (uuidv5 of household/person/kind/tag) already covers
-- any kind string, so nothing else changes shape.

alter table public.dietary_constraints
  drop constraint dietary_constraints_kind_check;
alter table public.dietary_constraints
  add constraint dietary_constraints_kind_check
  check (kind in ('allergy', 'intolerance', 'dislike', 'preference', 'diet'));

-- ---------------------------------------------------------------------------
-- The adaptation: one per (recipe, audience)
-- ---------------------------------------------------------------------------

create table public.recipe_adaptations (
  -- uuidv5 of (household, recipe, audience) — the dietary_constraints trick, for
  -- the same reason: both parents writing the weaning version of the same recipe
  -- while offline must converge on one row through last-write-wins, not trip a
  -- unique constraint, because 23505 is a permanent sync error that drops the
  -- write.
  id uuid primary key,
  -- Denormalised like every recipe child: RLS, realtime and the per-household
  -- pull all key on household_id.
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  -- Exactly one of these names the audience. 'baby' is deliberately absent from
  -- the stages: a pre-weaning baby is at the table and eating nothing off it,
  -- so there is nothing to adapt. The diet tag is stored normalised (trimmed,
  -- lowercased, whitespace collapsed) so it compares equal to a person's
  -- constraint tag however either was typed.
  life_stage text check (life_stage in ('weaning', 'toddler', 'child', 'adult')),
  diet_tag text,
  -- Guidance that targets no particular line or step: "portion before
  -- seasoning", "add a splash of milk to theirs".
  note text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((life_stage is null) <> (diet_tag is null))
);

create index recipe_adaptations_household_id_idx on public.recipe_adaptations (household_id);
create index recipe_adaptations_recipe_id_idx on public.recipe_adaptations (recipe_id);

-- ---------------------------------------------------------------------------
-- The overrides: rows against a line or a step
-- ---------------------------------------------------------------------------

-- One table with a kind column rather than two tables. The two shapes differ by
-- one foreign key, and a second table would double the sync plumbing for no
-- reader's benefit; the kind-dependent checks below keep a row honest about
-- which shape it is.

create table public.recipe_adaptation_items (
  -- Minted by the client like a step's: many per adaptation, no natural key.
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  adaptation_id uuid not null references public.recipe_adaptations(id) on delete cascade,
  -- Denormalised so a recipe's whole adaptation picture is one read per table,
  -- not a walk through adaptation ids.
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  kind text not null check (kind in ('ingredient', 'step')),
  -- The line or step being amended. A cascade delete here is safe because the
  -- app never hard-deletes either target; if a line's row were ever truly
  -- removed, an override of it means nothing anyway. Display skips items whose
  -- target is soft-deleted.
  recipe_ingredient_id uuid references public.recipe_ingredients(id) on delete cascade,
  recipe_step_id uuid references public.recipe_steps(id) on delete cascade,
  -- Ingredient overrides only. swap: body is the replacement; omit / reduce:
  -- body is optional detail ("just a pinch for theirs").
  action text check (action in ('swap', 'omit', 'reduce')),
  -- For a step amendment, the amendment itself.
  body text not null default '',
  -- Sparse, like a step's: nothing reads the values, only their order.
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'ingredient' or (recipe_ingredient_id is not null and action is not null and recipe_step_id is null)),
  check (kind <> 'step' or (recipe_step_id is not null and action is null and recipe_ingredient_id is null))
);

create index recipe_adaptation_items_household_id_idx on public.recipe_adaptation_items (household_id);
create index recipe_adaptation_items_recipe_id_idx on public.recipe_adaptation_items (recipe_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.recipe_adaptations enable row level security;

create policy "member reads recipe adaptations" on public.recipe_adaptations
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts recipe adaptations" on public.recipe_adaptations
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates recipe adaptations" on public.recipe_adaptations
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

alter table public.recipe_adaptation_items enable row level security;

create policy "member reads adaptation items" on public.recipe_adaptation_items
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts adaptation items" on public.recipe_adaptation_items
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates adaptation items" on public.recipe_adaptation_items
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

-- No delete policy on either table, as everywhere else: removal is deleted_at.

-- The grants the policies sit on top of — the lesson of
-- 20260801000006_recipe_steps_grants.sql, where their absence took the whole
-- app offline. No delete for authenticated; anon gets nothing.

grant select, insert, update on public.recipe_adaptations to authenticated;
grant all on public.recipe_adaptations to service_role;

grant select, insert, update on public.recipe_adaptation_items to authenticated;
grant all on public.recipe_adaptation_items to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.recipe_adaptations;
alter publication supabase_realtime add table public.recipe_adaptation_items;
