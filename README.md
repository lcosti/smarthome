# Household meal planner

An offline-first meal planner for one household, described in
[CLAUDE.md](./CLAUDE.md). All five phases are built: the shopping list, a recipe
library with a weekly plan the list is derived from, canonical ingredients so that
two recipes wanting the same thing become one line to buy, a generator that fills
the week from the library, and recipe import.

The household roster feeds the generator: people (children and babies included,
with no login), what each of them cannot or will not eat, and who is home on which
night. Life stage is derived from a date of birth every time it is read, so the
baby ages up on its own.

A recipe gets into the library three ways: typed, photographed, or pasted as a
link. The link path fetches the page in an Edge Function — a static site cannot
read another origin's HTML — and reads the schema.org `Recipe` JSON-LD that nearly
every recipe site already publishes. That path costs nothing: no model call, no
wait. Only a page without it falls back to the LLM. Either way the quantity is
split off each ingredient line, so an import lands in the same canonical
ingredients a typed recipe would.

Nuxt 4 SPA (`ssr: false`) + Supabase, deployed as a static bundle to Netlify.
State lives in Pinia, persists to IndexedDB via Dexie, and syncs through a
mutation queue of plain upserts.

## Local development

Needs Docker running, for the local Supabase stack.

```bash
pnpm install
pnpm supabase start          # prints the API URL and keys
cp .env.example .env         # then paste the publishable key into SUPABASE_KEY
pnpm dev
```

Useful local URLs:

| What | Where |
|---|---|
| App | http://localhost:4000 |
| Supabase Studio | http://127.0.0.1:54323 |
| Mailpit (catches magic-link emails) | http://127.0.0.1:54324 |

First run: request a magic link, open it from Mailpit, then choose **Join** on the
welcome screen and enter `DEV123` — the invite code of the household in
`supabase/seed.sql`.

```bash
pnpm test          # sync queue and reconciliation logic
pnpm lint
pnpm typecheck
pnpm generate      # static build into .output/public
```

### The acceptance tests

Each drives a real browser against the production bundle. They are the check to
run before deploying anything that touches the sync layer.

`pnpm acceptance` is the bar CLAUDE.md sets: create a household, add items, go
offline, add and tick more, kill the app, reopen it still offline, come back
online, and check the server ended up with exactly what the screen showed. It also
cold-opens a route that was never prerendered while offline, which is the only
thing that proves the service worker's navigation fallback is registered. Then it
joins from a second browser profile as a second person and checks that a change on
one device shows up on the other over realtime.

`pnpm acceptance:phase2` drives a recipe to a night on the plan to the shopping
list, and checks that deriving twice changes nothing and that taking a night off
clears what it added without touching anything already ticked.

`pnpm acceptance:phase3` drives two recipes wanting the same thing down to one
line: the unit inferred from a quantity typed a moment later, two ingredients
merged, the list healing with no re-derive, "800g · 2 tins", and ticking the line
taking both rows behind it. It reads IndexedDB as well as the screen, because "one
line" and "one row" are different claims and only one of them is visible.

`pnpm acceptance:photo-import` drives a photograph of a recipe into a recipe in
the library, with the LLM stubbed at the network seam so it needs no API key.

`pnpm acceptance:roster` adds a child, checks the life stage was derived rather
than typed, records an allergy, and marks them out on one night. Its load-bearing
assertion is about a row that does not exist: no row means present, so marking one
child out must write exactly one row and say nothing about anybody at home.

`pnpm acceptance:generator` builds a library, records a peanut allergy, chooses one
night by hand and fills the rest. It checks that nothing repeats, that the allergen
never reaches the plan or the list, that the hand-chosen night survives, and that
servings came from the roster rather than the recipe default.

`pnpm acceptance:url-import` pastes a recipe's address into the one box on the
recipes page and checks it was fetched rather than made the name of an empty
recipe: the address is remembered on the row, the quantities arrive split off the
names, every line is canonicalised, and pasting the same address again lands on
the recipe it already made instead of a second copy. The Edge Function is stubbed
at the network seam; its JSON-LD reader is covered by `pnpm test`.

`pnpm acceptance:board` opens the app at 1280×800 — a landscape kitchen tablet —
and drives it through five of its states: a brand-new household with nothing set
up, no plan and the one filled button, pressing it to get a real week, an empty
shopping list, and the network dropping. It also walks all four sections, ticking
an item off the list and planning a night from the wide week grid, and checks the
header survives every move without changing. It checks the roster adapts by
derived life stage, that nothing overflows sideways, and that going offline keeps
every fact on screen while removing the now-marker, with no spinner and no error
screen anywhere. It finishes with a short pass at 390×844 to confirm the same
routes answer at phone width with the tab bar instead of the header. Screenshots
land in `.acceptance/board/`.

```bash
pnpm exec playwright install chromium   # once
pnpm generate && pnpm acceptance && pnpm acceptance:phase2 && pnpm acceptance:phase3
pnpm acceptance:photo-import && pnpm acceptance:roster && pnpm acceptance:generator
pnpm acceptance:url-import && pnpm acceptance:board
```

