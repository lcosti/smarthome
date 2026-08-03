# Step 2 — the shopping list

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build the shopping list and the aisle settings, and nothing else. This is the
screen used daily and the one that has to beat typing into a group chat. It must
open offline.

**Screenshots to attach:** `docs/screenshots/wide-shopping.png`, `docs/screenshots/phone-shopping.png`, `docs/screenshots/phone-settings.png`

---

### 6.4 `/shopping` — the shopping list

The page that has to beat WhatsApp.

**The add box is at the top and always focusable.** Adding an item must be faster
than typing it into a group chat. Type, press Enter, done — the input clears
*immediately* and the write is optimistic, because offline is not a failure here,
it queues. If it genuinely could not be added (no household on this device), give
the typing back and say why.

**Aisle chips.** A **checkbox group** (several can be on at once), horizontal,
wrapping, `card` variant with the indicator hidden so the selected border comes
from the variant. There is deliberately **no "All" chip** — switching every chip
off to mean "show me nothing" is not a thing anybody wants, and an unfiltered list
is the resting state.

One chip on doubles as **where the next typed item gets filed** — that is somebody
saying where they are standing. Two chips on says nothing about which, so the
household's usual guess wins instead.

If an aisle empties while filtered on, drop it from the selection, or the page
shows nothing with no way back.

**The list itself.** Aisle cards in the household's own aisle order, laid out in
**CSS columns** (1 on a phone, 2 at `lg`, 3 at `2xl`) rather than a grid — aisles
are wildly different lengths, and a grid row is as tall as its tallest cell, so a
long aisle leaves dead space beside it. The multicol block must have **auto
height**; put the scroll on a wrapper, or it fragments sideways into a horizontal
scroller.

Each card is a **checkbox group** with a header (icon + aisle name + count) and
one row per line. The aisle icon is looked up from the aisle's *name*
(`Fruit & veg` → carrot, `Chilled` → milk, `Meat & fish` → beef, `Frozen` →
snowflake, `Cupboard` → package, `Household` → spray can, `Drinks` → cup, `Bakery`
→ croissant, anything else → basket) — an icon is a rendering decision, not a
column on the table.

A row shows the name and, right-aligned in mono, the quantity label. A row with
one item behind it opens the editor on tap; a row standing for **several** items
opens a sheet listing them first, because a summed quantity is not a thing that
can be edited, only the rows under it.

Header actions when anything is checked: **hide/show checked** and **clear
checked**. No confirmation on clear.

Empty states: "Nothing on the list." / "Type above to add the first thing."; and
if the device has no household, "This device isn't set up yet." with a **Set up**
button.

### 6.12 `/settings`

Sections, each with a small uppercase dimmed heading:

- **Aisles** — an editable, reorderable list. "Put these in the order you walk the
  shop. The list follows this order." Renaming commits **on blur**, so a mutation
  is not queued per keystroke. Deleting needs confirmation: "Items in it move to
  Other. The aisle order is what the list is walked in, so this changes every
  future shop."
- **People** → `/people`. "Everybody who eats here, children included. Their ages
  decide the portions and their allergies decide what never gets planned."
- **Ingredients** → `/ingredients`. "The names your recipes share. Two recipes
  calling for the same thing become one line on the shopping list."
- **Pantry** → `/pantry`. "What is already in the house. Two onions left over from
  a three-pack means next week's list only asks for what you actually need."
- **Chores** — a list and an editor (name, whose, weekly days or a one-off date, an
  optional time). "These sit in Today's schedule alongside the calendar, and anyone
  can tick them off there. A day without one shows nothing."
- **Calendar** — read-only status, reporting what the server actually did:
  - `error` → an amber alert with the server's own words. *(A code would only send
    the reader back here to look it up.)*
  - `skipped` or never run → "No calendar connected — Set up on the server, not
    here: the sync function holds the account and the list of calendars."
  - `ok` → "N events cached — Google Calendar, synced every few minutes and cached
    on this device so the board still shows today with the wifi down."
  - Plus `Last checked 4 minutes ago`.
- **Always-on display** — a switch. "This screen never sleeps. For a tablet left on
  in the kitchen. Everything drifts a pixel at a time so the layout never burns
  into the panel — slowly enough that nobody sees it move. Press F for
  fullscreen." **Stored per device in local storage, not in the database** — the
  kitchen tablet is always on and a phone is not.
- **Household** — the name, the six-character **invite code** in large monospace
  with a copy button, and "Anyone with this code can join the household and see
  the list."
- **This device** — "N changes waiting to sync", and a sign-out button. Signing out
  is the **only** confirmation that is about the queue rather than the data: "N
  changes have not reached the server yet and will be lost."
