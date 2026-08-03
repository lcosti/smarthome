# Standing brief — read this first

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

This is the brief for an application built over eight steps. Read it, ask
nothing yet, and build nothing yet. Every step that follows assumes it.

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

- **It must open instantly**, with no round trip to a server before anything
  appears. There is no search-engine requirement — nobody will ever find this app
  by searching for it.
- **Offline-first.** What is on screen comes from a copy held on the device;
  changes apply straight away and catch up later. Signing in is needed to *sync*,
  not to *shop*. **If your platform cannot store data on the device, build §5b
  instead** — it keeps almost all of this and is honest about the part it cannot.
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

Build the interface from whatever standard components your platform provides,
and use them as they come. Do not rebuild what is already there: no raw buttons/inputs/forms styled with utility
classes, no span-based badges or checkboxes, no selectors built from arrays of
buttons (use radio groups, checkbox groups, select menus, tabs), no bespoke
dropdowns, autocompletes, empty states, skeletons or progress bars.

Recurring visual tweaks belong in one place — a theme, a set of shared styles —
not repeated on every usage.

Something custom is allowed only where the standard components genuinely cannot
express the requirement. In this app that is: the bottom tab bar; the kitchen-board avatar
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
   more, close the app completely, reopen it still offline, come back online. The
   server ends up with exactly what the screen showed. *(If the platform cannot
   store data on the device, say so — do not fake it — and run §5b's replacement
   test instead: drop the signal with the app open, and separately check that a
   cold start with no signal says it cannot reach the server rather than showing
   an empty list.)*
2. **Two devices.** Join from a second browser profile as a second person; a change
   on one shows up on the other over realtime.
3. **Plan → list.** Drive a recipe onto a night onto the shopping list. Deriving
   twice changes nothing. Taking a night off clears what it added **without
   touching anything already ticked**.
4. **One line, two recipes.** Two recipes wanting the same thing become one line.
   The unit is inferred from a quantity typed a moment later. Two ingredients
   merge and the list heals **with no re-derive**. The line reads "800g · 2 tins".
   Ticking it takes both rows behind it. *(Check the stored records as well as the
   screen — "one line" and "one record" are different claims, and only one of
   them is visible.)*
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

## Appendix A — if your platform lets you choose

Most won't, and nothing above depends on it. Skip this unless you are building
with arbitrary code.

The reference implementation this brief was written from is a client-rendered
Nuxt 4 app with Supabase behind it, local storage through IndexedDB, and a
mutation queue of full-record upserts — deployed as a static bundle. Its schema
changes are numbered migration files in version control, never edits made in a
database GUI.

If you are choosing, the only choices that actually matter are the ones §5 turns
on: a database that lets the *client* decide a record's id and its `updated_at`,
and somewhere to hold a queue of unsent changes on the device.
