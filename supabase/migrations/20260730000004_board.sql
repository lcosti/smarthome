-- Phase 5, part one: the three columns the wall dashboard needs.
--
-- The board answers "what's for dinner, who is eating it, who is cooking it" from
-- across a room. Two of those it can already work out; the third it cannot. Every
-- convention from 20260729000001_init.sql applies unchanged — client-set
-- `updated_at`, soft deletes, ids minted on the device.
--
-- All three columns are nullable with no default, deliberately. Every row that
-- exists today predates them, and a board that treats null as "not said" reads
-- exactly right: no cook chip, the household's default eat time, no attribution
-- toast. Nothing has to be backfilled and nothing has to be edited before the
-- dashboard is useful.

-- ---------------------------------------------------------------------------
-- meal_plan_entries
-- ---------------------------------------------------------------------------

alter table public.meal_plan_entries
  -- Who is cooking. `on delete set null` rather than cascade: a person leaving the
  -- household must not take the night's plan with them.
  add column cook_person_id uuid references public.people(id) on delete set null,
  -- When it lands on the table, as 'HH:MM' local wall-clock text.
  --
  -- Text rather than `time`, for the same reason week.ts never calls toISOString:
  -- everything about a household's day is local. A `time` column would be read
  -- back by the client as a string anyway, and the moment anyone reached for
  -- timestamptz the 18:00 dinner would move an hour twice a year.
  --
  -- Null means the household default (18:00, in the view model). The board derives
  -- "start cooking at 17:25" by subtracting the recipe's prep and cook minutes, so
  -- this one field drives both halves of the timing pill.
  add column eat_time text;

-- ---------------------------------------------------------------------------
-- shopping_list_items
-- ---------------------------------------------------------------------------

alter table public.shopping_list_items
  -- Who added it, for the board's "Luke added Nappies · 4 min ago" line.
  --
  -- A person, not an auth user: the point is the face on the chip, and people are
  -- the table that has names and colours. Nullable because the kitchen tablet is a
  -- shared device that may not map to anybody, and because every existing row was
  -- added before anyone was recording it.
  add column added_by uuid references public.people(id) on delete set null;

-- No new policies or grants: both tables are already client-writable by members,
-- and a new column on an existing table inherits that. No index either — the
-- board reads these columns off rows it has already loaded, never filters by them.
