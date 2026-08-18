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
  label — `RecipeRow`, `RecipeStepRow`, `IngredientLineRow`, `PlanDishCard`,
  `BoardRecipeCard`. A `UButton` renders its
  content through `label`/slot inside a flex row; these need their own internal
  grid, and wrapping one in a button is cheaper than overriding four slots.
  A row whose content *is* a label is a `UButton` — see `people.vue`,
  `ingredients.vue`.
  `PlanDishCard` claims this once for the whole plan: it is every planned slot,
  breakfast to dinner, at both widths. The cells around it (`PlanMealCell`,
  `PlanNightCard`) own only what an *empty* slot says and where a dish can land,
  and both of those are stock.
- The day grid in `BoardSchedule` — the wide layout only. Nuxt UI has no
  calendar view: `UCalendar` is a date picker, and a day laid out by the minute
  needs absolute offsets computed at runtime from real times, which cannot be
  Tailwind classes. Every control inside it is stock — the chore tick is a
  `UCheckbox`, the header is a `UButton` and a `UBadge` — and the phone renders
  the same rows as an ordinary list.
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
- Dragging a dinner onto a night — `usePlanDrag`, `PlanDragGhost`. Nuxt UI has
  no drag-and-drop, and neither has the platform in any form this app can use:
  HTML5 `dragstart` never fires on a touchscreen, and the kitchen tablet is the
  device most likely to be rearranging a week. One pointer-event code path
  covers mouse, pen and finger. A mouse picks a card up on the first few pixels
  of travel; a finger holds it still for a moment first, because the phone's
  plan is a scrolling column and a card that grabbed every downward swipe would
  make the page unreadable. Everything a drag does is also reachable without the
  gesture — tapping the night moves a dish, and the × on the dish card takes it
  off — so nothing depends on it.
- The hidden `<input type="file">` wherever a picture is chosen —
  `recipes/index.vue`, `PersonEditor`, `recipes/[id]/index.vue`. Invisible
  plumbing behind a `UButton`, not a control. `UFileUpload` brings a dropzone
  none of them want. The recipe importer's one accepts
  `image/*,android/allowCamera`, and the second value is not a typo: Chrome on
  Android 14+ opens the camera-less system photo picker whenever every accept
  value is an image or video type, and any other value sends it back to the
  chooser that has Camera in it and honours `multiple`. Not `capture`, which
  is one shot per tap and drops `multiple` on iOS — a cookbook recipe is
  regularly a spread. The camera icon on that button is a bound expression, so
  it is listed in the client icon bundle in `nuxt.config.ts`: an icon fetched
  at runtime is a blank square in a shop with no signal.
- The column inside `RecipeSheet` — the height of it only. A drawer with snap
  points is drawn full height and slid down until a fraction of it shows, so
  anything at the end of its column is off the screen until the last snap, and
  the two buttons this sheet exists to offer would need a drag to reach. The
  column is sized to the visible band instead, which is the active snap point —
  a number a finger is changing continuously, and so not a Tailwind class. Every
  control in it is stock, and `title`/`description` stay props so the drawer
  announces itself the way the library wrote it.

The phone reads a recipe in a `UDrawer` (`RecipeSheet`), where every other bottom
sheet in the app is a `USlideover`. Those eight are forms — open, type, save,
shut — and one height suits all of them. This is reading of unknown length: the
short snap is the decision, and dragging up is the method. The drawer has snap
points and a grab handle and the slideover has neither.

It is the wide library's detail pane, on a phone: the same `LibraryDetail` off
the same `buildRecipeLibrary`, by way of `useRecipeDetail`, so "what does a
recipe look like when you are choosing one" has one answer at both widths.
`useRecipeSend` is the other half of that — the button that puts what a recipe
needs on the shopping list, as plain ad-hoc items with no plan provenance, and
the reasoning for that lives in one place now rather than beside each button.
The sheet's footer offers `/recipes/:id` once, not twice: that route is the
editor, so "view" and "edit" are the same door.

`PlanNightRow` used to be on this list and no longer exists, and `PlanNightCard`
— which replaced it at both widths — is now the phone's alone. A day laid out as
three slots is three of the same cell, and that cell is `PlanMealCell`; the wide
week's dinner was drawing a night card with its frame, its header and its footer
switched off, which is three props' worth of asking a component not to be
itself. What is left in the card is what only a night on its own has: the day
along the top (`:header="false"` on the phone, which says the day in its page
heading), the roll-call along the bottom, and the two states a slot can be in
that a breakfast cannot — a night that has gone with nothing cooked on it, and a
night nobody is eating on. `eaters` has two answers because there are two
questions: `table` is the whole roll-call for a card standing alone, and `away`
is the exception only, for the phone's column. Both go through `PlanDayEaters`,
which is that footer extracted so the wide week's gutter says it the same way.

