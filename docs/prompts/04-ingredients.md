# Step 4 — canonical ingredients and aggregation

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Make two recipes wanting the same thing become one line on the list. Finish by
demonstrating acceptance test 4.

**Screenshots to attach:** `docs/screenshots/phone-ingredients.png`, `docs/screenshots/wide-shopping.png`

---

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

### 7.6 Aggregating the list for display

Two recipes in the same week both wanting tomatoes put **two records** on the list.
Turn them into **one line reading "800g · 2 tins"** — computed **at render time and
never stored**.

This is the central decision of the ingredient phase and it is worth knowing why.
Storing a combined record would make the unit of conflict the whole week's
arithmetic: two phones deriving offline would converge on whichever computed last
rather than on the truth, and a third recipe wanting tomatoes *after* the line was
ticked could never surface, because a checked record is frozen — a silent under-buy
with no way back. Grouping at render time has none of that, and it means a merge,
a parser improvement or a new purchase unit **applies retroactively with nothing
rewritten**.

Rules:

- Group **per aisle**, not across the whole list, so an ingredient somebody
  deliberately filed in two aisles stays in both places.
- Records resolving to no ingredient pass through unchanged. This keeps the whole
  feature invisible until it has something to offer.
- **One record is still one record.** Showing a single one under its
  canonical name would rename what the recipe said for no benefit — keep its quantity verbatim.
- Only **live, unchecked** records are grouped, which is why ticked ones need no
  special case: a checked record is simply not in the group, so the total covers only
  what is still to buy.
- **Add up what can be added up and keep the rest as written.** A line reading "a
  splash of passata" cannot join a total, but dropping it would mean the list
  quietly asked for less than the recipes do. Keep it verbatim after a `+`:
  `800g · 2 tins + a splash`.
- Order lines by the **earliest record each stands for**, so a line does not jump up
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
