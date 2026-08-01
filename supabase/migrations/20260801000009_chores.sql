-- Chores: the other things a household has to remember, on the board that
-- already tells it what is for dinner.
--
-- The Today card is a timeline of the day — Google's events, with the meal
-- slotted in as an appointment. A chore is the same kind of fact: something that
-- happens today, belongs to somebody, and can be done. So it goes on that
-- timeline rather than into a list of its own, and gets ticked where it is read.
--
-- Two shapes in one table, because they differ by one nullable column each:
--
--   * a weekly rule — `weekdays` non-empty, `due_date` null. "Bins, Tuesdays."
--   * a one-off     — `due_date` set, `weekdays` null. "Fix the gate, Saturday."
--
-- Deliberately no check constraint enforcing exactly-one-of, and no unique
-- constraints anywhere here, for the reason set out in
-- 20260730000001_phase2_recipes_plan.sql — a 23505 or a 23514 is classified as a
-- permanent error, so a write that trips one burns its retries, gets dropped,
-- and leaves that device holding a row the server has never seen. The editor and
-- the store are where that rule is enforced, where it can be said out loud to
-- somebody who can fix it. Uniqueness comes the way alias and attendance rows
-- get it: a primary key that is a uuidv5 of what identifies the row.
--
-- Every convention from 20260729000001_init.sql applies unchanged: ids minted on
-- the device (no defaults), `updated_at` written by the client as the
-- last-write-wins key, and deletes that are soft so every queued mutation stays
-- a plain idempotent full-row upsert.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.chores (
  -- crypto.randomUUID() on the device. A chore is something a person authored,
  -- like a recipe or an aisle, so there is nothing to derive an id from.
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  -- Null means the whole household, the same convention calendar_events uses for
  -- a shared event: no name in the row's second line, and the neutral rail.
  person_id uuid references public.people(id) on delete set null,
  -- ISO weekdays, 1 = Monday .. 7 = Sunday. An array rather than a single day
  -- because "bins Tuesday and Friday" is one chore, not two.
  weekdays smallint[],
  due_date date,
  -- 'HH:MM', as meal_plan_entries.eat_time already is. Null is untimed, which is
  -- most chores: it pins them to the top of the day rather than inventing a time
  -- nobody agreed to.
  at_time text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chores_household_id_idx on public.chores (household_id);

-- One chore on one day, done or not.
--
-- Occurrences themselves are never stored — a weekly rule would otherwise need
-- rows minted forward forever, by something that has to run. They are derived at
-- read time from the rule and the date. Only the tick is a fact worth keeping,
-- and it is keyed on the occurrence it belongs to.
--
-- The attendance contract, for the same reasons: no row means not done, and
-- unticking writes `done: false` rather than deleting. Two phones ticking the
-- bins on the same Tuesday mint the same id from (household, chore, date), so
-- they land on one row and converge through ordinary last-write-wins instead of
-- one side's delete racing the other side's absence.
create table public.chore_completions (
  -- uuidv5(CHORE_COMPLETION_NAMESPACE, '<household>:<chore>:<date>').
  -- See app/utils/chores.ts.
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  chore_id uuid not null references public.chores(id) on delete cascade,
  date date not null,
  done boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chore_completions_household_id_idx on public.chore_completions (household_id);
create index chore_completions_chore_id_idx on public.chore_completions (chore_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.chores enable row level security;
alter table public.chore_completions enable row level security;

create policy "member reads chores" on public.chores
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts chores" on public.chores
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates chores" on public.chores
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

create policy "member reads chore completions" on public.chore_completions
  for select to authenticated using (public.is_member(household_id));
create policy "member inserts chore completions" on public.chore_completions
  for insert to authenticated with check (public.is_member(household_id));
create policy "member updates chore completions" on public.chore_completions
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));

-- No delete policies, as in init.sql: deletion is `deleted_at`, which is an update.

grant select, insert, update on public.chores to authenticated;
grant select, insert, update on public.chore_completions to authenticated;

grant all on public.chores to service_role;
grant all on public.chore_completions to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.chores;
alter publication supabase_realtime add table public.chore_completions;
