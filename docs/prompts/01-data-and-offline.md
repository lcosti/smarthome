# Step 1 — the data model and the offline layer

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build only the data model and the sync layer. No screens beyond whatever you
need to prove it works. Finish by demonstrating acceptance test 1.

---

## 4. Data model

Eighteen kinds of record. **Every one of them belongs to exactly one household**,
and nothing may ever read across households.

Field types are given in plain terms — text, number, whole number, true/false,
date (a calendar day with no time), instant (a moment in time), reference (a link
to another record). Use whatever your platform calls these.

Three fields recur and are not repeated in every table below. **Assume every
record has them** unless it says otherwise:

| field | type | meaning |
|---|---|---|
| `id` | text | unique, see the conventions below |
| `created_at` | instant | when it was first made |
| `updated_at` | instant | when it was last changed |
| `deleted_at` | instant, optional | set to delete it; never remove the record |

### Conventions the whole design depends on

These are load-bearing. If your platform makes one of them impossible, say so
rather than quietly doing the opposite.

1. **Deletes are soft.** Deleting sets `deleted_at` and changes nothing else. A
   record is "live" when `deleted_at` is empty. Every list, count and filter in
   this document means live records unless it says otherwise. This is what lets
   a deletion made on one device reach another one, and what makes every change
   in the app the same kind of operation.
2. **`updated_at` is stamped when the edit is made, by whatever made it** — not
   when it reaches the database. It is the tiebreaker for which of two competing
   edits wins, and a stamp applied on arrival makes an old edit look newer than
   the change it is overwriting.
3. **A record can be created while offline**, which means its id must be
   available at the moment of creation rather than assigned later.
4. **Six kinds of record use a deterministic id** — computed by hashing the
   fields listed below rather than generated at random. This is how two devices
   doing the same thing while offline land on *one* record instead of two:

| record | id computed from |
|---|---|
| a list item created by the plan | the planned night + the recipe line |
| an ingredient alias | household + ingredient + the alias text |
| an attendance record | household + person + date + meal |
| a dietary constraint | household + person + kind + the tag, lowercased |
| a chore tick | household + chore + date |
| a calendar event | the calendar + the event's id in that calendar |

   **Do not enforce this with a uniqueness rule instead.** A uniqueness rule
   turns a duplicate into a permanent error that blocks the record forever;
   a shared id turns it into two harmless writes of the same thing.

### The records

**household** — there is exactly one, for this family.

| field | type | notes |
|---|---|---|
| `name` | text | |
| `invite_code` | text | six characters, read aloud across a kitchen — so use an alphabet with no `I`, `O`, `0` or `1` |

**person** — everybody who eats here. **Not** a login. Children and babies are
records with no account attached.

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `name` | text | |
| `date_of_birth` | date, optional | life stage is derived from this and never stored |
| `account` | reference, optional | the login, for adults who have one. A person with an account set **is** the household membership — there is no separate members list |
| `avatar` | image, optional | |

**dietary_constraint**

| field | type | notes |
|---|---|---|
| `household`, `person` | reference | |
| `kind` | one of `allergy`, `intolerance`, `dislike`, `preference` | the first two are hard filters the plan must never violate; the last two only cost a recipe points |
| `tag` | text | free text — "peanut", "anything spicy" — stored as typed |

**attendance** — the roster. **No record means present.** One exists only once
somebody has said otherwise; marking a person back in is that record changing to
`present: true`, never a deletion.

| field | type | notes |
|---|---|---|
| `household`, `person` | reference | |
| `date` | date | |
| `meal` | text | `dinner` for now |
| `present` | true/false | |

Absence is the exception — most nights everybody is home — so this keeps a quiet
week at zero records, lets a newly added baby be counted before anybody touches
the roster, and means next week already reads correctly.

**aisle** — the shelves of the shop, in the order it is walked.

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `name` | text | |
| `sort_order` | whole number | the list follows this order |

**ingredient** — the canonical name two recipes share.

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `name` | text | |
| `base_unit` | one of `g`, `ml`, `count` | the unit everything about it is summed in. `count` is the default and the only honest answer when nothing says otherwise |
| `aisle` | reference, optional | where it lives in the shop, once somebody has said |
| `merged_into` | reference, optional | set alongside `deleted_at` by a merge: "this turned out to be that". Readers follow the pointer (with a depth limit) instead of the app rewriting every record that referenced the loser — some of those are on a phone in a car park with no signal |

**ingredient_alias** — "tinned tomatoes", "canned tomatoes" and "chopped
tomatoes" all resolving to one ingredient.

| field | type | notes |
|---|---|---|
| `household`, `ingredient` | reference | |
| `alias` | text | stored as typed; lowercased only for comparison, so the list still reads like something a person wrote |

**ingredient_purchase_unit** — how it is bought.

| field | type | notes |
|---|---|---|
| `household`, `ingredient` | reference | |
| `name` | text | singular, as written on a shelf: `tin`, `pack`, `bunch` |
| `amount` | number | how much of the base unit one holds. A 400g tin is `400` |

