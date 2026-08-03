# Step 6 — the weekly generator

> **Standing context.** Steps 1 to 8 build one application. Give the tool
> `00-standing-brief.md` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

Build the generator and wire it to the fill button on the plan. Finish by
demonstrating acceptance test 6.

**Screenshots to attach:** `docs/screenshots/wide-plan.png`

---

### 7.8 The generator

**Selection, never invention.** It picks from the library and nothing else.

The shape is: **hard-filter → score → pick at weighted random.** The last step is
the one that matters most. Taking the highest score every time converges on the
same five dinners within a fortnight, which is exactly the rut this is supposed to
get the household out of — so a good candidate is *likely*, not certain.

**Nights are decided in order**, because the ingredient-overlap score depends on
what has already been chosen: half a bunch of coriander is a reason to cook the
other thing that wants coriander.

Make it **pure, and take the randomness as an argument**, so a test can pin the
outcome.

**Hard filters (a candidate is absent, not low-scoring):**

- Already chosen this week — no recipe twice, however good it looks.
- Contains anything matching an **allergy or intolerance** of somebody eating that
  night. Match by **substring on the normalised tag against ingredient names**, and
  deliberately generously: "peanut" has to catch "peanut butter", and *the cost of
  over-excluding one dinner is a duller week while the cost of under-excluding one
  is a hospital.*

**Scoring weights:**

| Component | Value | Note |
|---|---|---|
| shortlist bonus | **+4** | Somebody said they want this soon |
| never cooked | +2 | Worth trying |
| recency penalty | **−6 × staleness** | `staleness = max(0, 21 − days_since) / 21` |
| ingredient overlap | +1.5 each, capped at 3 | Per canonical ingredient shared with the rest of the week |
| over the night's budget | −0.08 per minute, capped at 4 | |
| under the night's budget | −0.01 per minute, capped at 4 | Mild |
| dislike | −2 | Per person present who dislikes something in it |
| preference | +1 | Per person present who asked for it |
| **temperature** | **1.5** | `weight = exp(score / temperature)` |

At this temperature a candidate two points ahead is roughly four times as likely —
a strong lean, not a foregone conclusion. The shortlist bonus is larger than every
other bonus put together (roughly a fourteen-fold lean) so a shortlisted meal
usually lands. *Usually*, not always: it is still smaller than the recency penalty,
so shortlisting something cooked on Tuesday does not put it back on the table on
Thursday, and it cannot argue at all with the hard filters, which are not scored.

**Effort budget per night**, in minutes of prep plus cook: weekends **75**, Friday
**50**, other weeknights **30**. Weeknights are short because they are weeknights.

**Servings** come from the roster, not the recipe: the number of **eaters**, where
a pre-weaning `baby` is present at the table and eating nothing off it, so is not a
portion. Everybody else is one, **including the toddler who will eat a third of
theirs** — the alternative is a plan that quietly under-caters.

**Nights nobody is home get nothing**, which is the correct plan for them. Nights
where every candidate is filtered out also get nothing, rather than something
somebody is allergic to.

**Nights already planned by a person are left alone**, but still count towards
overlap and towards not repeating. The generator fills gaps; it does not overrule
anybody.

**Leftovers.** If the winning recipe's `base_servings ≥ 2 × tonight's eaters`,
offer *tomorrow* the leftovers — but only if tomorrow is not already planned by a
person (they said what they wanted to eat), and only if tomorrow's eaters fit in
what is genuinely left (`≤ base_servings − tonight's eaters`). Feeding six off a
four-serving batch is how a household learns not to trust the plan. Deciding this
*outside* the selection loop keeps the leftovers night from bending the no-repeat
rule, and reheating costs no effort so no budget is checked.

**Every suggestion says why it is there**, and the sentence must stay true to what
the scorer actually rewarded — the two drifting apart is how an app starts lying
about why it suggested something. Track which component *added* the most as the
score is built (only bonuses compete; a penalty avoided is not an argument for a
meal):

| Reason | Sentence |
|---|---|
| everything already in the cupboard | "All pantry — nothing to buy" *(wins over all others when true)* |
| shortlist | "On the shortlist" |
| never | "Never cooked — worth a try" |
| overlap | "Shares 2 ingredients with the rest of the week" |
| quick | "25 min — fits a 30 min night" |
| liked | "Somebody eating asked for it" |
| rested, 4+ weeks | "Not cooked in over a month" |
| rested, 1–3 weeks | "Nothing like it for 2 weeks" |
| cooked more than twice | "Cooked 6× — nobody complains" |
| nothing else to say | "Not on the plan yet" |

Return candidates in **library order, not score order** — a weighted pick maps a
given random number onto a different recipe if the list is permuted, so sorting
would silently reshuffle every seeded outcome. Provide a separate "top N" function
for leaderboards, which ties-breaks by name rather than by chance.
