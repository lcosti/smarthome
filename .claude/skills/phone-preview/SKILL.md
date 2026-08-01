---
name: phone-preview
description: Launch this app and look at a page as it renders on a phone (or a wide screen), with a household and a list already seeded. Use when checking a layout or UI change for real rather than only in tests — "does this look right on mobile", "screenshot the shopping list", "open /plan and check the cards" — or when reproducing a reported visual bug.
---

# Seeing a page as a phone sees it

The app is `ssr: false` and offline-first, so a page needs no server to render:
a household in `localStorage` and rows in IndexedDB are the whole of it. That is
what makes this cheap — no Supabase stack, no sign-in, no seed SQL.

## The loop

```bash
pnpm install                                    # first time in a fresh container
(pnpm dev >/tmp/dev.log 2>&1 &)
timeout 90 bash -c 'until curl -sf http://localhost:4000 >/dev/null; do sleep 1; done'

node .claude/skills/phone-preview/preview.mjs /shopping
```

It prints a JSON report and writes a screenshot to `/tmp/phone-preview/`.
**Read the screenshot** — a blank frame means it never painted, and the
`pageErrors` array in the report says why.

Stop the server with `lsof -ti:4000 -sTCP:LISTEN | xargs -r kill`. Kill by port,
not `pkill -f`: a broad pattern can match this session's own command line.

## Options

| Flag | Effect |
|---|---|
| `--wide` | 1280×800 instead of 390×844. The app switches layout at `lg`, and several pages are genuinely two different designs — check both. |
| `--full` | Full-page screenshot rather than one viewport. |
| `--seed rows.json` | Your own rows instead of the built-in shopping list. |
| `--out DIR` | Where screenshots land. Default `/tmp/phone-preview`. |

Default seed is four aisles of six items — enough to fill more than one screen,
which is where layout problems live. Three rows hide most of what is worth
looking at.

### Seeding another page

`--seed` takes a JSON object keyed by **Dexie store name**, each holding whole
rows: `{"recipes": [...], "meal_plan_entries": [...]}`. Store names are mostly
the Postgres table names, with one exception — the shopping list's store is
`items`. `SYNC_TABLES` in `app/utils/db.ts` is the mapping, and the row shapes
are `shared/types/database.types.ts`. Unknown store names are skipped and the
report's `seeded` array says which ones actually landed.

## Driving it further

`preview.mjs` is short and meant to be copied when a check needs clicks rather
than a look — ticking an item, opening the editor, filling the add form. Copy it
to the scratchpad and edit; don't grow flags on it for one-off interactions.

The two things worth keeping from it whatever you write:

- **Launch with `executablePath: '/opt/pw-browsers/chromium'`.** The project
  pins a Playwright whose browser build is not the one installed in this
  container, so a bare `chromium.launch()` fails with "Executable doesn't exist"
  and tells you to run `playwright install` — don't; the browser is already
  there.
- **Import Playwright by absolute path** (`/home/user/smarthome/node_modules/playwright/index.mjs`).
  A script outside the package cannot resolve it by name, and ESM ignores
  `NODE_PATH`, so the usual fix does nothing.

## When this is the wrong tool

`pnpm acceptance` (and the `acceptance:*` scripts) drive the **production**
bundle against a real local Supabase stack, which is the only build with a
service worker. Offline behaviour, sync, realtime and anything crossing two
devices belong there, not here. This skill is for looking at a page.
