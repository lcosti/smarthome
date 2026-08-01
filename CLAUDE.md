# Household meal planner — project brief

A private app for one family. Not a product, not multi-tenant at scale, no growth
plans. Four to six users, ever. Optimise for "my partner will actually use this",
not for scale.

It replaces: a WhatsApp group used as a shopping list, a Notion page of recipes,
paper lists, and the supermarket app's own list.

## The core idea

The shopping list is a **derived artifact**, not a document people maintain. The
chain is:

    who's home this week + recipe library
      -> weekly generator
      -> meal plan (7 nights, servings per night)
      -> shopping list (minus pantry stock, sorted by aisle)

Nobody hand-maintains the list. It falls out of the plan. Ad-hoc additions
("bin bags") are supported as a separate item type on the same list.

The generator adapts one family meal per person present — an adult portion, a
3-year-old's version, a weaning baby's version. Same cooking session, different
plates.

---

## Stack

| Thing | Choice | Notes |
|---|---|---|
| Framework | Nuxt 4.5+ | NOT Nuxt 3 — EOL 31 July 2026 |
| UI | Nuxt UI v4 | v4 unified Pro into the free library; all 110+ components available |
| Backend | Supabase | Free tier, own free organization |
| Supabase module | `@nuxtjs/supabase` v2.x | Nuxt 4 ready |
| PWA | `@vite-pwa/nuxt` | |
| State | Pinia | |
| Local persistence | IndexedDB via Dexie | |
| Deploy | `nuxt generate` -> static host | Cloudflare Pages / Netlify, free tier |

---

## Decisions that must not be reversed

These were argued through deliberately. If a change seems to require undoing one,
stop and ask rather than working around it.

### 1. `ssr: false`. Non-negotiable.

```ts
export default defineNuxtConfig({
  ssr: false,
  modules: ['@nuxt/ui', '@nuxtjs/supabase', '@vite-pwa/nuxt'],
  supabase: {
    useSsrCookies: false,
    redirect: false,
  },
})
```

Why: the primary use case is a phone in a supermarket with poor signal. Server
rendering requires a round trip before anything appears. There is no SEO
requirement and no cold-start concern — this is an installed home-screen app for
one household.

`useSsrCookies: false` makes the Supabase module use the standard supabase-js
client with the session in localStorage rather than SSR cookies. This is the
documented recommendation for statically generated sites, and it keeps the shared
kitchen tablet signed in indefinitely.

`redirect: false` disables the module's default login-redirect middleware.

**Consequence:** no Nitro server routes. Anything server-side lives in Supabase
Edge Functions.

### 2. People are not auth users.

`people` is its own table. Adults who sign in get a nullable FK to `auth.users`.
Children and babies are rows with no login. Do not create auth accounts for
children.

### 3. Life stage is derived from a birth date, never stored as a label.

Store `date_of_birth`. Derive "weaning", "toddler", "child", "adult" at query
time. The baby ages up on its own; nobody edits a config.

### 4. Selection over generation.

The generator picks from the household's own recipe library. It does not invent
recipes for the weekly plan. An LLM may *suggest additions to the library*, which
a human then accepts — but the week is assembled from known-good meals.

Scoring: filter on hard constraints (allergies, who is present), then score on
soft preferences, recency (avoid repeats within ~3 weeks), effort budget for the
night, and ingredient overlap so perishables get used twice. Use weighted-random
selection, not argmax, or it converges on the same five dinners.

### 5. Last-write-wins is sufficient. Do not add CRDTs.

Ticking an item off is idempotent — two people in different aisles both marking
milk as got produces the same end state. A queue of plain upserts replayed in any
order lands correctly. This is why the offline layer is tractable; don't
over-engineer it.

### 6. Default Nuxt UI components, almost exclusively.

Build UI from stock Nuxt UI v4 components (`U*`). Do not hand-roll what the
library provides: no raw `<button>`/`<input>`/`<form>` with Tailwind classes, no
span-based badges/chips/checkboxes, no selectors built from `UButton` arrays
(use `URadioGroup`/`UCheckboxGroup`/`USelectMenu`/`UTabs`), no bespoke dropdowns,
autocompletes, empty states, skeletons, steppers, or progress bars.

