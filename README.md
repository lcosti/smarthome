# Household meal planner

An offline-first meal planner for one household, described in
[CLAUDE.md](./CLAUDE.md). Phases 1 to 3 are built: the shopping list, a recipe
library with a manual weekly plan the list is derived from, and canonical
ingredients so that two recipes wanting the same thing become one line to buy.

The generator (phase 4) and recipe import from URLs (phase 5) are not built.

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

Three of them, each driving a real browser against the production bundle. They are
the check to run before deploying anything that touches the sync layer.

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

```bash
pnpm exec playwright install chromium   # once
pnpm generate && pnpm acceptance && pnpm acceptance:phase2 && pnpm acceptance:phase3
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

## Deploying

Once you have created a Supabase project (free tier) and a Netlify site:

1. **Push the schema.**
   ```bash
   pnpm supabase login
   pnpm supabase link --project-ref <ref>
   pnpm supabase db push
   pnpm supabase functions deploy keepalive
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
children — `people` rows simply have no `auth_user_id`, which is what the generator
will build on when it adapts a meal per person present.

## Icons

`node scripts/generate-icons.mjs` regenerates the PWA icon set (a tick on a dark
rounded square) into `public/`. Edit the colours at the top of that script rather
than hand-editing the PNGs.
