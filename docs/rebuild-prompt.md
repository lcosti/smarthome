# Build brief: a household meal planner and shopping list

This is a complete specification for an application. Build it as described. Where
a detail is not specified, choose the option that best serves the stated purpose
of the screen you are working on.

The document is stack-agnostic — build it with whatever framework, database and
component library you use. The data model is given as SQL because it is precise,
not because you must use Postgres; if your platform has its own database, mirror
the tables, columns, types and relationships exactly. **Appendix A** names the
reference implementation's stack, if you can honour it.

---

## 1. What this is

A private meal-planning and shopping app for **one family of four to six people**.
Not a product. Not multi-tenant at scale. No sign-up funnel, no marketing surface,
no growth features. Optimise for *"my partner will actually use this"*, not for
scale.

It replaces four things the household currently uses: a WhatsApp group used as a
shopping list, a Notion page of recipes, paper lists, and the supermarket's own
app.

### The central idea

**The shopping list is a derived artifact, not a document anybody maintains.**
The chain is:

```
who is home this week + the recipe library
  → weekly generator
  → meal plan (7 nights, servings per night)
  → shopping list (minus what's in the pantry, sorted by aisle)
```

Nobody hand-maintains the list. It falls out of the plan. Ad-hoc additions
("bin bags") are supported as a separate item type on the same list.

### The two devices that matter

1. **A phone in a supermarket with bad signal.** The list must open instantly,
   offline, with no login prompt, and ticking things off must never fail.
2. **A tablet left on in the kitchen**, landscape, read from across the room.

Every screen must answer at both sizes. There is no separate "dashboard app".

### Non-negotiable constraints

- **Client-rendered, not server-rendered.** First paint must not require a network
  round trip. There is no SEO requirement.
- **Offline-first.** Reads come from a local database on the device; writes apply
  optimistically and queue. Authentication is required to *sync*, not to *shop*.
- **People are not user accounts.** Children and babies are rows with no login.
- **Life stage is derived from a date of birth, never stored as a label.**
- **Selection over generation.** The generator picks from the household's own
  recipe library. It never invents a recipe for the plan.
- **Last-write-wins is sufficient.** Do not build CRDTs or operational transforms.

### Explicitly out of scope

- Multi-tenancy beyond one household
- Nutrition *tracking* — daily totals, calorie counting, macro targets. Storing a
  recipe's own per-serving figures is in scope; summing them across a day or a
  plan is not.
- Supermarket basket integration
- Anything for users other than this family

---

## 2. Design system

### Colour

- **Primary: amber.** This is the accent for buttons, badges, focus rings and
  active states. It was chosen because the kitchen tablet has to be readable from
  across a room and amber is the one accent that carries.
- **Neutral: slate.** All greys, surfaces and borders.
- **Success: green** (`#00C16A` at 500). Used for exactly one thing: a shopping
  list that has been *cleared*. Never for a list that was never used.
- **Warning / error:** stock amber-orange and red, used only for hard dietary
  constraints (allergies) and for destructive confirmations.

Dark surfaces dominate; the kitchen board is a dark UI. Support light and dark.

### Typography

Three faces, each with one job:

| Face | Used for |
|---|---|
| **Public Sans** (sans) | Everything. All interface text and prose. |
| **JetBrains Mono** (mono) | Times, dates, quantities, counts, countdowns. Never prose. |
| **Source Serif 4** (serif) | Exactly one thing: the current step in cook mode, set at 36–48px. |

Self-host all three so they render with no network.

### Person colours

Every person gets one colour, used on avatars, calendar rows and chips. The whole
palette is a function of a single hue angle, at **fixed lightness and chroma**, so
no person is louder than another:

```
HUES = [25, 232, 148, 305, 88, 265, 190, 340]   // coral, blue, green, violet, …

avatar:  ring  oklch(0.72 0.13 <hue>)
         tint  oklch(0.32 0.06 <hue>)
         ink   oklch(0.88 0.10 <hue>)

chip:    bg    oklch(0.23 0.03 <hue>)
         border oklch(0.40 0.06 <hue>)
         ink   oklch(0.86 0.09 <hue>)
```

A person is assigned a hue by their **position in the household ordered by
creation date** — never by display order, or the baby turning one would re-sort
the roster and change everyone's colour overnight.

Somebody marked as **not eating tonight loses their hue entirely** and goes
neutral grey (`oklch(0.36 0.012 62)` ring, `oklch(0.22 0.008 62)` fill). A
washed-out coral reads as "their colour, but odd"; grey reads as "not tonight".

### Layout: two shapes, one app

The breakpoint is **1024px**. Ask the question in exactly one place so components
and CSS classes cannot disagree about where the line is.

- **Below 1024px (phone):** a single column, max-width ~576px, with a **bottom tab
  bar** of four equal columns: Today · List · Plan · Recipes. Icon over label,
  56px minimum height, safe-area inset at the bottom. Active tab is amber; the
  rest are dimmed.
- **1024px and up (wide):** a **sticky top header** carrying, left to right: the
  day name as a wordmark (links home), a vertical rule, the date, an amber week
  badge (`Week 31`), the weather; then a centred four-item segmented control
  (Today · List · Plan · Recipes) in a recessed pill; then the plan badge, an
  offline pill if stale, and a settings icon.

The app shell is **exactly one viewport tall and never scrolls**. Each page places
its own header and a scrolling `<main>` inside that column, so the tab bar stays
on screen no matter how long the list is.

Most pages are one layout at both widths. Two are genuinely different trees and
should be built as separate components swapped by width:

- **The plan** — seven rows on a phone, a seven-column grid with an aside on wide.
- **The recipe library** — a list on a phone, master-and-detail on wide.

### Component discipline

Build the UI from your component library's stock components. Do not hand-roll
what the library provides: no raw buttons/inputs/forms styled with utility
classes, no span-based badges or checkboxes, no selectors built from arrays of
buttons (use radio groups, checkbox groups, select menus, tabs), no bespoke
dropdowns, autocompletes, empty states, skeletons or progress bars.

Recurring visual overrides belong in one theme config file, not repeated inline on
every usage.

A custom implementation is allowed only where the library genuinely cannot express
the requirement. In this app that is: the bottom tab bar; the kitchen-board avatar
(runtime pixel sizes and generated per-person hues); card and row tap targets
whose content is a laid-out block rather than a label; the day grid on the Today
screen; the ingredient suggestion list (because Enter must always submit what was
typed, which an autocomplete steals); the macro bar (three series summing to a
whole, not one value against a track); the cook-mode step bar; drag-and-drop on
the plan; and the hidden file inputs behind photo buttons.

### Empty states

Dashed border, muted icon, a title in medium weight and a description one size
down. An empty state is a placeholder for something that will be there later, not
a panel in its own right.

### Confirmation dialogs

Reserved for three actions only: deleting an aisle, deleting a recipe, and signing
out with unsynced changes. Everything else is a soft delete and needs no
confirmation — including "clear checked items", which is throwing away things
already in the trolley.

---

## 2b. Reference screenshots

`docs/screenshots/` holds the real application at both widths. Attach the
relevant ones alongside the section you are working on — they settle in one look
what a paragraph of layout prose only approximates.