Recurring visual overrides live in `app.config.ts` theme config, not repeated
inline `:ui` props. Before adding an inline `:ui`, check the generated theme in
`.nuxt/ui/` — much of what gets written by hand restates a default.

A custom implementation is allowed only when Nuxt UI genuinely cannot express
the requirement, and it must carry a comment naming the component it replaces
and why. Current sanctioned exceptions:

- `AppTabBar` — stacked icon-over-label equal-width columns aren't a
  `UNavigationMenu` layout; converting means rebuilding it inside an `#item`
  slot.
- `BoardAvatar` — the wall board only. Runtime pixel sizes and generated
  per-person oklch hues can't be expressed as Tailwind classes, and colour is how
  the board tells four people apart from across a kitchen. Everywhere a phone or
  a laptop shows a person — the plan, the people page, the person editor — it is
  a stock `UAvatar` on the default size scale.
- **Card and row tap targets** whose content is a laid-out block rather than a
  label — `RecipeRow`, `RecipeStepRow`, `IngredientLineRow`, `PlanNightCard`,
  `BoardRecipeCard`, `BoardPersonChip`. A `UButton` renders its
  content through `label`/slot inside a flex row; these need their own internal
  grid, and wrapping one in a button is cheaper than overriding four slots.
  A row whose content *is* a label is a `UButton` — see `people.vue`,
  `ingredients.vue`.
- `IngredientSuggest` — the suggestion list only. `UInputMenu` calls
  `highlightFirstItem()` on every change, so an open menu owns the enter key;
  this field's rule is that enter always submits what was typed.
- The macro bar in `RecipeNutritionPanel` — the segments only. `UProgress` draws
  one value against a track; this is three series summing to a whole, and their
  widths are runtime percentages rather than Tailwind classes. The scope toggle
  above it is a stock `UTabs`, and every figure around it is plain text.
- The step bar in cook mode — `recipes/[id]/cook.vue`. Same shape of exception:
  `UProgress` draws one value against a track, and this is one segment per step,
  where the number of segments is half of what it is telling you. A step with a
  timer still running opens its segment out into that timer — a stock `UButton`,
  the only tap target in the bar — so a pan you walked away from keeps its place
  in the sequence instead of becoming a chip in a corner.
- The hidden `<input type="file">` wherever a picture is chosen —
  `recipes/index.vue`, `PersonEditor`, `recipes/[id]/edit.vue`. Invisible
  plumbing behind a `UButton`, not a control. `UFileUpload` brings a dropzone
  none of them want, and `capture` makes iOS force the camera and silently drop
  `multiple`.

`PlanNightRow` used to be on this list and no longer exists. Both shapes of the
plan show a night as `PlanNightCard` — a phone gets the same card in a column,
with `:table="false"` dropping the roll-call along the bottom — so there is one
answer to "what does a night look like" rather than two that drift.

`ChecklistRow` used to be on this list and is not any more. The shopping list is
a `UCheckboxGroup` (`ShoppingAisleCard`), which answered both of its objections:
`variant="list"` keeps the root a plain element so only the text is a `<label>`
and the edit button beside it is not — `.prevent` on that button stops the label
forwarding the click — and the third `covered` state reads better as a badge than
as a box nobody can tick anyway.

---

## Schema requirements

Roughly these tables. Everything scoped to a `household_id` with RLS.

- `households`
- `people` — household_id, name, date_of_birth, nullable auth_user_id
- `dietary_constraints` — person_id, kind (allergy | intolerance | dislike |
  preference), tag. Allergies are hard filters; dislikes are soft scoring
  penalties. Keep them distinguishable.
- `attendance` — person_id, date, meal, present. This is the roster: "Tom is at
  his dad's Tuesday and Thursday, my mum's here Sunday."
- `ingredients` — canonical list. One base unit each (g | ml | count).
- `ingredient_aliases` — ingredient_id, alias. "chopped tomatoes", "tinned
  tomatoes", "canned tomatoes" all resolve to one row.
- `ingredient_purchase_units` — how it's bought ("1 tin = 400g") so the list says
  something you can act on in an aisle.
