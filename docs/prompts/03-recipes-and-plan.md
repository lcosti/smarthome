# Step 3 — the recipe library, the plan, and deriving the list

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build the recipe library, the recipe editor, the weekly plan, and the
derivation that turns a planned week into shopping list rows. Finish by
demonstrating acceptance test 3.

**Screenshots to attach:** `docs/screenshots/wide-recipes.png`, `docs/screenshots/phone-recipes.png`, `docs/screenshots/wide-recipe-detail.png`, `docs/screenshots/wide-plan.png`, `docs/screenshots/phone-plan.png`

---

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