This is what turns "800g" into "2 tins", which is the only form of the number
anybody can act on while standing in an aisle.

**recipe**

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `name` | text | |
| `source_url` | text, optional | kept when imported — the page has the photographs and the comments |
| `image_url` | text, optional | the source site's picture |
| `photo` | image, optional | the household's own picture; wins over `image_url` |
| `base_servings` | whole number | what the quantities are written for. Default 2 |
| `prep_minutes`, `cook_minutes` | whole number, optional | |
| `method` | text, optional | free notes — **not** the steps |
| `shortlisted_at` | instant, optional | "cook this soon" |
| `kcal`, `fat_g`, `saturates_g`, `carbs_g`, `sugars_g`, `fibre_g`, `protein_g`, `salt_g` | number, optional | per serving, exactly as the source printed it. **All optional, and empty is the honest state — never zero** |

**recipe_ingredient** — one line of a recipe.

| field | type | notes |
|---|---|---|
| `household`, `recipe` | reference | |
| `name` | text | free text, the cook's own wording |
| `quantity` | text, optional | free text: "2", "1 tin", "a bunch" |
| `aisle` | reference, optional | |
| `ingredient` | reference, optional | the canonical ingredient, once resolved |
| `sort_order` | whole number | |

**recipe_step** — one step is one field of prose. Deliberately **not** a title
and a body: a step is a thing you do, and splitting it is a structure nobody
maintains.

| field | type | notes |
|---|---|---|
| `household`, `recipe` | reference | |
| `body` | text | |
| `sort_order` | whole number | spaced out, so reordering swaps two values rather than renumbering the list |

**planned_night** — one dinner on one date.

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `date` | date | a calendar day, not a moment — Tuesday dinner is the same night whatever timezone the phone is in |
| `meal` | text | `dinner` for now |
| `recipe` | reference, **optional** | empty on a night nobody is cooking |
| `servings` | whole number | |
| `note` | text, optional | |
| `cook_person` | reference, optional | |
| `eat_time` | text, optional | `HH:MM`, or empty for the household's usual hour |
| `leftover_of` | reference, optional | this night reheats that night |
| `skip_reason` | one of `takeaway`, `out`, `someone_else`, `other`; optional | |

**list_item** — one line of the shopping list.

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `name` | text | |
| `quantity` | text, optional | free text |
| `aisle`, `ingredient` | reference, optional | |
| `checked` | true/false | |
| `checked_at` | instant, optional | |
| `source` | `adhoc` or `plan` | |
| `planned_night`, `recipe_ingredient` | reference, optional | where a `plan` item came from |
| `added_by` | reference, optional | empty on derived items — the plan put them there, not a person |

**pantry_item** — what is already in the house.

| field | type | notes |
|---|---|---|
| `household`, `ingredient` | reference | |
| `on_hand` | number | in the ingredient's base unit |

**pantry_reservation** — what a planned night has already claimed, so two nights
do not both count the same two onions.

| field | type | notes |
|---|---|---|
| `household`, `planned_night`, `ingredient` | reference | |
| `amount` | number | |
| `date` | date | |
| `settled_at` | instant, optional | |

**chore** — nothing is stored per day. A weekly chore is **one** record saying
"Tuesdays", and every Tuesday it will ever have is worked out when it is read.

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `name` | text | |
| `person` | reference, optional | empty means everyone |
| `weekdays` | list of whole numbers, optional | 1 = Monday … 7 = Sunday |
| `due_date` | date, optional | for a one-off; use this **or** `weekdays`, not both |
| `at_time` | text, optional | `HH:MM`, or empty for "some time today" |

**chore_tick** — same contract as attendance: **no record means not done**, and
unticking writes `done: false`.

| field | type | notes |
|---|---|---|
| `household`, `chore` | reference | |
| `date` | date | |
| `done` | true/false | |

**calendar_event** — read-only in the app. Written only by the calendar job
(§8.4); nothing in the interface ever creates or edits one.

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `person` | reference, optional | empty for a shared household event ("bins out") |
| `calendar_id`, `external_id` | text | |
| `title` | text | |
| `all_day` | true/false | |
| `starts_at`, `ends_at` | instant | |
| `start_date`, `end_date` | date | the local calendar days it covers, **stored rather than worked out on the fly** — the job has already decided which household day it belongs to. `end_date` is exclusive, so a one-day event ends the day after it starts |
| `source_updated_at` | instant, optional | used only to skip unchanged events on a sync run |

**calendar_status** — one record, saying what the last sync run did. Also
read-only in the app.

| field | type | notes |
|---|---|---|
| `household` | reference | |
| `ran_at` | instant | |
| `outcome` | one of `ok`, `skipped`, `error` | |
| `detail` | text, optional | the server's own words, for the settings screen |
| `fetched`, `written`, `removed`, `calendars_failed` | whole number | |