- `recipes` — name, source_url, base_servings, prep/cook minutes, method, tags,
  per-serving nutrition as the source printed it (kcal + seven gram columns,
  all nullable — see `app/utils/nutrition.ts` for the field list)
- `recipe_ingredients` — recipe_id, ingredient_id, quantity, unit, optional flag
- `recipe_adaptations` — recipe_id, life_stage, guidance text
- `meal_plans` / `meal_plan_entries` — date, meal, recipe_id, servings
- `pantry_items` — what's already in the house
- `aisles` — ordering for the shopping list, matching the actual store layout
- `shopping_list_items` — materialised (so people can tick and add ad-hoc items),
  with provenance back to the plan entry that generated it

RLS: every policy scoped to the caller's household membership. No cross-household
reads.

---

## The offline layer

This is the hardest part and no library does it for you.

- Pinia holds working state
- Dexie persists to IndexedDB
- Writes apply optimistically to local state and append to a mutation queue
- Queue drains on reconnect, plain upserts, order-independent
- Supabase Realtime for live updates when online (two people in the kitchen)
- Service worker precaches the app shell

Acceptance test: put the phone in airplane mode, open the app from the home
screen, tick five items, close it, reopen it, come back online. Nothing lost.

---

## Build order

1. **Shopping list alone.** No recipes, no generator, no plan. Manual add, tick
   off, aisle sort, offline, shared between two phones and a tablet. This is the
   thing used daily and it's what has to beat WhatsApp.
2. Recipe library + manual weekly plan, list derived from it
3. Ingredient canonicalisation and aggregation across recipes
4. The generator
5. Recipe import from URLs — parse schema.org `Recipe` JSON-LD first, which
   covers most recipe sites for free. LLM fallback only for the rest.

Do not build 4 before 1 works and is in daily use.

---

## Constraints and gotchas

- **Beat WhatsApp on friction.** Adding an item must be faster than typing it
  into a group chat. Home-screen install, opens straight to the list, input at
  the top, no login prompt on shared devices. If someone has to think about which
  app to open, WhatsApp wins.
- **Supabase free tier pauses after 7 days of inactivity.** A scheduled Edge
  Function must ping the database every 2–3 days. Do not rely on the weekly
  generation job for this — a 7-day cycle racing a 7-day timer will lose.
- **Migrations live in git as numbered SQL files.** Never make schema changes in
  the Supabase dashboard table editor. Everything goes through
  `pnpm supabase ...` — the CLI is a devDependency, so a bare `supabase` may be a
  different version.
- **Apply migrations with `pnpm supabase migration up`. Do not use
  `db reset`.** A reset replays from scratch and drops everything in the local
  database with it — that database is not scratch space, it holds the household's
  real library. `migration up` applies what is pending and keeps the data. Reset
  only against an empty stack you are deliberately rebuilding, and only after
  checking `select count(*) from recipes`.
- **A local database behind the bundle is the failure to look for first.** If
  writes seem to vanish, or an imported field arrives empty, check
  `supabase_migrations.schema_migrations` against `supabase/migrations/` before
  suspecting the feature. Writes for columns the database has not got yet halt the
  sync queue and wait (see `SCHEMA_DRIFT_CODES` in `app/utils/sync.ts`), so the
  rows sit unsynced with a pending badge rather than being lost — but nothing
  reaches the server until the migration lands. Edge Functions are the same trap
  from the other end: `functions serve` must be restarted to pick up a change
  under `_shared/`.
- Free tier ceilings (500MB DB, 1GB storage, 5GB bandwidth, 50k MAU) are far
  beyond what this will ever use. It can live on free indefinitely.

---

## Explicitly out of scope

- Multi-tenancy beyond one household
- Nutrition *tracking* — daily totals, calorie counting, macro targets. Storing
  a recipe's own per-serving figures (captured on import, editable on the recipe
  page) is in; summing them across a plan or a day is not.
- Supermarket basket integration (interesting, but depends on closed APIs)
- Anything for users other than this family

## Safety note

Weaning guidance is generated content and the household owner knows the domain
and reviews it. Do not build elaborate validation layers for it. If this ever
becomes something other people use, that decision gets revisited.
