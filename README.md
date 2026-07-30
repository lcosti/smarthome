# Household shopping list

An offline-first shopping list for one household. Phase 1 of the meal planner
described in [CLAUDE.md](./CLAUDE.md) — the list only, no recipes or meal plans
yet.

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

### The acceptance test

`pnpm acceptance` runs the test CLAUDE.md defines as the bar for this phase, in a
real browser against the production bundle: create a household, add items, go
offline, add and tick more, kill the app, reopen it still offline, come back
online, and check the server ended up with exactly what the screen showed. It then
joins from a second browser profile as a second person and checks that a change on
one device shows up on the other over realtime.

```bash
pnpm exec playwright install chromium   # once
pnpm generate && pnpm acceptance
```

It needs the local Supabase stack running, and it serves the built bundle itself on
port 4001 — deliberately not the dev server's 4000, so `pnpm dev` can stay up while
this runs. Each run creates its own household, so it is
safe to run repeatedly without resetting the database. This is the check to run
before deploying anything that touches the sync layer.

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

- Ids for items and aisles are minted on the device (`crypto.randomUUID()`), so
  rows can be created in airplane mode and pushed later.
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
children — `people` rows simply have no `auth_user_id`, which is what Phase 2
builds on.

## Icons

`node scripts/generate-icons.mjs` regenerates the PWA icon set (a tick on a dark
rounded square) into `public/`. Edit the colours at the top of that script rather
than hand-editing the PNGs.
