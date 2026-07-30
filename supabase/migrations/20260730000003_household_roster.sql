-- Phase 4, part one: the roster. Who is in the household, what they cannot or
-- will not eat, and who is home each night.
--
-- These are the generator's inputs, built ahead of the generator itself. Until
-- now `people` held exactly the adults who had signed in, because the only rows
-- ever written were the ones create_household and join_household insert. A
-- household with a three-year-old and a weaning baby could not be described at
-- all, which makes "adapt one family meal per person present" unbuildable.
--
-- Every convention from 20260729000001_init.sql applies unchanged:
--
--   1. Ids are minted on the device with crypto.randomUUID(), or derived with
--      uuidv5 where two devices must agree on one. No id defaults on the new
--      tables.
--   2. `updated_at` is set by the client, never by a trigger. It is the
--      last-write-wins comparison key.
--   3. Deletes are soft (`deleted_at`), so every queued mutation stays a plain
--      idempotent full-row upsert and there are no delete policies.

-- ---------------------------------------------------------------------------
-- people becomes client-writable
-- ---------------------------------------------------------------------------

-- The two columns the offline layer needs to treat people like any other synced
-- table. Existing rows backfill to now(), which is honest: that is the moment
-- they became syncable, and nothing has ever edited them before.
alter table public.people
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz;

-- `id` keeps its gen_random_uuid() default because the bootstrap functions rely
-- on it. Client inserts simply supply their own id, as everywhere else.

-- Deliberately plain member policies, with no `auth_user_id is null` guard on the
-- insert path, tempting as one is: the queue replays full-row upserts, and an
-- upsert of an existing adult is evaluated against the INSERT policy's WITH CHECK
-- too. A guard would turn renaming an adult into a 42501, which the drain
-- classifies as permanent — five retries, a toast, and a device left holding a row
-- the server never saw.
--
-- So the rule lives where it can be enforced without breaking sync: the store
-- refuses to soft-delete a person who holds a login, and these RPCs remain the
-- only path that ever *links* one. Four trusted adults; the theoretical ability
-- to write auth_user_id by hand is accepted.
create policy "member inserts people" on public.people
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates people" on public.people
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

grant insert, update on public.people to authenticated;

-- is_member() deliberately ignores deleted_at, so even a mistaken soft-delete
-- cannot lock a signed-in adult out of their own household.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.dietary_constraints (
  -- uuidv5 of (household, person, kind, normalised tag). Two parents who both
  -- record the peanut allergy while offline mint one row, not two, and converge
  -- through the ordinary last-write-wins path — the same trick alias ids use, and
  -- the same reason: no cross-row unique can be added without making a duplicate
  -- a permanent sync error. See the note in 20260730000002_phase3_ingredients.sql.
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  -- The split the generator turns on, and the reason this is one table and not a
  -- flat list of tags: allergy and intolerance are hard filters that a plan must
  -- never violate, dislike and preference are soft scoring penalties. A closed
  -- set, so a check constraint is safe here in the way a unique is not — it
  -- validates one row against a literal list, and the client only writes these
  -- four from a TypeScript union.
  kind text not null check (kind in ('allergy', 'intolerance', 'dislike', 'preference')),
  -- Free text, stored as typed. Phase 3 canonicalised *ingredients*; a constraint
  -- is broader than an ingredient ("nuts", "shellfish", "anything spicy") so it
  -- does not resolve to one, and the generator matches it by normalised text
  -- against recipe ingredient names.
  tag text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dietary_constraints_household_id_idx
  on public.dietary_constraints (household_id);
create index dietary_constraints_person_id_idx
  on public.dietary_constraints (person_id);

create table public.attendance (
  -- uuidv5 of (household, person, date, meal), for the same convergence reason as
  -- above: two phones toggling the same cell of the same week must land on one row.
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  date date not null,
  -- Matches meal_plan_entries.meal, and unconstrained for the same reason: dinner
  -- is the only meal the app writes today, and adding lunches should be a code
  -- change rather than a migration.
  meal text not null default 'dinner',
  -- The contract, which the whole design rests on: NO ROW MEANS PRESENT. A row
  -- exists only once somebody has said otherwise, and toggling back to present is
  -- an update setting this true, never a delete.
  --
  -- Absence is the exception — most nights everybody is home — so materialising
  -- seven rows per person per week would be a lot of writes to say nothing. It
  -- also means a newly added baby, or next week, needs zero rows before the
  -- generator can read the roster correctly. The generator computes "present for
  -- (date, meal)" as every live person minus the rows where present is false.
  --
  -- Keeping a toggle-back as an update rather than a delete matters for
  -- last-write-wins: a row that flips false, true, false across two phones lands
  -- wherever the latest updated_at says, which is what the person tapping expects.
  -- A delete would make "present" indistinguishable from "never asked".
  present boolean not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index attendance_household_id_idx on public.attendance (household_id);
create index attendance_person_id_idx on public.attendance (person_id);
-- The roster is always read a week at a time.
create index attendance_household_date_idx on public.attendance (household_id, date);

-- There is deliberately NO unique on attendance (household_id, person_id, date,
-- meal), nor on dietary_constraints (household_id, person_id, kind, tag). The
-- deterministic ids above make a duplicate structurally impossible instead, which
-- is strictly better offline: a unique violation is a permanent error that drops
-- the write, and `onConflict` cannot rescue it because the conflicting payload
-- carries a different primary key.

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.dietary_constraints enable row level security;
alter table public.attendance enable row level security;

create policy "member reads dietary constraints" on public.dietary_constraints
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts dietary constraints" on public.dietary_constraints
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates dietary constraints" on public.dietary_constraints
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy "member reads attendance" on public.attendance
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts attendance" on public.attendance
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates attendance" on public.attendance
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

-- No delete policies, as everywhere else: deletion is `deleted_at`, an update.

grant select, insert, update on public.dietary_constraints to authenticated;
grant select, insert, update on public.attendance to authenticated;

grant all on public.dietary_constraints to service_role;
grant all on public.attendance to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- people joins the publication now that it changes: adding a child on the tablet
-- should appear on both phones without a reload, like everything else does.
alter publication supabase_realtime add table public.people;
alter publication supabase_realtime add table public.dietary_constraints;
alter publication supabase_realtime add table public.attendance;