| File | Screen |
|---|---|
| `wide-today.png` · `phone-today.png` | Today (§6.3) — the schedule grid, the hero, the week strip |
| `wide-shopping.png` · `phone-shopping.png` | The shopping list (§6.4) — aisle cards, chips, grouped lines |
| `wide-plan.png` · `phone-plan.png` | The week (§6.5) — a leftovers night, a skipped night, a gap, the aside |
| `wide-recipes.png` · `phone-recipes.png` | The library (§6.6) — master/detail and facets on wide |
| `wide-recipe-detail.png` · `phone-recipe-detail.png` | The recipe editor (§6.7) |
| `wide-cook.png` · `phone-cook.png` | Cook mode (§6.8) — the serif step, the segment bar, the timer |
| `phone-settings.png` | Settings (§6.12) |
| `phone-people.png` | The roster (§6.9) — derived life stages, constraint badges |
| `phone-ingredients.png` | Canonical ingredients (§6.10) |
| `phone-pantry.png` | The pantry (§6.11) |

They were taken against a seeded household of four — two adults, a toddler and a
baby — with five recipes, a planned week containing a leftovers night and a
takeaway night, and a part-ticked shopping list. That is deliberately the state
worth photographing: an app with one item in it hides most of what these screens
do.

---

## 3. Routes

| Route | What it is for | Chrome |
|---|---|---|
| `/` | **Today** — the day, tonight's meal, who's cooking, the schedule, the list, the week | yes |
| `/shopping` | **The shopping list** — the page that must open instantly on a phone | yes |
| `/plan` | **The week** — seven nights; tap one to choose, adjust or clear a recipe | yes |
| `/recipes` | **The library** — search, add, import | yes |
| `/recipes/<id>` | Edit one recipe | yes |
| `/recipes/<id>/cook` | **Cook mode** — one step at a time, hob-sized | **no chrome** |
| `/settings` | Aisles, links to people/ingredients/pantry, chores, calendar status, always-on, invite code, sign out | yes |
| `/people` | The roster: names, dates of birth, allergies | yes |
| `/ingredients` | Canonical ingredients, aliases, purchase units | yes |
| `/pantry` | What is already in the house | yes |
| `/login` | Magic-link sign-in | no chrome |
| `/welcome` | Create or join a household | no chrome |

Cook mode declares "no chrome" **in its own route metadata**, not by the shell
matching on a path — `/recipes` keeps its chrome and `/recipes/<id>/cook` does
not, and a path regex gets that wrong the first time either route moves.

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

## 6. Screen by screen

### 6.1 `/login`

Centred, max-width 384px. Title "Shopping List", subtitle "Sign in once. This
device stays signed in." One email field and one full-width button, "Email me a
link". On success, replace the form with an alert: "Check your email — We sent a
sign-in link to `<address>`. Open it on this device."

Magic link only. No passwords.

### 6.2 `/welcome`

Title "Set up your household", subtitle "Create one, or join the one that already
exists." Two tabs: **Create** / **Join**.

- **Create**: "Household name" (placeholder `The Costis`) + "Your name".
- **Join**: "Invite code", with help text "Six characters, from the settings
  screen on the other phone.", monospace and uppercased + "Your name".

Submit navigates to `/` immediately and starts the first sync **without
awaiting it** — the first sync of a new household takes a moment, and navigating
when it resolves drags anyone who tapped through to Recipes back to the list under
their thumb.

### 6.3 `/` — Today

The most complex screen, and the one the kitchen tablet lives on.

**Everything on it is derived by one pure function** that takes the facts and
returns a view model. It has **seven content states**, and they are *not* seven
templates — they fall out of the facts, which is why "offline" and "empty list"
can be true at the same time as any of the others. The components render whatever
they are given.

The seven states, in priority order:

| State | When |
|---|---|
| `setup` | No meal tonight, AND (no people yet OR no recipes yet) |
| `nobodyhome` | No meal, household set up, nobody is down as eating |
| `noplan` | No meal, household set up, people are eating |
| `lateevening` | Dinner is 90+ minutes behind us (or it is past 20:30 with nothing planned) |
| `offline` | The device cannot reach the server |
| `emptylist` | Nothing outstanding on the shopping list |
| `nominal` | Everything else |

**`setup` is the state the design did not have and needs.** Without it, a
brand-new household falls through to "nobody home for dinner — the calendar has
everyone out": there was no everyone, and no calendar. It also made the generate
button unreachable, and the generator does nothing without a roster and a library
anyway. So a household missing either gets a truthful hero, a three-step checklist
(`Add the people who eat here` → `/people`, `Put a few recipes in the library` →
`/recipes`, `Generate the week`), and a button pointing at whichever step is
actually next.

**Layout.**

- *Wide:* two full-height columns in a `2.4fr / 1fr` grid. The **day** takes the
  wide column with the **week strip** underneath it; the **meal card** sits beside
  it over the **shopping card**.
- *Phone:* the meal card first, then the day, then the week — and **no shopping
  card at all**. The list is one tap away on the tab bar, and a second copy here
  is only a longer scroll to the week. The phone also carries its own small header
  (day name, date, weather, settings icon), because it has no top chrome.

**The hero (meal card).**

Eyebrow reads `Tonight`, or `Tomorrow · Friday` late in the evening. Then the
dish name, large; the recipe's photograph if there is one; a badge with the eat
time (`18:30`); `35 min`, `4 servings`; a cook chip in that person's hue
(`Naomi cooks`); and under the buttons a mono aside reading `start by 17:55`
(eat time minus prep+cook).

Buttons: **Start cooking** (goes to cook mode — the thing you want from tonight's
dinner standing in the kitchen is the method at a readable size, not the edit
page), **Swap** (opens the library as a picker for that night), **Clear** (takes
the night off).

With no meal, the card shows a title, a body and one action instead:

| State | Title | Body | Action |
|---|---|---|---|
| `setup` (no people) | Nothing set up yet | "Add the people who eat here, then a few recipes. This board fills itself in from your phone — there is nothing to set up on it." | Add people → `/people` |
| `setup` (people, no recipes) | Nothing set up yet | "The roster is ready. Add a few recipes and the week can be generated from them." | Add recipes → `/recipes` |
| `nobodyhome` | Nobody home for dinner | "No meal planned, and nobody is down as eating. Fridge night if plans change." | none |
| `noplan` | No plan for tonight *(or "for tomorrow")* | "The weekly generator has not run. Attendance and the recipe library are ready." | Generate this week's plan (runs here) |

Each carries a small mono hint at the far end of the footer: `~1 min`,
`fridge night`, `one press`.

**The schedule card** — a real clock face, not a list.

The day is drawn to scale at **48px per hour**, covering **08:00–21:00** by
default and stretching to reach anything outside that (including the current
time — a marker that has fallen off the end is worse than a taller grid).

- Rows are calendar events, chores, and **dinner itself**, because dinner is the
  one thing here that is both a plan and an appointment (`Dinner — Ragù`).
- Positions are computed in pixels and handed to the component as **fractions of
  the total height**, so a wall tablet can stretch the same day taller than a
  laptop and both show all of it.
- Two things 20 minutes apart are 16px apart, which is not enough for two lines of
  text. Rows below get **nudged down until they clear a 44px minimum gap**, in one
  forward pass so a cluster of four fans out downwards.
- Each row shows a time, a title, and a meta line of `<whose it is> · <chore|done|
  tomorrow>`, tinted with that person's hue.
- **All-day events, untimed chores, and (late in the evening) tomorrow's first
  thing** sit in a list *above* the grid, not in it — putting them in it would
  mean inventing an hour and drawing that invention to scale.
- Every hour gets a rule. An hour label is **dropped** if it would land within
  17px of a row's own time or the now-marker, rather than printing two clocks in
  the same place.