A day is three slots. `meal` has been a column on `meal_plan_entries` and
`attendance` since the first plan migration, unconstrained, so that lunches would
be a code change rather than a migration — `app/utils/meal.ts` is that change.
**Dinner stays primary and the rest of the app is built on that**: the week's
fraction, "Fill empty nights", the generator, the phone's walk and the wall board
all mean dinner when they say night, and `plan.entriesOn(date, meal = DINNER)`
defaults to it so they go on meaning it without every call site naming it.
`PlannedNight.entries` is the dinner and only the dinner for the same reason —
breakfast and lunch live in `meals` — because widening it would light the day's
dot for a bowl of porridge with nothing failing to compile. What is *not*
dinner-only is the trip to the shop: `derive` keys on the plan entry and always
has, so every slot buys, and `entryIdsIn` is what both "to buy" counts read.

A recipe can say which meals it is one of — `recipes.suits_breakfast` and its two
neighbours, three booleans on the nutrition migration's precedent (typed fields
over a blob, and a flat row of primitives, which is what `plainCopy` says it
copies). **All three false means no opinion, not "suits nothing"**: that is the
state every recipe is in until somebody labels one, which is why the column
landed with no backfill and why an unlabelled library behaves exactly as it did
before. This is the one thing about a recipe that is *stored* rather than derived
— deriving "is a breakfast" from what it has been planned as is circular for the
case that matters, since a recipe added this morning has been planned as nothing.
It is read in one place, the plan's recipe list, which **orders** by `mealFitRank`
and never filters: three tiers, so a labelled match leads, an unlabelled recipe
follows (nobody said it was a poor breakfast), and another meal's sinks. Hiding
would make labelling a thing you could regret. The library's own facets stay
derived and do not read it — see the docblock on `buildRecipeLibrary`.

Every slot is `PlanMealCell` — all three of the wide grid's cells, and the two
rows under the phone's dinner. **A planned meal is
`PlanDishCard` in every slot**: the same photograph, name and two cost lines the
dinner has, because a lunch that is a recipe costs the same minutes at the stove
and the same trip to the shop, and a day drawing its three slots three ways read
as three unrelated widgets rather than as one day. This used to say the opposite
— that porridge is a name and a cell is a label — and that was a claim about
breakfast rather than about the row it sits in. An **empty** cell is still a
stock `UButton`, and needs no exception: there is nothing to lay out, and an
invitation is a label. Taking a meal off is the × on the dish card now, wherever
the dish is, rather than a trip through the editor; `removeNight` already took a
`meal`. They open the same `PlanNightEditor`, which takes a
`meal` beside its `date` and drops two of its blocks for the slots they make no
sense in — no skip outside dinner, because a skip is a decision the board and
the generator read and an empty breakfast is the ordinary case rather than a
gap; no leftovers at breakfast. Its "Who's home" block does not take the meal
and says so in a comment: the roster is kept once per day, against the dinner,
and passing a breakfast there would find no rows and read everybody as away.

The wide plan is days down and meals across (`PlanWeekWide`), a plain grid rather
than a `UTable` — a table's cells are column definitions given rows, and every
cell here registers itself as a drop target. **The day is the card and the meals
are cells inside it**, which is the way round it had to go once a day had parts.
Nothing inside a day draws a frame of its own: the three cells sit in the row's
grid, and each draws either a dish or a dashed outline to put one in. The dinner
was a card inside a card before that, costing a second border and a second inset
and leaving the dinner further from its own row than the breakfast beside it.
An empty cell is a plus and nothing else, the dinner included — the column
heading two inches above it says which meal it is, and a row where two slots are
a plus and the third is a sentence reads as the third one being the one that is
asking. "Add dinner" is still its accessible name, which is what the acceptance
scripts click.
The rows share the height that is left (`flex-1 basis-0`, equal because `basis-0`
distributes all of it rather than only the spare), so the week ends where the
screen does and there is nothing below the fold to go looking for. `min-h-20` is
a floor and not a height — a very short window scrolls rather than crushing seven
days into slivers, and at the floor the dinner card keeps its dish name and drops
its cost line. A day nobody is home for keeps its natural height instead of a
share: there is nothing on it to make room for. **The gutter is what the row
knows about the day itself**, three lines of it: the date, who is eating, and
what else the day already holds. Who is eating rides there rather than in a
column of its own out on the right — it is four small faces and two words, and
as a column it was the widest fixed thing on a row whose meals were sharing what
was left, so a pixel spent there came off a dish name that is already
truncating. It is `PlanDayEaters` exactly as `PlanNightCard`'s footer draws it,
because "who is at the table" gets one answer. The diary is under it
(`PlanEventRail`) and used to hang off the dinner, which made a fact about
Tuesday read as a fact about Tuesday's dinner and made one of three slots taller
than the other two. The gutter is `10rem` for its sake: the roll-call would take
less, but an event is a sentence somebody wrote. It gets **one line**, so the
rail asked for one event puts the count of the rest on that line rather than
under it — a caller with room for one line has room for one line, and the "+1
more" underneath was being drawn outside the day's band and clipped, which lost
the one thing the rail promises. Which is also why `usePlanDrag` keys
targets by `${date}|${meal}`: three cells sharing a bare date would overwrite
each other in the map. **Anything may be dropped into any slot** — a suggestion,
and a dish already planned, which `planMove` rewrites the `meal` of along with
the date, because "that chilli would do for Wednesday's lunch" is a thing
households say. A dish already in that slot goes back the other way, meal and
all; a drop on a slot never deletes anything.