They need the local Supabase stack running, and each serves the built bundle itself
on port 4001 — deliberately not the dev server's 4000, so `pnpm dev` can stay up
while they run. Every run creates its own household, so they are safe to run
repeatedly without resetting the database.

## Schema changes

Migrations are numbered SQL files in `supabase/migrations/`, and they are the only
way the schema changes — never the Studio table editor.

```bash
pnpm supabase migration new <name>
pnpm supabase db reset        # replays every migration from scratch, then seeds
pnpm db:types                 # regenerate shared/types/database.types.ts
```

`pnpm db:types` writes a generated file; commit it, since typecheck depends on it.

## How the offline layer works

Everything the app knows lives in IndexedDB, so the list opens with no network and
no valid session — reads come from the cache and writes queue locally. Auth is
needed to sync, not to shop.

- Ids are minted on the device (`crypto.randomUUID()`), so anything — an item, a
  recipe, a planned night, an ingredient — can be created in airplane mode and
  pushed later. Two ids are derived instead of random, so that two devices doing
  the same thing offline converge on one row rather than two: a derived list item
  is a uuidv5 of its (plan entry, recipe line) pair, and an ingredient alias is a
  uuidv5 of its (household, ingredient, alias).
- Every queued write is a **full row snapshot**, not a patch. That makes draining
  idempotent and order-independent, which is what lets last-write-wins be
  sufficient. Insert, edit, tick, untick and delete are all the same operation.
- Deletes are soft (`deleted_at`), so deleting is an ordinary upsert too.
- `updated_at` is set by the client and never by a database trigger, because it is
  the comparison key for deciding whether a server row is newer than local state.
- A row with a queued write is never overwritten by anything arriving from the
  server, which is what stops a stale echo from undoing an unsynced change.

The queue drains on reconnect, on app focus, after each write, and on a 30-second
timer. An unreachable server leaves the queue completely intact; only a write the
server actively rejects is counted against a retry limit and eventually dropped
with a toast.

`app/utils/sync.ts` holds this logic as plain functions with no Nuxt or Supabase
dependency, and `tests/sync.test.ts` covers it. `app/composables/useSync.ts` is
the only file that talks to the network.

Which tables sync is a registry in `app/utils/db.ts`. It drives the Dexie stores,
the hydrate, the pull order, the realtime subscription and the typing, so adding a
table is an entry there plus a Dexie version bump. Pull order is load-bearing:
parents land before the rows that reference them, so a fresh device can resolve a
derived item's recipe and ingredient on first paint.

## Where the shopping list comes from

Nobody maintains the list. `app/utils/derive.ts` works out what a week of the plan
should put on it, and the button on `/plan` commits the result. One row per (plan
entry, recipe line), because that row is the unit last-write-wins already
reconciles correctly. A checked item is frozen, an item somebody deleted is not
resurrected, an unchecked one is refreshed from the recipe, and running it twice
does nothing.

Combining rows into "800g of tomatoes" is a **display** concern —
`app/utils/aggregate.ts`, computed at render time and never stored. Storing it
would make the unit of conflict a whole week's arithmetic: two phones deriving
offline would converge on whichever computed last, and a third recipe wanting
tomatoes after the line was ticked could never surface, because a checked row is
frozen. Grouping at render time has none of that, and it means a merge, a parser
improvement or a new purchase unit applies retroactively with nothing rewritten.

## Two shapes, one app