- **A chore dims only when it is done.** An event at 09:00 is over by lunchtime
  whatever anybody did about it, but a bin that was supposed to go out at seven
  and did not is still a bin that needs going out.
- **Chores are ticked here**, in place. That is the whole point of them being on
  this card.
- The **now marker is removed when offline.** It asserts "it is now this time",
  which a board that cannot reach the server has no business claiming. It goes
  rather than going stale. (The scroll position still uses the device clock —
  where to scroll is arithmetic, not a claim about freshness.)
- Badge: `3 events` normally; `No calendar` when none has ever synced;
  `2 chores` when there are chores but no calendar; `Last known · 15:58` offline.

The phone renders the same rows as an ordinary list.

**The week strip** — always the six days *after today*, never after the hero's
day. Late in the evening the hero is about tomorrow, and tomorrow is the first
slot here, so it gets **highlighted** rather than removed. Each tile: short day
name, day-of-month in mono, the dish (or `No meal`), one meta figure (`25 min`, or
servings when the recipe does not say), and up to **two** event titles in their
owners' hues.

**The shopping card** (wide only) — the outstanding items grouped by aisle, with
an inline add form and a "Clear done" button.

An empty list says one of two different things and the card must not celebrate the
wrong one:

- **Cleared** (`everUsed` is true): "Nothing to buy" / "Everything for this week's
  plan is in. Tap to add something." — and this one may be **green**.
- **Never used**: "Nothing on the list yet" / "Add something from your phone and
  it shows up here." — no green. Green is the reward for clearing the list;
  spending it on a household that has never added anything makes the colour mean
  less the day they earn it.

**Ticking.** Today re-derives on a **30-second tick**, so it moves from tonight's
meal to tomorrow's on its own once dinner is 90 minutes behind it.

### 6.4 `/shopping` — the shopping list

The page that has to beat WhatsApp.

**The add box is at the top and always focusable.** Adding an item must be faster
than typing it into a group chat. Type, press Enter, done — the input clears
*immediately* and the write is optimistic, because offline is not a failure here,
it queues. If it genuinely could not be added (no household on this device), give
the typing back and say why.

**Aisle chips.** A **checkbox group** (several can be on at once), horizontal,
wrapping, `card` variant with the indicator hidden so the selected border comes
from the variant. There is deliberately **no "All" chip** — switching every chip
off to mean "show me nothing" is not a thing anybody wants, and an unfiltered list
is the resting state.

One chip on doubles as **where the next typed item gets filed** — that is somebody
saying where they are standing. Two chips on says nothing about which, so the
household's usual guess wins instead.

If an aisle empties while filtered on, drop it from the selection, or the page
shows nothing with no way back.

**The list itself.** Aisle cards in the household's own aisle order, laid out in
**CSS columns** (1 on a phone, 2 at `lg`, 3 at `2xl`) rather than a grid — aisles
are wildly different lengths, and a grid row is as tall as its tallest cell, so a
long aisle leaves dead space beside it. The multicol block must have **auto
height**; put the scroll on a wrapper, or it fragments sideways into a horizontal
scroller.

Each card is a **checkbox group** with a header (icon + aisle name + count) and
one row per line. The aisle icon is looked up from the aisle's *name*
(`Fruit & veg` → carrot, `Chilled` → milk, `Meat & fish` → beef, `Frozen` →
snowflake, `Cupboard` → package, `Household` → spray can, `Drinks` → cup, `Bakery`
→ croissant, anything else → basket) — an icon is a rendering decision, not a
column on the table.

A row shows the name and, right-aligned in mono, the quantity label. A row with
one item behind it opens the editor on tap; a row standing for **several** items
opens a sheet listing them first, because a summed quantity is not a thing that
can be edited, only the rows under it.

Header actions when anything is checked: **hide/show checked** and **clear
checked**. No confirmation on clear.

Empty states: "Nothing on the list." / "Type above to add the first thing."; and
if the device has no household, "This device isn't set up yet." with a **Set up**
button.

### 6.5 `/plan` — the week

**Phone:** a sticky header with the title, a plan badge, a fill-the-week icon
button, and a three-part week switcher (`‹` | `4 – 10 Aug` | `›`, where tapping
the middle returns to this week). Then, in the scrolling body:

- **Nights already past**, collapsed into a one-line strip each. A week is read
  forwards; the nights that have gone are a record worth keeping, worth opening,
  not worth half the screen. *(A week entirely in the past has no strip and all
  cards — it is a record somebody went looking for, and worth the space.)*
- **Nights still ahead**, one card each.
- **Suggestions** for the selected night.