The one drop that does is the shortlist, which registers itself under
`SHORTLIST_SLOT` — not a slot key, deliberately, so `parseSlot` refuses it.
Dragging a dinner onto `PlanSuggestions` takes it off the plan, because that
panel is where the dish came from and where it reappears once the week stops
claiming it, so the bin is the shortlist without either word being written
anywhere. A suggestion dropped there is refused in the hit test, so the panel
never lights rather than the drop doing nothing.

**No drop toasts, including that one.** It used to say "X off the plan" and offer
a "Put it back" undo, and rearranging a week was a column of them. A drag is the
most deliberate gesture in the app — picked up, carried, released — and you watch
the card leave the night and land in the panel, so a notification is the app
narrating a press somebody just made and watched land. That is the same rule
`pick` in `plan.vue` already states for planning, skipping and removing a night;
dragging was the one place breaking it. Toasts stay for what happens out of
sight: filling a week, clearing one, putting it on the list. What the undo really
bought was `restoreEntry`, which clears `deleted_at` and so puts back the night
that was there — its day, its slot, its servings, anything eating its leftovers —
where dragging the dish out of the shortlist again plans a fresh one under a new
id. It is still on the store, uncalled, for the day something wants a real undo.

The phone's plan is a guided walk through the week: a day heading, `PlanDayStrip`
above the night on screen, and a footer whose one button names the next night
still open — or, once there is none, the review. The strip's dot and that button
both mean dinner, and the dot deliberately does not light for a breakfast: a
strip and a footer that disagreed about which nights were dealt with is worse
than either behaviour on its own. **The dot is the tile's only mark.** Today used
to be underlined beside it, which put two marks in the same accent on one small
pill answering two different questions and read as decoration rather than as
either; the week opens on today and the label above says which one it is. That
last step (`PlanReview`) is
component state inside `plan.vue` rather than a route, for the same reason the
week offset is: it is the end of one task, and Android back landing on Thursday
would be a surprise. No horizontal swipe between nights; `usePlanDrag` already
owns touch on these cards, and the strip and the button reach every night
without a gesture.

Unticking a line in the review writes the shopping row **soft-deleted** rather
than not writing it. That is the shape a person deleting an item off the list
already leaves behind, and `derive` has always refused to resurrect one — so the
decision survives filling the week again, the other phone deriving it, and next
Tuesday, with no new table and nothing to reconcile. See `app/utils/review.ts`.

`BoardPersonChip` used to be on this list and no longer exists. Today shows the
day rather than the dinner, and the roster went with the redesign — who is eating
is asked and answered on the plan, which is where the week is decided.

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
  all nullable — see `app/utils/nutrition.ts` for the field list), and
  `source_book` / `source_page` for the ones photographed off a shelf. The page
  is text, not an integer: a photographed recipe is regularly a spread, and
  nothing sorts or counts by it — see `app/utils/recipe-source.ts`, which is
  also where "p. 82" typed into the box becomes the page it is. The extraction
  reads the folio off the photograph where it is legible, but only ever *into
  the box* somebody is already filling in — a page number nobody confirmed is
  one nobody can check, because the book has gone back on the shelf. Same rule
  as an LLM suggesting a recipe: it offers, a person accepts. The book itself is
  never guessed, because a running header is as often the chapter as the title.
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
