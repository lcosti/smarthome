-- Recipe method as steps rather than as one block of prose.
--
-- `recipes.method` was doing two jobs badly. The page labels it Notes and its
-- placeholder asks for "anything worth remembering next time", but every import
-- had nowhere else to put the instructions, so the method landed there and buried
-- the notes. Meanwhile both ends of the app already believed in steps and only
-- the middle did not: the board splits the blob on blank lines to number it, and
-- the JSON-LD reader builds a proper array from schema.org HowToStep objects and
-- then throws the structure away with a join.
--
-- So this is less a new idea than the removal of a lossy round trip. Steps become
-- rows, `method` goes back to meaning notes.
--
-- The table is deliberately a near-copy of recipe_ingredients: same denormalised
-- household_id, same sort_order, same soft delete. A recipe's steps and a recipe's
-- ingredients are the same kind of thing — an ordered list of short strings people
-- reorder — and the client's reorder, sync and pull all already know that shape.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.recipe_steps (
  -- Minted by the client, like every other row it writes: an offline insert has
  -- to know its own id before it can queue.
  id uuid primary key,
  -- Denormalised for the same reason as recipe_ingredients — RLS, the realtime
  -- publication and the per-household pull all key on household_id, and reaching
  -- it through recipes would complicate every one of them for no gain.
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  -- One step. Prose, not a title plus a body: a step is a thing you do, and
  -- splitting it into a heading and detail is a structure nobody maintains.
  body text not null,
  -- Sparse on purpose. Reordering swaps two rows' values rather than renumbering
  -- the list, so a move is two writes whoever else is editing, and gaps left by
  -- the backfill below cost nothing.
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipe_steps_household_id_idx on public.recipe_steps (household_id);
create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id);

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

-- No delete policy, as everywhere else: removal is `deleted_at`, which is an
-- update, which is what lets a device that was offline for the deletion learn
-- about it on the next pull instead of seeing the row reappear.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.recipe_steps;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Split what is already there on blank lines — the exact rule the board has been
-- using to number these since it was built, so every existing recipe comes out of
-- this migration looking the way it already looked on the wall.
--
-- `with ordinality` numbers the parts before the empty ones are dropped, so
-- sort_order can skip a number. That is fine and is why the column is sparse:
-- nothing reads the values, only their order.
insert into public.recipe_steps (id, household_id, recipe_id, body, sort_order, created_at, updated_at)
select gen_random_uuid(), r.household_id, r.id, part.body, part.ord, r.created_at, now()
from public.recipes r
cross join lateral unnest(regexp_split_to_array(r.method, E'\n[[:space:]]*\n'))
  with ordinality as part(body, ord)
where r.method is not null
  and btrim(part.body) <> '';

-- A recipe whose method became steps must not also show that method as its notes,
-- or every imported recipe reads twice. Only cleared where something was actually
-- extracted, so a method that was pure whitespace is left alone rather than
-- silently discarded — and the text is recoverable from this file's history in
-- either case, because the split is deterministic.
update public.recipes r
set method = null, updated_at = now()
where r.method is not null
  and exists (select 1 from public.recipe_steps s where s.recipe_id = r.id);
