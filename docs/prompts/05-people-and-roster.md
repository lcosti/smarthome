# Step 5 — people, life stages and who is eating

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build the roster. Finish by demonstrating acceptance test 5 — whose
load-bearing assertion is about a row that does not exist.

**Screenshots to attach:** `docs/screenshots/phone-people.png`

---

### 6.9 `/people`

A list: avatar, name, `Toddler · 2y 4m` derived from the date of birth, and badges
for their dietary constraints (**amber for allergies and intolerances**, neutral
for dislikes and preferences). Below it, an add form: name, optional date of
birth, with the caption "The date of birth is optional, but without it everybody
is assumed to be an adult."

Tapping a person opens an editor: name, date of birth, avatar photo, and their
constraints — each a `kind` (allergy / intolerance / dislike / preference) and a
free-text `tag`.

### 7.1 Life stage from a date of birth

Never store the label. Derive it every time it is read, so the baby ages up on its
own and nobody edits a config.

```
weaning  from 6 months
toddler  from 12 months
child    from 36 months
adult    from 156 months (13 years)
below 6 months → 'baby'
no date of birth → 'adult'
```

Count whole months **as a person would** — the count only goes up on the
day-of-month it went up on at birth. A 29 February birth date falls on 1 March in
most years, which is the ordinary convention and the kind one, since the
alternative is a child briefly a month younger than they were the day before.

A date of birth in the *future* is somebody mistyping, or a pregnancy entered
early; the youngest stage is the safe answer.

Compare dates as `YYYY-MM-DD` **strings**, never through `Date` arithmetic — no
timezones, no chance of a birthday landing a day early west of Greenwich.

Also produce an age label (`4m`, `2y 4m`, `3y`) shown next to the date of birth so
a typo is obvious.

### 7.2 Who is eating

**NO ROW MEANS PRESENT.** A row exists only once somebody has said otherwise. A
soft-deleted absence row counts as present — deleting the record of an absence is
saying the absence never happened.

`presentPeople(people, rows, date, meal)` = every live person minus those with a
live row for that (date, meal) carrying `present: false`.

`nightsPresent(person, dates, meal, rows)` counts over **the week's nights**, not
over the nights somebody has already planned a dinner for. Counting only planned
nights made an unplanned week say "0 of 0" to everybody, including the person who
is in for two of them.
