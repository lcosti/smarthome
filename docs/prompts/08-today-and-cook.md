# Step 8 — Today, cook mode, chores, pantry

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build the kitchen board and everything left. Finish by demonstrating
acceptance test 8.

**Screenshots to attach:** `docs/screenshots/wide-today.png`, `docs/screenshots/phone-today.png`, `docs/screenshots/wide-cook.png`, `docs/screenshots/phone-cook.png`, `docs/screenshots/phone-pantry.png`

---

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
column of free text and adding duration and tip fields would leave every existing
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

Everything the cook touches — ticks, which step, a running timer — is **temporary
and never saved**. None of it belongs to the recipe, and a checkbox still ticked
next Tuesday would be a small lie.

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