There is no separate dashboard. Every route answers at both sizes: a phone column
with a tab bar along the bottom, and a desktop layout with the navigation in a
sticky header. The line is 1024px — Tailwind's `lg` — and `app/composables/
useWide.ts` is the single place that asks, so the pages that adapt with `lg:`
classes and the components swapped with `v-if` cannot disagree about where it is.

Most pages are one DOM at two widths. Two are not: the plan (seven rows on a
phone, seven columns on a wide screen) and the recipe library (a list, or master
and detail) are genuinely different trees with different scripts, so
`app/components/PlanWeekWide.vue` and `app/components/RecipeLibraryWide.vue` are
swapped in rather than rendered twice and hidden with CSS.

| Route | What it is for |
|---|---|
| `/today` | Tonight's meal, who is eating it, the schedule, the list, the week |
| `/` | The shopping list — the page that has to open instantly on a phone |
| `/plan` | Seven nights; tap one to choose, adjust or clear a recipe |
| `/recipes` | The library, and `/recipes/<id>/cook` for a recipe at hob size |

Cook mode is chromeless at both widths, declared as `chromeless: true` in its own
page meta rather than the shell matching on a path — `/recipes` keeps its chrome
and `/recipes/<id>/cook` does not, and that is a distinction a regex gets wrong
the first time either route moves.

`buildHeader` is split out of `buildBoard` so `AppHeader` can derive the strip
along the top without deriving a hero first.

Everything the Today page shows is derived in `app/utils/board.ts` — one pure function, one
view model. Its seven content states (setup, nominal, no plan, empty list,
offline, nobody home, late evening) are **not** seven templates: they fall out of
the facts, which is why offline and an empty list can be true at the same time as
any of the others. `tests/board.test.ts` covers all seven.

`setup` is the one the design did not have. Every other state assumes a working
household, so a brand-new one fell through to "nobody home for dinner — the
calendar has everyone out": there was no everyone, and no calendar. It also made
the one filled button unreachable, and the generator does nothing without a
roster and a library anyway. So a household missing either gets a truthful hero,
a three-step checklist, and a button pointing at whichever step is actually next.

The same rule applies to the smaller copy: green is spent only on a list that was
cleared, not one never used; the schedule says `No calendar connected` rather
than blaming staleness for an absence that predates it; and a device that has
never completed a sync is new, not stale, so it gets no offline pill.

Today re-derives on a 30-second tick, so it moves from tonight's meal to
tomorrow's on its own once dinner is an hour and a half behind it. Person colours
come from `app/utils/person-colors.ts`, which rotates hue at fixed lightness and
chroma — a fifth household member is one entry in `HUES`, not a new palette.

**Always-on display** is a switch in Settings, for a tablet left on in the
kitchen. It drifts the whole app a pixel at a time around a slow loop, which is
burn-in mitigation; `F` toggles fullscreen anywhere in the app, except while you
are typing. It is stored per device in localStorage, not in the database — the
kitchen tablet is always on and a phone is not.

Today's calendar comes from `calendar_events`, a read-only synced table written
only by the `sync-calendar` Edge Function (see below). Weather comes from
Open-Meteo, cached in localStorage so an offline device keeps the last reading.

### Google Calendar

`supabase/functions/sync-calendar` reads the family's calendars with a Google
service account every five minutes (a `pg_cron` job created by
`20260730000005_calendar_events.sql`) and upserts them into `calendar_events`.
Clients only ever read that table. The cache is not an optimisation — it is the
only reason the schedule card survives the wifi dropping.

One-time setup is documented in the migration's header: a Google Cloud project
with the Calendar API enabled, a service account whose email the calendars are
shared with, then `supabase secrets set` and two `vault.create_secret` calls.
Until those exist the cron job fires and does nothing, which is the right
behaviour for a household that has not connected a calendar.

It needs no Google account to develop against:

```bash
echo 'GOOGLE_CALENDAR_MOCK=1' >> supabase/functions/.env
supabase functions serve sync-calendar --env-file supabase/functions/.env
curl -X POST http://127.0.0.1:54321/functions/v1/sync-calendar   # twice: the
# second run soft-deletes the event the fixtures drop
```

The scheduled sync does **not** replace `.github/workflows/keepalive.yml`. A cron
job inside a paused database cannot unpause it, so the external ping stays.

## Deploying

Once you have created a Supabase project (free tier) and a Netlify site:

1. **Push the schema.**
   ```bash
   pnpm supabase login
   pnpm supabase link --project-ref <ref>
   pnpm supabase db push
   pnpm supabase functions deploy keepalive
   ```

   The two import functions need an Anthropic key, so deploy them only once it is
   set. Without it, typing and photographing still work, and a pasted link still
   works for any page that publishes JSON-LD — only the fallback needs the model.
   ```bash
   pnpm supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   pnpm supabase functions deploy import-recipe-photo import-recipe-url
   ```

2. **Netlify.** Create a site from this repo. `netlify.toml` sets the build
   command and publish directory. Set these site environment variables **before
   the first deploy** — they are baked into the bundle at build time, so changing
   them later requires a rebuild:

   - `SUPABASE_URL` — `https://<ref>.supabase.co`
   - `SUPABASE_KEY` — the project's publishable (anon) key

3. **Auth redirect allowlist.** In the Supabase dashboard under Authentication →
   URL Configuration:
   - Site URL: `https://<your-site>.netlify.app`
   - Additional redirect URLs: the same, plus `http://localhost:4000`

   Magic links refuse to redirect anywhere not on this list, which is the usual
   cause of a link that signs you in and then dumps you straight back to login.

4. **Keepalive.** Add a repository secret `SUPABASE_KEEPALIVE_URL` set to
   `https://<ref>.supabase.co/functions/v1/keepalive`. The `keepalive` workflow
   pings it every two days so the free tier's seven-day idle timer never fires.
   Without this the project pauses during any quiet week and the app stops
   working. Run the workflow manually once to confirm it returns `ok`.

## Household setup

The first person to sign in creates the household; everyone else joins with the
six-character invite code shown on the settings screen. There are no accounts for
children — `people` rows simply have no `auth_user_id`, and are added on the
**People** screen behind settings along with their dates of birth and anything they
cannot or will not eat.

Who is home is set per night, in the plan's night editor. Nothing is written until
somebody is marked out: no row means present, so a quiet week costs no writes and a
newly added baby is counted before anybody touches a toggle.

## Icons

`node scripts/generate-icons.mjs` regenerates the PWA icon set (a tick on a dark
rounded square) into `public/`. Edit the colours at the top of that script rather
than hand-editing the PNGs.
