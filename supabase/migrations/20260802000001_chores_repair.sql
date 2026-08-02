-- Re-runs the chores DDL that 20260801000009_chores.sql never ran.
--
-- What happened, because the trap is invisible and will be set again: chores was
-- written on a branch as `20260801000008_chores.sql`, while `20260801000008` had
-- already been taken on main by `calendar_sync_status.sql`. Merging renumbered
-- the file to `...009`, which is the state of the tree today and reads as though
-- nothing ever went wrong.
--
-- The CLI matches migrations on the version number alone — never the filename,
-- never the contents. So on a database that had already recorded `...008`, the
-- chores file bearing that number was taken for applied and skipped, and after
-- the renumber its statements sat under `...009`, a version the database also
-- already had. `migration list` compares the two columns of numbers and finds
-- them identical. Every table but this one existed, so nothing looked wrong from
-- the database side either.
--
-- What it cost is worth recording, because it is the same bill
-- 20260801000006_recipe_steps_grants.sql paid: `pull` fetches every synced table
-- in one Promise.all and treats a single failure as the server being
-- unreachable. Two missing tables out of eighteen meant no device ever completed
-- a pull, the header read "Offline · last synced 00:03" with a time that never
-- moved, and every write banked up in the queue — against a database that was up
-- the whole time and answering the other sixteen.
--
-- Idempotent throughout, because it has to be. A database built from scratch
-- gets these tables from `...009` in the ordinary way and then meets this file
-- immediately afterwards; it must be a no-op there, and repair only where the
-- number collision ate the original. Everything below is therefore guarded, and
-- the definitions are copied from `...009` rather than reworded — if the two ever
-- disagree, the one that runs depends on which database you are on, which is the
-- whole failure being fixed here.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.chores (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  person_id uuid references public.people(id) on delete set null,
  weekdays smallint[],
  due_date date,
  at_time text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chores_household_id_idx on public.chores (household_id);

create table if not exists public.chore_completions (
  id uuid primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  chore_id uuid not null references public.chores(id) on delete cascade,
  date date not null,
  done boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chore_completions_household_id_idx on public.chore_completions (household_id);
create index if not exists chore_completions_chore_id_idx on public.chore_completions (chore_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.chores enable row level security;
alter table public.chore_completions enable row level security;

-- Dropped first so this is repeatable: `create policy` has no `if not exists`,
-- and a policy that already exists is one this file would otherwise fail on.
drop policy if exists "member reads chores" on public.chores;
drop policy if exists "member inserts chores" on public.chores;
drop policy if exists "member updates chores" on public.chores;
drop policy if exists "member reads chore completions" on public.chore_completions;
drop policy if exists "member inserts chore completions" on public.chore_completions;
drop policy if exists "member updates chore completions" on public.chore_completions;

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
--
-- Grants are what a missing table looks like once it exists but nobody may read
-- it, which is the failure recipe_steps had. Repeating a grant already held is a
-- no-op, so these are stated unguarded.

grant select, insert, update on public.chores to authenticated;
grant select, insert, update on public.chore_completions to authenticated;

grant all on public.chores to service_role;
grant all on public.chore_completions to service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- `alter publication ... add table` errors on a table already published, so each
-- is added only if the publication has not got it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chores'
  ) then
    alter publication supabase_realtime add table public.chores;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chore_completions'
  ) then
    alter publication supabase_realtime add table public.chore_completions;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The other half of the same renumber
-- ---------------------------------------------------------------------------

-- Merging moved skipped_nights from `...009` to `...010` in the same commit that
-- moved chores, so it sat on a colliding number too and could have been swallowed
-- the same way. Unlike chores it leaves no 404 to notice — a missing column halts
-- the sync queue quietly instead (see SCHEMA_DRIFT_CODES in app/utils/sync.ts) —
-- so it is asserted here rather than waited for. Both statements are no-ops where
-- 20260801000010_skipped_nights.sql already ran.

alter table public.meal_plan_entries alter column recipe_id drop not null;
alter table public.meal_plan_entries add column if not exists skip_reason text;
