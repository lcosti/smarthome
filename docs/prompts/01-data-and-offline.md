# Step 1 — the data model and the offline layer

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build only the data model and the sync layer. No screens beyond whatever you
need to prove it works. Finish by demonstrating acceptance test 1.

---

## 4. Data model

Every table is scoped to a `household_id` with row-level security. Every policy is
scoped to the caller's household membership. No cross-household reads, ever.

### Conventions that the offline layer depends on

These are load-bearing. Do not change them.

1. **Ids are minted on the device**, not by the database. Any row — an item, a
   recipe, a planned night, an ingredient — must be creatable in airplane mode and
   pushed later. Tables the client writes have **no id default**.
2. **`updated_at` is set by the client, never by a database trigger.** It is the
   last-write-wins comparison key; a server-side trigger makes every echo look
   newer than the local write it came from.
3. **Deletes are soft** (`deleted_at timestamptz`), so every mutation the client
   queues is a plain idempotent full-row upsert.
4. **Five id types are derived, not random**, so two devices doing the same thing
   offline converge on one row instead of two. Each is a UUIDv5 over a fixed
   namespace:

| Row | Derived from |
|---|---|
| a shopping item created by the plan | `(plan_entry_id, recipe_ingredient_id)` |
| an ingredient alias | `(household_id, ingredient_id, alias)` |
| an attendance row | `(household_id, person_id, date, meal)` |
| a dietary constraint | `(household_id, person_id, kind, normalised tag)` |
| a chore completion | `(household_id, chore_id, date)` |
| a calendar event | `(calendar_id, google_event_id)` |

### Tables