This exists because an empty calendar used to be the only symptom, and it was the
symptom of five different problems — four of which said nothing anywhere.

### Access rules

Everything is scoped to the household. Somebody signed in may read and write
records belonging to a household they are a person in, and nothing else. There
are **no delete rules to write**, because deleting is setting `deleted_at` — an
ordinary edit.

The two exceptions are `calendar_event` and `calendar_status`, which are
readable but never writable from the app.

Two operations need to work for somebody who is *not yet* a member, so they
cannot be gated on membership:

- **Create a household** — makes the household, seeds the default aisles below,
  and adds the caller as a person with their account attached.
- **Join a household** — finds it by invite code and adds the caller as a person.

### Default aisles

Created with a new household, in this order — it is the order a supermarket is
walked:

`Fruit & veg` · `Bakery` · `Chilled` · `Meat & fish` · `Frozen` · `Cupboard` ·
`Household`

## 5. Offline behaviour and syncing

### What has to be true

Whatever your platform gives you, these three things decide whether the app is
usable:

1. **The list opens and is readable with no connection**, from the home screen,
   without a sign-in prompt.
2. **Ticking an item and adding an item work with no connection**, and nothing is
   lost when the connection comes back.
3. **Two people editing at once converge**, without ever asking anybody to
   resolve a conflict.

**If your platform cannot do the first two, say so plainly rather than building
something that looks like it works and silently drops a write.** Everything else
in this document is still worth building; this section is the one place where
the platform's own limits decide the answer.

### The rules that must not be broken

These hold whether the platform syncs for you or you build it yourself. Each one
prevents a specific way of losing data that nobody notices until a shop goes
wrong.

1. **Last write wins, decided by `updated_at`**, which is stamped when the edit
   is made rather than when it arrives. Nothing more clever is needed: ticking
   milk off is the same result in any order, so a pile of edits replayed in any
   order lands correctly. **Do not build conflict resolution.**
2. **Every change is a full copy of the record**, not a description of what
   changed. That makes replaying one twice harmless, which is what makes the
   ordering not matter. Adding, editing, ticking, unticking and deleting are all
   the same operation.
3. **Deletes are soft**, so deleting is an ordinary edit too, and a deletion made
   on one device actually reaches the other.
4. **A record with an unsent local change is never overwritten by an incoming
   copy of it.** Without this, a stale echo from the server undoes an edit
   somebody just made.
5. **Compare timestamps as moments in time, not as text.** Two systems can write
   the same instant in different formats, and comparing those as strings gives
   the wrong answer in a way that looks fine in testing.
6. **Duplicates are prevented by deterministic ids** (§4), never by a uniqueness
   rule.

### If you are building the sync yourself

Hold unsent changes in a queue, in the order they were made, and send them on
reconnect, when the app is opened, after each change, and on a timer of about
thirty seconds. When sending one fails:

- **No answer at all** — the device cannot reach the server. **Stop, and leave
  the whole queue untouched.** The triggers above are the retry.
- **Rejected because the sign-in has expired** — same: stop. It will succeed the
  moment the session refreshes.
- **Rejected because the server does not recognise a field or a record type** —
  the app has been updated ahead of the database. **Stop.** The change must wait,
  not be thrown away. Every record of that type fails identically, so stopping
  cannot strand a good change behind a bad one.
- **Rejected for any other reason** — count it and **move on to the next one**.
  One bad record must never hold up the milk behind it. After five attempts,
  give up on it and tell the user something could not be saved.

Two more rules that only matter once you are doing this yourself:

- **After a full refresh, any local record the server did not return, and which
  nothing is waiting to send, is a change that got dropped.** Send it again. This
  is only safe because deletes are soft — a record the server has never heard of
  was never saved, not deliberately removed.
- **Load parent records before the records that point at them**, so a device
  opening for the first time can resolve a list item's recipe and ingredient on
  the first paint rather than showing blanks that fill in a second later.

### Installing to the home screen

The app should install to a phone's home screen and open straight to Today, with
its own icon, no browser chrome, and no sign-in prompt on a device that has been
set up. If the household is in a supermarket and has to think about which app to
open, the group chat wins.

Cached pictures are the one thing allowed to come from a network cache: recipe
photographs live on whichever site the recipe came from, and the address is
stored while the image is not — so without caching them the kitchen tablet loses
every picture the moment the wifi does.

### Staying signed in

The gate is **"has this device ever been set up"**, not "is the sign-in valid
right now". Sessions expire on their own schedule and the app has to open in a
supermarket. A device that has been set up gets in and reads from its local copy;
a valid session is needed to *sync*, not to *shop*.

The shared kitchen tablet should stay signed in indefinitely.

### The test for this section

> Put the phone in airplane mode. Open the app from the home screen. Tick five
> items. Add two more. Close the app entirely. Reopen it, still offline. Come
> back online. **Nothing is lost, and the server ends up with exactly what the
> screen showed.**