Parked above the tab bar, always visible: one extra-large full-width button,
**"Add N items to the list"** (disabled with the note "Plan a night first, then
this puts its ingredients on the list."). Filling the week is a suggestion and
lives in the header; putting the week on the list is the errand.

**Wide:** a seven-column grid with an aside carrying the suggestions and the week
stats, and the fill/derive buttons beside the week switcher.

**A night card** shows the day, the dish (or the skip reason, or "Nothing
planned"), the servings, prep+cook, how many things it puts on the list, who is
cooking, anything on the calendar that day, and — on the wide layout only — a
roll-call of who is eating along the bottom. Seven copies of the same four faces
down a phone is a roll-call nobody reads, so on a phone only a night somebody is
*missing* says anything.

**The night editor** (a slide-over or modal) is where you: pick or change the
recipe, set servings, set the eat time, name the cook, mark somebody out for that
night, mark the night as leftovers of an earlier one, or **skip** it.

**Skipping** uses four fixed reasons, not free text — what somebody wants on a
Tuesday is one tap:

| Token | Label | Icon |
|---|---|---|
| `takeaway` | Takeaway | bike |
| `out` | Eating out | crossed utensils |
| `someone_else` | Someone else cooking | users |
| `other` | Something else | circle-slash |

A skipped night is **an entry like any other with no recipe on it** — not a gap.
Recorded as a gap, the generator kept offering to fill Friday, the aside counted
it as unplanned, and Today said nothing was on. An unrecognised token falls back
to the plain label "Not cooking".

**Drag and drop.** A dinner card can be dragged onto a night. Use **pointer
events**, one code path for mouse, pen and finger — HTML5 `dragstart` never fires
on a touchscreen and the kitchen tablet is the device most likely to be
rearranging a week. A mouse picks a card up after a few pixels of travel; **a
finger must hold it still for a moment first**, because the phone's plan is a
scrolling column and a card that grabbed every downward swipe would make the page
unreadable. Everything a drag does must also be reachable by tapping the night, so
nothing depends on the gesture.

### 6.6 `/recipes` — the library

**One box does three jobs.** Placeholder: `Search, add or paste a link`.

- Typing **narrows** the library.
- Pressing **add** turns what you typed into a new recipe and opens it.
- A **pasted link** is fetched and imported rather than becoming the name of an
  empty recipe. The add button's icon changes to a link when the text looks like a
  URL.

Beside it, a **camera button** that opens a hidden multi-select file input.
Multi-select because a cookbook recipe often spans a spread — ingredients on one
page, method overleaf. **Do not set `capture`**: on iOS it forces the camera and
silently drops `multiple`.

`?swap=YYYY-MM-DD` in the query turns the library into a picker for that night
(this is what Today's "Swap" opens); the title becomes `Pick a meal for Fri 8 Aug`
and choosing a recipe plans it and returns to `/`.

**Phone:** a list of rows — thumbnail, name, `N ingredients · serves 4`.

**Wide:** master and detail. The left pane has facet chips (a **radio** group —
one at a time) and a sort control; the right pane is the selected recipe.

Facets, each with a live count: `all` · `shortlist` · `quick` (under 30 min) ·
`batch` (serves 4+) · `planned` (on this week) · `pantry` (everything for it is
already in the house) · `never` (never cooked). Sorts: `recent` · `quickest` ·
`cooked`.

**All of this is derived, not stored.** There is no tags column and adding one is
not the answer: how long a recipe takes, how many it serves, how often it has been
cooked, what is already on the list and what is in the cupboard are all facts the
app has, and they answer the same questions — quick tonight? feeds everyone? had
it recently? what would I have to buy? **Cooked counts come from the plan** rather
than a counter, so they are true of what actually happened. A *future* night is
not a time it was cooked; a past one is.

The detail pane shows the picture, an eyebrow (`LIBRARY · LAST COOKED 5 DAYS
AGO`), meta (`35 min · serves 4 · cooked 11 times`), a shortlist toggle, the
ingredient list marked up with what is already on the list and what is in the
pantry, a **"Send 2 items to the shopping list"** button that sends exactly the
lines not already on it, and a short cooked-history list.

The pane lists ingredient names **tidied hard and capitalised** — instructions
off, "parmesan or Grana Padano" resolved to the one you would buy — because the
pane is a place you scan five meals to pick one. The recipe itself and cook mode
keep every word, because at the hob "finely chopped" is the instruction.

### 6.7 `/recipes/<id>` — edit a recipe

Header: the recipe name as a **ghost input** that saves on blur; then buttons for
cook mode, add/change photo, remove photo, and open the original page (when
imported).

Sections, in order, each with a small uppercase dimmed heading:

1. **Ingredients** — rows of name + quantity + aisle, with move-up/move-down. Then
   an add field with **suggestions**. Adding an ingredient does *not* ask for a
   quantity or an aisle: those are one tap away in the row editor, and asking here
   would turn eight ingredients into twenty-four decisions. The field clears and
   refocuses immediately.
2. **Serves** — a number input. Caption: "What the quantities above are written
   for."
3. **Nutrition** — eight number fields in a 2×4 grid: kcal, fat (g), saturates
   (g), carbs (g), sugars (g), fibre (g), protein (g), salt (g). Caption: "Per
   serving, as the source states it." Plus an **"Estimate the blanks"** button:
   a model's guess from the ingredients that **fills only what is empty** — an
   estimate never overwrites what a source printed or a person typed. Clearing a
   field is how you ask for it to be re-estimated.
4. **Steps** — a numbered list with reordering, and a textarea to add one. A
   textarea, so Enter makes a new line the way it does everywhere else you write a
   paragraph; that costs Enter-to-submit, which is why the button is beside it.
5. **Notes** — free text. "Anything worth remembering next time." This is *notes*,
   not the method. Keeping the method here meant an imported recipe buried its own
   notes under a wall of instructions.
6. **Delete recipe** — with confirmation: "The recipe, its ingredients and its
   method go with it. Nights already planned from it keep their name but lose the
   link."

### 6.8 `/recipes/<id>/cook` — cook mode

**No app chrome.** Standing at the pan you are doing one thing, and the header —
clock, weather, four other places you could be — is four things you are not doing.

Two panes. **Wide:** side by side. **Phone:** two tabs, because stacking them
meant the step you are cooking scrolled off the top the moment you checked what
was in it. The tab you are *not* on carries its own count: `Ingredients 3/11`
answers the question most glances at that list were asking anyway.

**Ingredients pane.** A checkbox per line, name and mono quantity. Checked lines
go dimmed and struck. **The next unchecked line gets an amber ring** — working
down a list of eleven, the only one you care about is the top one you have not
done, and a glance from across the kitchen should land in the right place. Footer:
`Checked off — 3 / 11`.

**Step pane.** Header reads `Step 4 of 9` and then a **segment bar: one segment
per step**, filling as you go (at step seven of nine you want to see you are
nearly done, not one lit stripe adrift in the grey). The row holds a fixed height
whether or not anything is timing, and every segment keeps an equal share of the
width — the geometry is what you read your position off.

The step body is set in **serif at 36–48px**, with no negative tracking. Only the
**first paragraph** is the step; anything after a blank line is shown as an aside
in a lightbulb alert. That split is read from the prose, because a step is one
column of free text and adding duration and tip columns would leave every existing
recipe with empty ones.

**Timers are read from the prose too.** Find the *first* duration mentioned:

- Ranges first, so `10-12 mins` is one duration and not the number 10, and a range
  **resolves to its upper bound** — a timer that goes off early is one you have to
  reset, and undercooked is worse than checked twice.
- `20 mins`, `1½ hours`, `90 seconds`, `½ hour` all parse. A bare number followed
  by no time word never does, so quantities and oven settings never become timers.
- The timer's **name** is the *last* cooking verb before the duration, from a
  closed list (`soak simmer boil bake roast fry sauté cook rest chill marinate
  steam grill brown reduce prove knead infuse steep poach sear toast blanch braise
  sweat warm cool stand set freeze refrigerate defrost rise`), title-cased, and
  **imperative only — no `-ing`**. "Pour over boiling water. Soak for 20 mins" is a
  pour and then a soak, and it is the soak you are counting; a participle is almost
  always describing an ingredient.
- **No duration found means no timer, not a timer set to zero.** A guess is not
  worth a button.

The button reads `Start soak 20 min` while idle, `Soak` while running (the number
beside it is the sentence), and `Soak done` when finished. It is one line, always
— a control you aim at with the back of a wrist must not change height between
steps. Beside it, **Reset**.

A **running timer keeps its place in the sequence**: its segment in the bar opens
out into the countdown, so a pan you walked away from is still findable. Tapping
it jumps back to that step.

Countdown digits animate as an **odometer** — each digit in an overflow-hidden
slot, the old one sliding down and out as the new one slides in from above, over
100ms. A second hand snaps to the next mark, it does not glide there.

Footer: **Previous** (an arrow on a phone, a labelled button on a laptop — it is
the one you press by mistake, and the width it gives up goes to the one you meant)
and **Next step**, which becomes **Finish** on the last step and returns to `/`.

Everything the cook touches — ticks, which step, a running timer — is **session
state**. None of it belongs to the recipe, and a checkbox still ticked next
Tuesday would be a small lie.

### 6.9 `/people`

A list: avatar, name, `Toddler · 2y 4m` derived from the date of birth, and badges
for their dietary constraints (**amber for allergies and intolerances**, neutral
for dislikes and preferences). Below it, an add form: name, optional date of
birth, with the caption "The date of birth is optional, but without it everybody
is assumed to be an adult."

Tapping a person opens an editor: name, date of birth, avatar photo, and their
constraints — each a `kind` (allergy / intolerance / dislike / preference) and a
free-text `tag`.

### 6.10 `/ingredients`

Search box. A list of canonical ingredients, each showing its name, a summary line
of its purchase units and aliases (`1 tin = 400g · tinned tomatoes · canned
tomatoes`), a badge with its base unit, and its aisle.

The editor lets you set the name, the base unit, the aisle, add aliases and
purchase units, and **merge this ingredient into another** — which sets
`merged_into` and `deleted_at` and needs no backfill anywhere.

A **"Link N recipe lines"** button reads through the whole library and resolves
every unlinked line to a canonical ingredient, creating rows as needed. This
exists instead of a migration, which would have had to guess the same things with
none of the context and no way for anybody to see what it did.

### 6.11 `/pantry`

What is already in the house. **The point is not bookkeeping** — nobody is going
to run an inventory on their own kitchen. It is the two onions left over from a
three-pack, so next week's list stops asking for onions. Everything is built to be
*corrected in one tap* rather than maintained.

Each row: the ingredient, the amount on hand in its base unit, and **steppers**.
One press of a stepper is: the household's own purchase unit if it has one (a tin
at a time beats a gram at a time), otherwise 1 for a counted ingredient or 100 for
a weight.

Add by typing a name (with suggestions) and optionally an amount. The amount is
free text read by the same parser the recipes use, so "2 tins" works wherever the
household has said what a tin is; a bare number means the base unit.

There is also a **paste-an-order** flow: paste a supermarket order confirmation
and review what it found before it lands.

### 6.12 `/settings`

Sections, each with a small uppercase dimmed heading:

- **Aisles** — an editable, reorderable list. "Put these in the order you walk the
  shop. The list follows this order." Renaming commits **on blur**, so a mutation
  is not queued per keystroke. Deleting needs confirmation: "Items in it move to
  Other. The aisle order is what the list is walked in, so this changes every
  future shop."
- **People** → `/people`. "Everybody who eats here, children included. Their ages
  decide the portions and their allergies decide what never gets planned."
- **Ingredients** → `/ingredients`. "The names your recipes share. Two recipes
  calling for the same thing become one line on the shopping list."
- **Pantry** → `/pantry`. "What is already in the house. Two onions left over from
  a three-pack means next week's list only asks for what you actually need."
- **Chores** — a list and an editor (name, whose, weekly days or a one-off date, an
  optional time). "These sit in Today's schedule alongside the calendar, and anyone
  can tick them off there. A day without one shows nothing."
- **Calendar** — read-only status, reporting what the server actually did:
  - `error` → an amber alert with the server's own words. *(A code would only send
    the reader back here to look it up.)*
  - `skipped` or never run → "No calendar connected — Set up on the server, not
    here: the sync function holds the account and the list of calendars."
  - `ok` → "N events cached — Google Calendar, synced every few minutes and cached
    on this device so the board still shows today with the wifi down."
  - Plus `Last checked 4 minutes ago`.
- **Always-on display** — a switch. "This screen never sleeps. For a tablet left on
  in the kitchen. Everything drifts a pixel at a time so the layout never burns
  into the panel — slowly enough that nobody sees it move. Press F for
  fullscreen." **Stored per device in local storage, not in the database** — the
  kitchen tablet is always on and a phone is not.
- **Household** — the name, the six-character **invite code** in large monospace
  with a copy button, and "Anyone with this code can join the household and see
  the list."
- **This device** — "N changes waiting to sync", and a sign-out button. Signing out
  is the **only** confirmation that is about the queue rather than the data: "N
  changes have not reached the server yet and will be lost."

### 6.13 Always-on display behaviour

When the switch is on, the **entire app drifts one pixel at a time around an
eight-point loop** — `(0,0) (1,0) (1,1) (0,1) (-1,1) (-1,0) (-1,-1) (0,-1)` —
moving every **4 minutes** with a 3-second linear transition. This is burn-in
mitigation, slow enough that nobody in the room will ever see it move and far
enough that no edge sits still long enough to burn. The drift rides on the app
shell so a route change never restarts it.

**`F` toggles fullscreen anywhere in the app**, except while anything is being
typed.

---

## 7. The algorithms

These are the parts worth getting exactly right. Implement each as a **pure
function** with no framework, database or network dependency, and test them
directly.

### 7.1 Life stage from a date of birth

Never store the label. Derive it every time it is read, so the baby ages up on its
own and nobody edits a config.

```
weaning  from 6 months
toddler  from 12 months
child    from 36 months
adult    from 156 months (13 years)
below 6 months → 'baby'
no date of birth → 'adult'
```

Count whole months **as a person would** — the count only goes up on the
day-of-month it went up on at birth. A 29 February birth date falls on 1 March in
most years, which is the ordinary convention and the kind one, since the
alternative is a child briefly a month younger than they were the day before.

A date of birth in the *future* is somebody mistyping, or a pregnancy entered
early; the youngest stage is the safe answer.

Compare dates as `YYYY-MM-DD` **strings**, never through `Date` arithmetic — no
timezones, no chance of a birthday landing a day early west of Greenwich.

Also produce an age label (`4m`, `2y 4m`, `3y`) shown next to the date of birth so
a typo is obvious.

### 7.2 Who is eating

**NO ROW MEANS PRESENT.** A row exists only once somebody has said otherwise. A
soft-deleted absence row counts as present — deleting the record of an absence is
saying the absence never happened.

`presentPeople(people, rows, date, meal)` = every live person minus those with a
live row for that (date, meal) carrying `present: false`.

`nightsPresent(person, dates, meal, rows)` counts over **the week's nights**, not
over the nights somebody has already planned a dinner for. Counting only planned
nights made an unplanned week say "0 of 0" to everybody, including the person who
is in for two of them.

### 7.3 Reading a quantity

Quantities stay free text. Nobody is going to fill in a number field and a unit
dropdown to write down a recipe — that friction is exactly why the Notion page
lost. So parse what is there and **give up cleanly** when you cannot. A line that
does not parse is not an error: it travels to the shopping list verbatim and sits
*beside* the total rather than inside it.

Accept exactly `<number> [unit] [×ratio]` and nothing else:

- Numbers: `400`, `1.5`, `1,5`, `1/2`, `1 1/2`, `½`, `1½`. **`1,500` is rejected**
  — three or more digits after a comma means thousands separator, and reading it
  as a decimal would shrink the amount a thousandfold.
- One unit word, letters only, or nothing. `2 tins drained` is rejected along with
  `a splash` and `2-3`. A parser that guesses at prose puts confident wrong numbers
  on a shopping list, which is worse than putting the words there unchanged.
- Fold the unit: lowercase, strip a trailing `s`, or `es` after `s/x/z/ch/sh`.
- A trailing `×1.5` is the servings hint (see 7.5). A `×` always counts; a plain
  ascii `x` only counts **after a unit word** (`400g x2`), because after a bare
  number (`2 x 400`) it is somebody writing two-of-something.

**Intrinsic units** mean the same thing for every ingredient:
`g/gram=1`, `kg/kilo=1000` → base `g`; `ml=1`, `cl=10`, `l/litre=1000` → base
`ml`.

Converting a parsed quantity to a base amount is **deliberately strict**:

- No unit at all → a count, and only if the ingredient's base unit is `count`.
  `400` on a flour line does not silently become 400g.
- An intrinsic unit → converted, but only if it matches the base unit. Millilitres
  never become grams.
- Anything else → look it up in this household's purchase units for that
  ingredient. A `tin` is 400 only because somebody said so.
- Otherwise `null`, which is the signal to show it as written.

**Formatting a total:** `800g`, `1.2kg`, `1.5l`, `3`. Scale up past a thousand,
because "1200g" is a number you have to think about and "1.2kg" is one you read
off a packet. Judge against the *rounded* value or 999.96 slips through as
"1000g".

**Formatting a purchase count:** always round **up** — three and a bit tins means
buying four — and mark inexact totals with a tilde: `2 tins`, `~3 tins`.

### 7.4 What a recipe line is called on the shopping list

A recipe says "chestnut mushrooms chopped" and "risotto rice such as arborio"
because it is telling you how to cook. In an aisle none of that is true yet: you
are buying mushrooms and risotto rice, and the extra words are the difference
between a line you read and a line you scan.

Applied **only on the way out of a recipe into a list**. The recipe keeps the
cook's own wording.

Two rules hold throughout:

- **Only trailing words are dropped.** "Chopped tomatoes" is a tin you buy, not
  tomatoes somebody chopped, and leading words are where that lives.
- **Never strip a line down to nothing.** A name half gone is worse than a name
  with a stray instruction on the end. If nothing survives, keep the original.

Steps:

1. Cut a qualifier clause and everything after it: `such as`, `or similar`,
   `or other`, `preferably`, `ideally`, `if you can`, `e.g.`, `i.e.`.
2. Cut trailing comma-clauses that *start* with a preparation word
   (", freshly grated", ", peeled and finely chopped").
3. Cut trailing preparation words one at a time: *chopped, finely, roughly,
   thinly, coarsely, freshly, lightly, diced, sliced, minced, crushed, peeled,
   grated, torn, halved, quartered, trimmed, drained, rinsed, beaten, melted,
   softened, cubed, shredded, deseeded, zested, juiced, sifted, washed, scrubbed,
   stoned, pitted, cored, seeded, skinned, boned, rolled, plus, optional*. Words
   that could be part of a *name* — tinned, smoked, ground, dried — stay out of
   this list. A connective (`and or then if to well very`) is only fluff once
   something was dropped after it, so "salt and pepper" keeps its pepper.

For the library pane only, additionally resolve `A or B` to the first
alternative — **except** where the second alternative ends in a shared head noun
and the first is a single modifier word. "chicken or vegetable stock" becomes
"chicken stock", not "chicken", which is a different aisle and a different dinner.
The shared-head list is: *stock, broth, flour, wine, sugar, milk, oil, rice,
sauce, yoghurt, vinegar, mince, pasta, bread, beans, lentils, butter, paste,
juice, water, seeds, nuts*. `cream` and `cheese` are deliberately **out**:
"yoghurt or soured cream" has the same shape and the opposite meaning, and no rule
on the words alone can tell those apart. Leaving them out costs a longer name;
leaving them in invents "Yoghurt cream".

### 7.5 Deriving the shopping list from the plan

**One row per (plan entry, recipe line)**, with a deterministic id, because that
row is the unit last-write-wins already reconciles correctly.

Everything falls out of one idea: **the plan owns an item until a person touches
it.**

- **A checked item is frozen.** Someone has it in the trolley; a plan edit at home
  must not rewrite or remove it.
- **An item deleted while its night is still planned was deleted by a person**, so
  it is not resurrected. Only *unwanted* ids are ever removed by the system, which
  is what makes that distinction safe to draw.
- **An unchecked item is refreshed from the recipe**, because the recipe is the
  source of truth until someone acts on the item. Its **aisle is only filled in
  when empty** — re-filing something mid-shop must survive a plan tweak.
- **Its canonical ingredient is stamped on and never unstamped.** Resolution
  improving is worth following; it going quiet because a device has not pulled the
  ingredient yet is not worth un-grouping a line somebody is looking at.
- **Items belonging to nights outside the derived range are left completely
  alone.**
- **Running it twice does nothing.**

The aisle for a new item, in priority order: the canonical ingredient's aisle
(the thing a person filed deliberately, and it holds for every recipe using it) →
the recipe line's own aisle → the household's remembered aisle for that name.

**Servings hint.** The quantity text is **never rescaled** — it is free text, and
"2 tins" times 1.5 is not a thing anyone can act on in an aisle. Instead, when a
night's servings differ from the recipe's base servings, annotate:
`2 tins ×1.5`. The quantity parser reads that annotation back as real arithmetic.

**Leftovers.** A night marked as leftovers of an earlier one **buys nothing**; the
source night's servings pick up the extra portions instead. The food is bought
once, with the night it is cooked on. Build this from *every* entry, not just the
range being derived — a leftovers night is at most a couple of days after its
source, so the two can straddle a Sunday, and the week containing only the Monday
must not quietly buy it twice. A night whose source has been deleted, or has not
reached this device yet, **defers to nobody and buys for itself**: the ids are
deterministic, so the extra items come straight back off on the next derive.

**A skipped night has no recipe and buys nothing**, and its existing rows come off
the list through the same reconciliation that removes a deleted night's rows.
Skipping a planned night un-buys it.

### 7.6 Aggregating the list for display

Two recipes in the same week both wanting tomatoes put **two rows** on the list.
Turn them into **one line reading "800g · 2 tins"** — computed **at render time and
never stored**.

This is the central decision of the ingredient phase and it is worth knowing why.
Storing a combined row would make the unit of conflict the whole week's
arithmetic: two phones deriving offline would converge on whichever computed last
rather than on the truth, and a third recipe wanting tomatoes *after* the line was
ticked could never surface, because a checked row is frozen — a silent under-buy
with no way back. Grouping at render time has none of that, and it means a merge,
a parser improvement or a new purchase unit **applies retroactively with nothing
rewritten**.

Rules:

- Group **per aisle bucket**, not across the whole list, so an ingredient somebody
  deliberately filed in two aisles stays in both places.
- Rows resolving to no ingredient pass through unchanged. This keeps the whole
  feature invisible until it has something to offer.
- **One row is still one row.** Showing a single row under its canonical name would
  rename what the recipe said for no benefit — keep its quantity verbatim.
- The caller passes only **live, unchecked** rows, which is why ticked rows need no
  special case: a checked row is simply not in the group, so the total covers only
  what is still to buy.
- **Add up what can be added up and keep the rest as written.** A line reading "a
  splash of passata" cannot join a total, but dropping it would mean the list
  quietly asked for less than the recipes do. Keep it verbatim after a `+`:
  `800g · 2 tins + a splash`.
- Order lines by the **earliest row each stands for**, so a line does not jump up
  the aisle because a second recipe started needing it.
- Chase `merged_into` pointers (with a depth cap) when resolving an ingredient.

**Pantry coverage.** When there is stock of an ingredient, subtract it. The number
shown is **always what to put in the trolley**, because that is the question being
asked while standing in an aisle; where it came from is said in words beside it,
so a line that shrank never looks like a line that was wrong:

- Partly covered: `400g · 1 tin · 400g in the pantry`
- Fully covered: `800g · 2 tins · from the pantry` — the recipe's own amount is
  still the useful number, because it is what to take out of the cupboard.

### 7.7 Guessing an aisle

A lookup table, **deliberately not a model call**: this is one household's weekly
shop, the same eighty things over and over, and a lookup answers instantly,
offline, for free, and the same way every time. Anything it does not know gets no
aisle — which is exactly what happened before — and the moment somebody files it
by hand, the remembered aisle knows better and takes over.

Match **whole words** against the tidied name, **longest key first**, so "chestnut
mushrooms" finds `mushroom` and "spring onion" beats `onion`. A trailing plural
still counts as the same word, but `pepper` must not match inside `peppercorn`.

The table maps ~150 ingredient words to one of eight **categories**, and the
category is then resolved to whichever aisle *this household actually has*, by
name. A guess cannot name an aisle id — aisles are per-household rows somebody can
rename or delete. A household that renamed "Fruit & veg" to "Fruit and
Vegetables" still gets its garlic filed correctly; one that deleted the aisle gets
no guess, which is the honest answer.

Categories and a representative sample of their words:

- **fruit & veg** — onion, spring onion, shallot, garlic, ginger, chilli, potato,
  carrot, celery, leek, mushroom, pepper, courgette, aubergine, broccoli, spinach,
  tomato, lemon, lime, apple, banana, avocado, parsley, coriander, basil, thyme…
- **meat & fish** — chicken, beef, pork, lamb, mince, sausage, bacon, chorizo,
  salmon, cod, tuna, prawn…
- **chilled** — milk, butter, cheese, parmesan, feta, halloumi, cream, yoghurt,
  egg, tofu, pastry…
- **bakery** — bread, roll, baguette, pitta, tortilla, wrap, naan, bagel…
- **frozen** — frozen, ice cream, puff pastry
- **cupboard** — rice, pasta, noodle, lentil, chickpea, flour, sugar, salt, oil,
  vinegar, stock, passata, coconut milk, soy sauce, honey, mustard, peanut butter,
  oats, cumin, paprika, chocolate, tea, coffee…
- **drinks** — wine, beer, juice
- **household** — bin bag, washing up liquid, kitchen roll, toilet roll, cling
  film, foil, detergent, nappies, sponge

### 7.8 The generator

**Selection, never invention.** It picks from the library and nothing else.

The shape is: **hard-filter → score → pick at weighted random.** The last step is
the one that matters most. Taking the highest score every time converges on the
same five dinners within a fortnight, which is exactly the rut this is supposed to
get the household out of — so a good candidate is *likely*, not certain.

**Nights are decided in order**, because the ingredient-overlap score depends on
what has already been chosen: half a bunch of coriander is a reason to cook the
other thing that wants coriander.

Make it **pure, and take the randomness as an argument**, so a test can pin the
outcome.

**Hard filters (a candidate is absent, not low-scoring):**

- Already chosen this week — no recipe twice, however good it looks.
- Contains anything matching an **allergy or intolerance** of somebody eating that
  night. Match by **substring on the normalised tag against ingredient names**, and
  deliberately generously: "peanut" has to catch "peanut butter", and *the cost of
  over-excluding one dinner is a duller week while the cost of under-excluding one
  is a hospital.*

**Scoring weights:**

| Component | Value | Note |
|---|---|---|
| shortlist bonus | **+4** | Somebody said they want this soon |
| never cooked | +2 | Worth trying |
| recency penalty | **−6 × staleness** | `staleness = max(0, 21 − days_since) / 21` |
| ingredient overlap | +1.5 each, capped at 3 | Per canonical ingredient shared with the rest of the week |
| over the night's budget | −0.08 per minute, capped at 4 | |
| under the night's budget | −0.01 per minute, capped at 4 | Mild |
| dislike | −2 | Per person present who dislikes something in it |
| preference | +1 | Per person present who asked for it |
| **temperature** | **1.5** | `weight = exp(score / temperature)` |

At this temperature a candidate two points ahead is roughly four times as likely —
a strong lean, not a foregone conclusion. The shortlist bonus is larger than every
other bonus put together (roughly a fourteen-fold lean) so a shortlisted meal
usually lands. *Usually*, not always: it is still smaller than the recency penalty,
so shortlisting something cooked on Tuesday does not put it back on the table on
Thursday, and it cannot argue at all with the hard filters, which are not scored.

**Effort budget per night**, in minutes of prep plus cook: weekends **75**, Friday
**50**, other weeknights **30**. Weeknights are short because they are weeknights.

**Servings** come from the roster, not the recipe: the number of **eaters**, where
a pre-weaning `baby` is present at the table and eating nothing off it, so is not a
portion. Everybody else is one, **including the toddler who will eat a third of
theirs** — the alternative is a plan that quietly under-caters.

**Nights nobody is home get nothing**, which is the correct plan for them. Nights
where every candidate is filtered out also get nothing, rather than something
somebody is allergic to.

**Nights already planned by a person are left alone**, but still count towards
overlap and towards not repeating. The generator fills gaps; it does not overrule
anybody.

**Leftovers.** If the winning recipe's `base_servings ≥ 2 × tonight's eaters`,
offer *tomorrow* the leftovers — but only if tomorrow is not already planned by a
person (they said what they wanted to eat), and only if tomorrow's eaters fit in
what is genuinely left (`≤ base_servings − tonight's eaters`). Feeding six off a
four-serving batch is how a household learns not to trust the plan. Deciding this
*outside* the selection loop keeps the leftovers night from bending the no-repeat
rule, and reheating costs no effort so no budget is checked.

**Every suggestion says why it is there**, and the sentence must stay true to what
the scorer actually rewarded — the two drifting apart is how an app starts lying
about why it suggested something. Track which component *added* the most as the
score is built (only bonuses compete; a penalty avoided is not an argument for a
meal):

| Reason | Sentence |
|---|---|
| everything already in the cupboard | "All pantry — nothing to buy" *(wins over all others when true)* |
| shortlist | "On the shortlist" |
| never | "Never cooked — worth a try" |
| overlap | "Shares 2 ingredients with the rest of the week" |
| quick | "25 min — fits a 30 min night" |
| liked | "Somebody eating asked for it" |
| rested, 4+ weeks | "Not cooked in over a month" |
| rested, 1–3 weeks | "Nothing like it for 2 weeks" |
| cooked more than twice | "Cooked 6× — nobody complains" |
| nothing else to say | "Not on the plan yet" |

Return candidates in **library order, not score order** — a weighted pick maps a
given random number onto a different recipe if the list is permuted, so sorting
would silently reshuffle every seeded outcome. Provide a separate "top N" function
for leaderboards, which ties-breaks by name rather than by chance.

### 7.9 Chores

Nothing is stored per day. A weekly chore is **one row saying "Tuesdays"**, and
every Tuesday it will ever have is worked out at read time. That is what keeps it
working on a tablet that has been in airplane mode for a fortnight, with no job
minting occurrences forward and nothing to catch up on.

A one-off shows only on its own date and **does not carry forward when missed** —
a board that accumulates everything nobody got round to stops being today's board.

Compute the ISO weekday of a date string through UTC on its parts, not by parsing
it as a local date — going via local midnight is what makes the answer wrong on
the two mornings a year the clocks move.

Sort untimed first, then by clock, then by name, so two chores at 09:00 never swap
places between renders.

### 7.10 Dates and weeks

**Everything works in local time.** Never use `toISOString()` to produce a date key
— it converts to UTC first, so planning dinner at 11pm in British Summer Time
would file it under tomorrow.

Weeks start **Monday**, which is how a shop is planned.

Week labels use **ISO-8601 week numbers** (`Week 31`), because the board prints the
number next to a date and ISO and "how many Mondays into the year" disagree around
New Year. Date ranges read `4 – 10 Aug`, or `28 Jul – 3 Aug` when the week
straddles two months.

---

## 8. Server-side work

The client is a static bundle, so there are no server routes. Anything that needs
a server is a small isolated function.

### 8.1 Recipe import from a URL

The client cannot read another origin's HTML, so a server function fetches the
page and reads its **schema.org `Recipe` JSON-LD**, which nearly every recipe site
already publishes. **That path costs nothing: no model call, no wait.** Only a
page without it falls back to a language model.

Either way, **split the quantity off each ingredient line** so an import lands in
the same canonical ingredients a typed recipe would, and strip preparation clauses
the same way the shopping-name rules do.

Pasting the same address twice must land on the recipe it already made, not a
second copy.

### 8.2 Recipe import from photographs

A multimodal model reads one or more photographs of a cookbook page and returns
the same structured recipe shape.

### 8.3 Nutrition estimate

A model estimates the eight per-serving figures from the ingredient list. **It
fills only the blanks.**

### 8.4 Calendar sync

A scheduled job every five minutes reads the family's calendars with a **service
account** (not per-user OAuth) and upserts them into `calendar_events`. Clients
only ever *read* that table. The cache is not an optimisation — it is the only
reason the schedule card survives the wifi dropping.

Skip rows whose source last-modified stamp is unchanged; every rewrite would be
broadcast to every device over realtime, which is a lot of traffic to say nothing.

**Every run records what it did** in `calendar_sync_status`. That table exists
because absence of events used to be the only symptom, and it was the symptom of
five different things — four of which produced no log line anywhere. A missing
secret, an unconfigured calendar list, a calendar never shared with the service
account: all of them now say so on the screen instead of looking like a household
that never bothered.

Until it is configured, the job fires and does nothing, which is the right
behaviour for a household that has not connected a calendar.

### 8.5 Keepalive

If your backend pauses free projects after a period of inactivity, ping it **every
2–3 days from outside the system** — a scheduled job inside a paused database
cannot unpause it. **Do not rely on the weekly generation job for this**: a 7-day
cycle racing a 7-day timer will lose.

### 8.6 Weather

Fetched from a keyless service (Open-Meteo), for a configured latitude and
longitude, and **cached in local storage** so an offline device keeps the last
reading.

---

## 9. Copy and tone

The app talks like a person who knows the household. It is specific, never
cheerful, and never blames the user.

Rules that produced most of the copy in this document:

- **Say the thing in words, not with an icon alone.** "Offline · last synced 15:58"
  tells you how much to trust the rest of the screen; a red dot does not.
- **Never blame staleness for an absence that predates it.** A household that has
  never connected a calendar sees "No calendar connected", not "Last synced never".
- **Never celebrate something that has not happened.** An empty list is only green
  if it was emptied.
- **A device that has never completed a sync is new, not stale**, and gets no
  offline pill.
- **Say what will actually be lost.** "3 changes have not reached the server yet
  and will be lost", not "Are you sure?"

---

## 10. Build order

Do not build later phases before earlier ones work.

1. **The shopping list alone.** No recipes, no plan, no generator. Manual add, tick
   off, aisle sort, offline, shared between two phones and a tablet. *This is the
   thing used daily and it is what has to beat WhatsApp.*
2. **Recipe library + a manual weekly plan**, with the list derived from it.
3. **Canonical ingredients**: aliases, purchase units, aggregation across recipes.
4. **The roster** — people, life stages, dietary constraints, attendance.
5. **The generator.**
6. **Recipe import** — JSON-LD first, model fallback only for the rest.
7. **Today / the kitchen board**, cook mode, chores, calendar, pantry, nutrition.

**Do not build 5 before 1 works and is in daily use.**

---

## 11. Acceptance tests

Write these as real end-to-end tests against the built bundle.

1. **Offline round trip.** Create a household, add items, go offline, add and tick
   more, kill the app, reopen it still offline, cold-open a route that was never
   prerendered, come back online. The server ends up with exactly what the screen
   showed.
2. **Two devices.** Join from a second browser profile as a second person; a change
   on one shows up on the other over realtime.
3. **Plan → list.** Drive a recipe onto a night onto the shopping list. Deriving
   twice changes nothing. Taking a night off clears what it added **without
   touching anything already ticked**.
4. **One line, two recipes.** Two recipes wanting the same thing become one line.
   The unit is inferred from a quantity typed a moment later. Two ingredients
   merge and the list heals **with no re-derive**. The line reads "800g · 2 tins".
   Ticking it takes both rows behind it. *(Check the local database as well as the
   screen — "one line" and "one row" are different claims and only one is
   visible.)*
5. **The roster.** Add a child; check the life stage was **derived rather than
   typed**; record an allergy; mark them out on one night. The load-bearing
   assertion is about a row that does not exist: **no row means present**, so
   marking one child out must write exactly one row and say nothing about anybody
   at home.
6. **The generator.** Build a library, record a peanut allergy, choose one night by
   hand and fill the rest. Nothing repeats. The allergen never reaches the plan or
   the list. The hand-chosen night survives. Servings came from the roster, not the
   recipe default.
7. **URL import.** Paste an address; check it was fetched rather than becoming the
   name of an empty recipe: the address is remembered on the row, quantities arrive
   split off the names, every line is canonicalised, and pasting the same address
   again lands on the recipe it already made.
8. **The board at 1280×800.** Walk all four sections through five states: a
   brand-new household with nothing set up; no plan and the one filled button;
   pressing it to get a real week; an empty shopping list; and the network
   dropping. Tick an item off, plan a night from the wide grid, and check the
   header survives every move without changing. Check the roster adapts by derived
   life stage, that nothing overflows sideways, and that **going offline keeps
   every fact on screen while removing the now-marker**, with no spinner and no
   error screen anywhere. Finish with a pass at 390×844 to confirm the same routes
   answer at phone width with the tab bar instead of the header.

---

## Appendix A — the reference implementation's stack

Match this if your tool can; otherwise use the nearest equivalent and keep every
behaviour above.

| Thing | Choice |
|---|---|
| Framework | Nuxt 4.5+ (**not** Nuxt 3 — EOL 31 July 2026), `ssr: false` |
| UI | Nuxt UI v4 (all 110+ components are in the free library) |
| Backend | Supabase, free tier |
| Supabase module | `@nuxtjs/supabase` v2.x, with `useSsrCookies: false` and `redirect: false` |
| PWA | `@vite-pwa/nuxt` |
| State | Pinia |
| Local persistence | IndexedDB via Dexie |
| Server-side work | Supabase Edge Functions |
| Deploy | static generate → Netlify / Cloudflare Pages |

`useSsrCookies: false` makes the Supabase module use the standard client with the
session in local storage rather than SSR cookies — the documented recommendation
for statically generated sites, and what keeps the shared kitchen tablet signed in
indefinitely. `redirect: false` disables the module's login-redirect middleware in
favour of the hand-rolled auth gate described in §5.

Schema changes go through **numbered SQL migration files in version control**,
never a dashboard table editor.

---

## Appendix B — a phased prompt sequence

If your tool works better with several smaller prompts than one large one, use
this document as the standing brief and drive it in these steps:

1. "Read the brief. Build §4 (the data model) and §5 (the offline layer) and
   nothing else. Prove it with acceptance test 1."
2. "Build §6.4, the shopping list, plus the aisle settings in §6.12. Nothing else.
   It must open offline and beat WhatsApp on friction."
3. "Build §6.6 and §6.7 (the recipe library and editor) and §6.5 (the plan), plus
   §7.5 — deriving the list from the plan. Prove it with acceptance test 3."
4. "Build §7.3, §7.4, §7.6 and §7.7 — quantities, shopping names, aggregation and
   aisle guessing — plus §6.10, the ingredients screen. Prove it with acceptance
   test 4."
5. "Build §6.9 (people), §7.1 (life stage) and §7.2 (attendance). Prove it with
   acceptance test 5."
6. "Build §7.8, the generator, and wire it to the fill button on the plan. Prove it
   with acceptance test 6."
7. "Build §8.1–8.3, the import and estimate functions. Prove it with acceptance
   test 7."
8. "Build §6.3 (Today), §6.8 (cook mode), §7.9 (chores), §6.11 (pantry) and §8.4
   (calendar sync). Prove it with acceptance test 8."