```sql
-- Ambiguous characters (I, O, 0, 1) omitted: this gets read aloud across a kitchen.
create function gen_invite_code() returns text as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32)::int + 1, 1), '')
  from generate_series(1, 6)
$$ language sql volatile;

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default gen_invite_code(),
  created_at timestamptz not null default now()
);

-- People are NOT auth users. An adult who signs in gets auth_user_id set; that
-- row IS the household membership record — there is no separate members table.
-- Children and babies are rows with no login.
create table people (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  date_of_birth date,                    -- life stage is derived from this
  auth_user_id uuid unique references auth.users(id) on delete set null,
  avatar text,                           -- data URL, max 262144 chars
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dietary_constraints (
  id uuid primary key,                   -- uuidv5, see above
  household_id uuid not null references households(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  kind text not null check (kind in ('allergy','intolerance','dislike','preference')),
  tag text not null,                     -- free text: "peanut", "anything spicy"
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- THE ROSTER. The contract the whole design rests on: NO ROW MEANS PRESENT.
-- A row exists only once somebody has said otherwise. Toggling back to present
-- is an update setting present = true, NEVER a delete.
create table attendance (
  id uuid primary key,                   -- uuidv5 of (household, person, date, meal)
  household_id uuid not null references households(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  date date not null,
  meal text not null default 'dinner',
  present boolean not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table aisles (
  id uuid primary key,                   -- device-minted, no default
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0, -- the order the shop is walked
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  base_unit text not null default 'count' check (base_unit in ('g','ml','count')),
  aisle_id uuid references aisles(id) on delete set null,
  -- Set by a merge, alongside deleted_at: "this row turned out to be that row".
  -- Readers chase this pointer (with a depth cap) rather than the app rewriting
  -- every row that referenced the loser — some of those rows are on a phone in
  -- a car park with no signal.
  merged_into uuid references ingredients(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ingredient_aliases (
  id uuid primary key,                   -- uuidv5 of (household, ingredient, alias)
  household_id uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  alias text not null,                   -- stored as typed; normalised for compare
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- How it is bought: {name: 'tin', amount: 400} on a gram ingredient is a 400g tin.
-- This is what turns "800g" into "2 tins", the only form of the number anybody
-- can act on while standing in an aisle.
create table ingredient_purchase_units (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  name text not null,                    -- singular, as written on a shelf
  amount numeric not null,               -- how much of the base unit one holds
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  source_url text,
  image_url text,                        -- the source site's photograph
  photo text,                            -- the household's own picture, data URL,
                                         -- max 524288 chars; wins over image_url
  base_servings integer not null default 2,
  prep_minutes integer,
  cook_minutes integer,
  method text,                           -- free notes, NOT the steps
  shortlisted_at timestamptz,            -- "cook this soon"
  -- Per-serving nutrition, exactly as the source printed it. All nullable.
  -- Empty is the honest state; never zero.
  kcal numeric, fat_g numeric, saturates_g numeric, carbs_g numeric,
  sugars_g numeric, fibre_g numeric, protein_g numeric, salt_g numeric,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade, -- denormalised
  recipe_id uuid not null references recipes(id) on delete cascade,
  name text not null,                    -- free text, the cook's own wording
  quantity text,                         -- free text: "2", "1 tin", "a bunch"
  aisle_id uuid references aisles(id) on delete set null,
  ingredient_id uuid references ingredients(id) on delete set null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One step is one column of prose. Deliberately not a title/body split: a step
-- is a thing you do, and splitting it is a structure nobody maintains.
create table recipe_steps (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  recipe_id uuid not null references recipes(id) on delete cascade,
  body text not null,
  sort_order integer not null default 0, -- sparse; reordering swaps two values
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table meal_plan_entries (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  date date not null,                    -- a calendar date, not an instant
  meal text not null default 'dinner',
  recipe_id uuid references recipes(id) on delete cascade,  -- NULL on a skipped night
  servings integer not null,
  note text,
  cook_person_id uuid references people(id) on delete set null,
  eat_time text,                         -- 'HH:MM', or null for the household default
  leftover_of_entry_id uuid,             -- this night reheats that night
  skip_reason text,                      -- 'takeaway'|'out'|'someone_else'|'other'
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shopping_list_items (
  id uuid primary key,                   -- uuidv5 when source = 'plan'
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  quantity text,                         -- free text
  aisle_id uuid references aisles(id) on delete set null,
  ingredient_id uuid references ingredients(id) on delete set null,
  checked boolean not null default false,
  checked_at timestamptz,
  source text not null default 'adhoc' check (source in ('adhoc','plan')),
  plan_entry_id uuid references meal_plan_entries(id) on delete set null,
  recipe_ingredient_id uuid references recipe_ingredients(id) on delete set null,
  added_by uuid references people(id) on delete set null,  -- null for derived rows
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pantry_items (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  on_hand numeric not null default 0,    -- in the ingredient's base unit
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- What a planned night has already claimed out of the cupboard, so two nights
-- do not both count the same two onions.
create table pantry_reservations (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  plan_entry_id uuid not null references meal_plan_entries(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  amount numeric not null,
  date date not null,
  settled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nothing is stored per day. A weekly chore is ONE row saying "Tuesdays", and
-- every Tuesday it will ever have is worked out at read time.
create table chores (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  person_id uuid references people(id) on delete set null,  -- null = everyone
  weekdays smallint[],                   -- ISO weekdays, 1=Mon .. 7=Sun
  due_date date,                         -- for a one-off; mutually exclusive
  at_time text,                          -- 'HH:MM', or null for "some time today"
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same contract as attendance: NO ROW MEANS NOT DONE; unticking writes done=false.
create table chore_completions (
  id uuid primary key,                   -- uuidv5 of (household, chore, date)
  household_id uuid not null references households(id) on delete cascade,
  chore_id uuid not null references chores(id) on delete cascade,
  date date not null,
  done boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Read-only on the client. Written only by the calendar sync job.
create table calendar_events (
  id uuid primary key,                   -- uuidv5 of (calendar_id, google_event_id)
  household_id uuid not null references households(id) on delete cascade,
  person_id uuid references people(id) on delete set null,  -- null = shared event
  calendar_id text not null,
  google_event_id text not null,
  title text not null default '',
  all_day boolean not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  start_date date not null,              -- the local calendar date, stored not derived
  end_date date not null,                -- EXCLUSIVE, matching Google's convention
  google_updated_at timestamptz,         -- skip unchanged rows on a sync run
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Why the calendar card says what it says. This table exists because an empty
-- calendar was the symptom of five different problems, four of which produced no
-- log line anywhere.
create table calendar_sync_status (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null unique references households(id) on delete cascade,
  ran_at timestamptz not null,
  outcome text not null check (outcome in ('ok','skipped','error')),
  detail text,
  fetched integer, written integer, removed integer,
  calendars_failed integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### Security

One helper, used by every policy:

```sql
create function is_member(hid uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from people
                 where household_id = hid and auth_user_id = auth.uid())
$$;
```

Every table gets `select`, `insert` and `update` policies for authenticated users
gated on `is_member(household_id)`. **No delete policies** — deletes are soft, so
a delete is an update. `calendar_events` and `calendar_sync_status` get `select`
only; they are written by the server.

Two `security definer` functions handle setup, because a person who is not yet a
member cannot pass their own RLS check:

- `create_household(hname text, pname text) → uuid` — creates the household, seeds
  the default aisles, and inserts the caller as a person with `auth_user_id` set.
- `join_household(code text, pname text) → uuid` — finds the household by invite
  code and inserts the caller as a person.

### Default aisles

Seeded on household creation, in this order — it is the order a supermarket is
walked:

`Fruit & veg` · `Bakery` · `Chilled` · `Meat & fish` · `Frozen` · `Cupboard` ·
`Household`

---

## 5. The offline layer

This is the hardest part of the app and no library does it for you. Build it as
specified.

### Shape

- In-memory reactive state holds the working set.
- A local device database (IndexedDB or equivalent) persists every table.
- Writes apply optimistically to local state and **append a full row snapshot to a
  mutation queue**.
- The queue drains to the server as plain upserts, in order, and is
  order-independent in effect.
- Live updates arrive over a realtime subscription when online.
- A service worker precaches the app shell.

### The rules

1. **Every queued write is a full row snapshot, not a patch.** This makes draining
   idempotent and order-independent, which is what lets last-write-wins be
   sufficient. Insert, edit, tick, untick and delete are all the same operation.
2. **Deletes are soft**, so deleting is an ordinary upsert too.
3. **`updated_at` is written by the client.** Never by a trigger.
4. **A row with a queued write is never overwritten by anything arriving from the
   server.** This is what stops a stale echo undoing an unsynced change.
5. A server row is applied to local state when: it is not in the queued set, AND
   (there is no local row OR the server's `updated_at` is greater than or equal to
   the local one). **Parse the timestamps** — do not string-compare them. The
   server returns microsecond precision with a `+00:00` offset and the client
   writes millisecond precision with a `Z`; those are lexically incomparable and
   the same instant.
6. A row only stops being "pending" once **nothing else is queued against it**,
   or a later queued edit gets exposed to the echo of the earlier one.

### The drain loop

Triggers: on reconnect, on app focus, after each write, and on a 30-second timer.

For each queued mutation in order:

- **Success** → delete from queue, mark the row settled if nothing else is queued
  against it.
- **Failure with no error code** (a transport failure) → **halt the drain and
  leave the queue completely intact.** The triggers above are the retry policy.
- **Failure with an expired/missing-token code** → same: halt. It succeeds the
  moment the session refreshes.
- **Failure with a schema-drift code** (the server does not have a column or table
  this client writes: PostgREST `PGRST204`/`PGRST205`, Postgres `42703`/`42P01`)
  → **halt.** This is a client deployed ahead of its migrations. The write must
  wait, not be discarded. Every row of that table fails identically, so halting
  cannot strand a good write behind a bad one.
- **Any other coded failure** → increment an attempt counter and *skip to the next
  mutation*. One bad row must never hold up the milk behind it. After **5**
  attempts, drop it and show a toast.

Note what is deliberately *not* retryable: permission-denied and
foreign-key-violation are permanent, because a retryable error halts the whole
queue and a row that genuinely fails its check would block every write behind it
forever.

### Requeue on boot

After a completed pull, any **local row the server did not return and that nothing
is waiting to push** was a write that got dropped while its row stayed in the
cache. Requeue it. This is only safe because every delete is soft — a row the
server has never heard of was never inserted, not deliberately removed. *If a hard
delete is ever added, this becomes a resurrection bug.*

### Pull order

Which tables sync should be **one registry** that drives the local stores, the
hydrate, the pull order, the realtime subscription and the typing — so adding a
table is one entry.

Pull order is load-bearing: **parents land before the rows that reference them**,
so a fresh device can resolve a derived item's recipe and ingredient on first
paint.

### Service worker

- Precache the app shell and all fonts.
- **Navigation fallback must resolve to `/`, not `/index.html`.** A dynamic route
  like `/recipes/<id>` has no precache entry of its own and needs the fallback.
- **Never serve API/database requests from the service worker cache** — offline
  behaviour belongs entirely to the local database and mutation queue.
- **One exception:** cross-origin *images* (recipe photographs, which live on
  whichever site the recipe came from) are cached CacheFirst, max 120 entries, 60
  days, accepting opaque responses. The address is stored but the bytes are not,
  so without this the kitchen tablet loses every picture the moment the wifi does.

### Auth gate

The gate is **"has this device ever been set up"**, not "is the access token valid
right now". A token lasts an hour and the app has to open in a supermarket. Store
a small identity record locally; if it exists, let the app in and let reads come
from the cache.

Keep the session in local storage rather than in cookies, so the shared kitchen
tablet stays signed in indefinitely.

### The acceptance test for this layer

> Put the phone in airplane mode. Open the app from the home screen. Tick five
> items. Add two more. Close the app entirely. Reopen it, still offline. Cold-open
> a route that was never prerendered. Come back online. **Nothing is lost, and the
> server ends up with exactly what the screen showed.**

---
