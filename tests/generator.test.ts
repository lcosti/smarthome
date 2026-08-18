import { describe, expect, it } from 'vitest'
import {
  buildContext,
  defaultEffortBudget,
  eaters,
  generateWeek,
  rankCandidates,
  suggestionReason,
  topCandidates,
  type GenerateInput,
  type GeneratorLine,
  type GeneratorRecipe,
  type RankReason,
  type RankedCandidate
} from '../app/utils/generator'

/** Deterministic randomness, so an assertion about a pick means something. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ADULT = { id: 'p-adult', stage: 'adult' as const }
const TODDLER = { id: 'p-toddler', stage: 'toddler' as const }
const BABY = { id: 'p-baby', stage: 'baby' as const }

function recipe(over: Partial<GeneratorRecipe> & { id: string }): GeneratorRecipe {
  return {
    name: over.id,
    // Deliberately smaller than twice the default week's table, so nothing here
    // chains a leftovers night by accident. The tests that want one say so.
    base_servings: 3,
    prep_minutes: 10,
    cook_minutes: 15,
    deleted_at: null,
    ...over
  }
}

function line(recipeId: string, name: string, ingredientId: string | null = null): GeneratorLine {
  return { recipe_id: recipeId, name, ingredient_id: ingredientId, deleted_at: null }
}

/** A week of Mondays-onward dates, everybody home. */
function week(people = [ADULT, TODDLER]) {
  return ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
    .map(date => ({ date, people }))
}

function run(over: Partial<GenerateInput> = {}) {
  return generateWeek({
    nights: week(),
    recipes: [recipe({ id: 'r1' }), recipe({ id: 'r2' }), recipe({ id: 'r3' }),
      recipe({ id: 'r4' }), recipe({ id: 'r5' }), recipe({ id: 'r6' }), recipe({ id: 'r7' })],
    lines: [],
    constraints: [],
    history: [],
    random: seeded(1),
    ...over
  })
}

describe('generateWeek', () => {
  it('fills every night that has somebody eating', () => {
    expect(run()).toHaveLength(7)
  })

  it('never picks the same recipe twice in one week', () => {
    const picks = run()
    expect(new Set(picks.map(p => p.recipeId)).size).toBe(picks.length)
  })

  it('runs out gracefully when the library is smaller than the week', () => {
    // Three recipes cannot fill seven nights without repeating, and repeating is
    // the thing it must not do. Three nights planned beats seven nights of the
    // same chilli.
    const picks = run({ recipes: [recipe({ id: 'r1' }), recipe({ id: 'r2' }), recipe({ id: 'r3' })] })
    expect(picks).toHaveLength(3)
  })

  it('is deterministic given the same randomness', () => {
    expect(run({ random: seeded(7) })).toEqual(run({ random: seeded(7) }))
  })

  it('does not converge on one answer across different seeds', () => {
    // The whole reason for weighted-random over argmax: five identical recipes
    // should not always produce the same Monday.
    const mondays = new Set(
      Array.from({ length: 25 }, (_, i) => run({ random: seeded(i + 1) })[0]?.recipeId)
    )
    expect(mondays.size).toBeGreaterThan(1)
  })
})

describe('hard constraints', () => {
  const recipes = [recipe({ id: 'satay' }), recipe({ id: 'pasta' })]
  const lines = [line('satay', 'Peanut butter'), line('pasta', 'Tomatoes')]

  it('never plans something an allergic person is present for', () => {
    const picks = generateWeek({
      nights: week([ADULT, TODDLER]),
      recipes,
      lines,
      constraints: [{ person_id: TODDLER.id, kind: 'allergy', tag: 'peanut', deleted_at: null }],
      history: [],
      random: seeded(3)
    })
    expect(picks.every(p => p.recipeId !== 'satay')).toBe(true)
    expect(picks.map(p => p.recipeId)).toContain('pasta')
  })

  it('matches a tag inside a longer ingredient name', () => {
    // "peanut" has to catch "Peanut butter". Over-excluding costs a duller week;
    // under-excluding costs a hospital.
    const picks = generateWeek({
      nights: [{ date: '2026-08-03', people: [TODDLER] }],
      recipes: [recipe({ id: 'satay' })],
      lines: [line('satay', 'Peanut butter')],
      constraints: [{ person_id: TODDLER.id, kind: 'allergy', tag: 'peanut', deleted_at: null }],
      history: [],
      random: seeded(3)
    })
    expect(picks).toHaveLength(0)
  })

  it('allows it again on a night that person is away', () => {
    const picks = generateWeek({
      nights: [
        { date: '2026-08-03', people: [ADULT, TODDLER] },
        { date: '2026-08-04', people: [ADULT] }
      ],
      recipes: [recipe({ id: 'satay' })],
      lines: [line('satay', 'Peanut butter')],
      constraints: [{ person_id: TODDLER.id, kind: 'allergy', tag: 'peanut', deleted_at: null }],
      history: [],
      random: seeded(3)
    })
    expect(picks).toEqual([{ date: '2026-08-04', recipeId: 'satay', servings: 1 }])
  })

  it('ignores a constraint that has been removed', () => {
    const picks = generateWeek({
      nights: [{ date: '2026-08-03', people: [TODDLER] }],
      recipes: [recipe({ id: 'satay' })],
      lines: [line('satay', 'Peanut butter')],
      constraints: [{
        person_id: TODDLER.id, kind: 'allergy', tag: 'peanut', deleted_at: '2026-08-01T00:00:00.000Z'
      }],
      history: [],
      random: seeded(3)
    })
    expect(picks).toHaveLength(1)
  })

  it('treats an intolerance as hard and a dislike as merely unlikely', () => {
    const asHard = generateWeek({
      nights: [{ date: '2026-08-03', people: [ADULT] }],
      recipes: [recipe({ id: 'creamy' })],
      lines: [line('creamy', 'Double cream')],
      constraints: [{ person_id: ADULT.id, kind: 'intolerance', tag: 'cream', deleted_at: null }],
      history: [],
      random: seeded(3)
    })
    expect(asHard).toHaveLength(0)

    const asSoft = generateWeek({
      nights: [{ date: '2026-08-03', people: [ADULT] }],
      recipes: [recipe({ id: 'creamy' })],
      lines: [line('creamy', 'Double cream')],
      constraints: [{ person_id: ADULT.id, kind: 'dislike', tag: 'cream', deleted_at: null }],
      history: [],
      random: seeded(3)
    })
    // Still the only thing on the menu, so it is still dinner.
    expect(asSoft).toHaveLength(1)
  })

  it('scores nothing for a diet, in either direction', () => {
    // 'diet' names an audience for recipe adaptations, not a food to seek or
    // avoid. "High protein" matched against ingredient names would reward a
    // recipe for containing the word — so it must neither filter nor score.
    const night = { date: '2026-08-03', people: [ADULT] }
    const input = {
      nights: [night],
      recipes: [recipe({ id: 'protein bowl' }), recipe({ id: 'pasta' })],
      lines: [line('protein bowl', 'Protein powder'), line('pasta', 'Tomatoes')],
      history: [],
      random: seeded(3)
    }
    const without = rankCandidates(buildContext({ ...input, constraints: [] }), night)
    const withDiet = rankCandidates(buildContext({
      ...input,
      constraints: [{ person_id: ADULT.id, kind: 'diet', tag: 'protein', deleted_at: null }]
    }), night)
    expect(withDiet).toEqual(without)
  })
})

describe('recency', () => {
  it('leans away from something cooked days ago', () => {
    // Two identical recipes, one cooked yesterday. Over many seeds the rested one
    // should win clearly more often — a lean, not a law.
    let fresh = 0
    for (let seed = 1; seed <= 60; seed++) {
      const picks = generateWeek({
        nights: [{ date: '2026-08-03', people: [ADULT] }],
        recipes: [recipe({ id: 'recent' }), recipe({ id: 'rested' })],
        lines: [],
        constraints: [],
        history: [
          { date: '2026-08-02', recipe_id: 'recent' },
          { date: '2026-05-01', recipe_id: 'rested' }
        ],
        random: seeded(seed)
      })
      if (picks[0]?.recipeId === 'rested') fresh++
    }
    expect(fresh).toBeGreaterThan(40)
  })

  it('stops penalising once a recipe has rested long enough', () => {
    // Beyond the window there is no penalty left, so the two are even and the
    // never-cooked bonus is what separates them.
    let old = 0
    for (let seed = 1; seed <= 60; seed++) {
      const picks = generateWeek({
        nights: [{ date: '2026-08-03', people: [ADULT] }],
        recipes: [recipe({ id: 'old' }), recipe({ id: 'older' })],
        lines: [],
        constraints: [],
        history: [
          { date: '2026-01-01', recipe_id: 'old' },
          { date: '2025-01-01', recipe_id: 'older' }
        ],
        random: seeded(seed)
      })
      if (picks[0]?.recipeId === 'old') old++
    }
    expect(old).toBeGreaterThan(20)
    expect(old).toBeLessThan(40)
  })
})

describe('ingredient overlap', () => {
  it('leans towards a recipe sharing a perishable with one already picked', () => {
    // Monday is forced (only one candidate passes for it), then Tuesday chooses
    // between something sharing its coriander and something that does not.
    let shared = 0
    for (let seed = 1; seed <= 60; seed++) {
      const picks = generateWeek({
        nights: [
          { date: '2026-08-03', people: [ADULT] },
          { date: '2026-08-04', people: [ADULT] }
        ],
        recipes: [recipe({ id: 'curry' }), recipe({ id: 'salsa' }), recipe({ id: 'pie' })],
        lines: [
          line('curry', 'Coriander', 'ing-coriander'),
          line('salsa', 'Coriander', 'ing-coriander'),
          line('pie', 'Beef', 'ing-beef')
        ],
        constraints: [],
        history: [{ date: '2026-08-02', recipe_id: 'salsa' }, { date: '2026-08-02', recipe_id: 'pie' }],
        alreadyPlanned: [{ date: '2026-08-03', recipe_id: 'curry' }],
        random: seeded(seed)
      })
      if (picks[0]?.recipeId === 'salsa') shared++
    }
    // Both were cooked equally recently, so overlap is the only thing between them.
    expect(shared).toBeGreaterThan(40)
  })

  it('only counts canonical ingredients, not matching free text', () => {
    // Two lines both saying "Coriander" but never canonicalised share nothing, so
    // there is no overlap bonus to be had and the two are even.
    let shared = 0
    for (let seed = 1; seed <= 60; seed++) {
      const picks = generateWeek({
        nights: [{ date: '2026-08-04', people: [ADULT] }],
        recipes: [recipe({ id: 'salsa' }), recipe({ id: 'pie' })],
        lines: [line('salsa', 'Coriander'), line('pie', 'Beef')],
        constraints: [],
        history: [],
        alreadyPlanned: [{ date: '2026-08-03', recipe_id: 'curry' }],
        random: seeded(seed)
      })
      if (picks[0]?.recipeId === 'salsa') shared++
    }
    expect(shared).toBeGreaterThan(20)
    expect(shared).toBeLessThan(40)
  })
})

describe('effort', () => {
  it('leans short on a weeknight and long at the weekend', () => {
    const quick = recipe({ id: 'quick', prep_minutes: 5, cook_minutes: 15 })
    const slow = recipe({ id: 'slow', prep_minutes: 40, cook_minutes: 80 })

    let slowOnTuesday = 0
    let slowOnSaturday = 0
    for (let seed = 1; seed <= 60; seed++) {
      const tuesday = generateWeek({
        nights: [{ date: '2026-08-04', people: [ADULT] }],
        recipes: [quick, slow], lines: [], constraints: [], history: [], random: seeded(seed)
      })
      if (tuesday[0]?.recipeId === 'slow') slowOnTuesday++

      const saturday = generateWeek({
        nights: [{ date: '2026-08-08', people: [ADULT] }],
        recipes: [quick, slow], lines: [], constraints: [], history: [], random: seeded(seed)
      })
      if (saturday[0]?.recipeId === 'slow') slowOnSaturday++
    }
    // A two-hour meal is a big ask on any night, and overrunning is penalised
    // harder than finishing early — people abandon plans that take too long. The
    // weekend does not make it likely, only meaningfully likelier.
    expect(slowOnTuesday).toBeLessThan(3)
    expect(slowOnSaturday).toBeGreaterThan(slowOnTuesday)
  })

  it('gives a weeknight less time than a weekend', () => {
    expect(defaultEffortBudget('2026-08-04')).toBeLessThan(defaultEffortBudget('2026-08-08'))
    expect(defaultEffortBudget('2026-08-07')).toBeLessThan(defaultEffortBudget('2026-08-09'))
  })
})

describe('servings', () => {
  it('is one portion per person eating', () => {
    const picks = generateWeek({
      nights: [{ date: '2026-08-03', people: [ADULT, TODDLER] }],
      recipes: [recipe({ id: 'r1' })], lines: [], constraints: [], history: [], random: seeded(1)
    })
    expect(picks[0]?.servings).toBe(2)
  })

  it('does not cater for a baby who is not eating yet', () => {
    const picks = generateWeek({
      nights: [{ date: '2026-08-03', people: [ADULT, TODDLER, BABY] }],
      recipes: [recipe({ id: 'r1' })], lines: [], constraints: [], history: [], random: seeded(1)
    })
    expect(picks[0]?.servings).toBe(2)
  })

  it('plans nothing at all for a night nobody is home', () => {
    const picks = generateWeek({
      nights: [{ date: '2026-08-03', people: [] }, { date: '2026-08-04', people: [ADULT] }],
      recipes: [recipe({ id: 'r1' })], lines: [], constraints: [], history: [], random: seeded(1)
    })
    expect(picks.map(p => p.date)).toEqual(['2026-08-04'])
  })

  it('plans nothing for a night that is only a pre-weaning baby', () => {
    const picks = generateWeek({
      nights: [{ date: '2026-08-03', people: [BABY] }],
      recipes: [recipe({ id: 'r1' })], lines: [], constraints: [], history: [], random: seeded(1)
    })
    expect(picks).toHaveLength(0)
  })
})

describe('leftovers', () => {
  /** Two nights, two eaters, and a recipe big enough to cover both. */
  function twoNights(over: Partial<GenerateInput> = {}) {
    return generateWeek({
      nights: [
        { date: '2026-08-03', people: [ADULT, TODDLER] },
        { date: '2026-08-04', people: [ADULT, TODDLER] }
      ],
      recipes: [recipe({ id: 'batch', base_servings: 6 })],
      lines: [], constraints: [], history: [], random: seeded(1),
      ...over
    })
  }

  it('feeds the next night from a batch big enough for it', () => {
    expect(twoNights()).toEqual([
      { date: '2026-08-03', recipeId: 'batch', servings: 2 },
      { date: '2026-08-04', recipeId: 'batch', servings: 2, leftoverOfDate: '2026-08-03' }
    ])
  })

  it('caters the leftovers night for whoever is actually there', () => {
    const picks = twoNights({
      nights: [
        { date: '2026-08-03', people: [ADULT, TODDLER] },
        { date: '2026-08-04', people: [ADULT] }
      ]
    })
    expect(picks[1]?.servings).toBe(1)
  })

  it('leaves the pot alone when it is not a batch', () => {
    // Four servings, three at the table: enough for a lunchbox, not a dinner.
    const picks = twoNights({
      nights: [
        { date: '2026-08-03', people: [ADULT, TODDLER, { id: 'p-2', stage: 'child' as const }] },
        { date: '2026-08-04', people: [ADULT, TODDLER] }
      ],
      recipes: [recipe({ id: 'batch', base_servings: 4 })]
    })
    expect(picks.every(p => !p.leftoverOfDate)).toBe(true)
  })

  it('does not stretch what is left to a bigger table', () => {
    // Six servings, two eaten tonight, four people tomorrow — that is four
    // portions for four people only if nobody had seconds. Cook something.
    const picks = twoNights({
      nights: [
        { date: '2026-08-03', people: [ADULT, TODDLER] },
        {
          date: '2026-08-04',
          people: [ADULT, TODDLER, { id: 'p-2', stage: 'child' as const }, { id: 'p-3', stage: 'adult' as const },
            { id: 'p-4', stage: 'adult' as const }]
        }
      ]
    })
    expect(picks[1]?.leftoverOfDate).toBeUndefined()
  })

  it('never overwrites a night somebody planned themselves', () => {
    const picks = twoNights({
      recipes: [recipe({ id: 'batch', base_servings: 6 }), recipe({ id: 'other' })],
      alreadyPlanned: [{ date: '2026-08-04', recipe_id: 'other' }]
    })
    expect(picks.map(p => p.date)).toEqual(['2026-08-03'])
  })

  it('skips a leftovers night when nobody is home for it', () => {
    const picks = twoNights({
      nights: [
        { date: '2026-08-03', people: [ADULT, TODDLER] },
        { date: '2026-08-04', people: [] }
      ]
    })
    expect(picks).toHaveLength(1)
  })

  it('does not treat the second night as a second cooking of the recipe', () => {
    // The no-repeat rule counts pots, not plates: the batch is cooked once, so
    // the rest of the week is still free to be different.
    const picks = generateWeek({
      nights: [
        { date: '2026-08-03', people: [ADULT, TODDLER] },
        { date: '2026-08-04', people: [ADULT, TODDLER] },
        { date: '2026-08-05', people: [ADULT, TODDLER] }
      ],
      recipes: [recipe({ id: 'batch', base_servings: 6 }), recipe({ id: 'other' })],
      lines: [], constraints: [], history: [], random: seeded(1)
    })
    const cooked = picks.filter(p => !p.leftoverOfDate).map(p => p.recipeId)
    expect(new Set(cooked).size).toBe(cooked.length)
    expect(picks).toHaveLength(3)
  })

  it('chains at most one night off a single batch', () => {
    const picks = generateWeek({
      nights: ['2026-08-03', '2026-08-04', '2026-08-05'].map(date => ({ date, people: [ADULT] })),
      recipes: [recipe({ id: 'huge', base_servings: 20 }), recipe({ id: 'other', base_servings: 1 })],
      lines: [], constraints: [], history: [], random: seeded(1)
    })
    expect(picks.filter(p => p.leftoverOfDate)).toHaveLength(1)
  })

  it('is still deterministic given the same randomness', () => {
    expect(twoNights({ random: seeded(9) })).toEqual(twoNights({ random: seeded(9) }))
  })
})

describe('nights a person already chose', () => {
  it('leaves them alone', () => {
    const picks = generateWeek({
      nights: week(),
      recipes: [recipe({ id: 'r1' }), recipe({ id: 'r2' })],
      lines: [], constraints: [], history: [],
      alreadyPlanned: [{ date: '2026-08-03', recipe_id: 'r1' }],
      random: seeded(1)
    })
    expect(picks.some(p => p.date === '2026-08-03')).toBe(false)
  })

  it('does not repeat what they chose', () => {
    const picks = generateWeek({
      nights: week(),
      recipes: [recipe({ id: 'r1' }), recipe({ id: 'r2' })],
      lines: [], constraints: [], history: [],
      alreadyPlanned: [{ date: '2026-08-03', recipe_id: 'r1' }],
      random: seeded(1)
    })
    expect(picks.every(p => p.recipeId === 'r2')).toBe(true)
    expect(picks).toHaveLength(1)
  })
})

describe('rankCandidates', () => {
  /** A context over a fixed library, so a ranking assertion is about scoring alone. */
  function context(over: Partial<GenerateInput> = {}) {
    return buildContext({
      nights: week(),
      recipes: [recipe({ id: 'r1' }), recipe({ id: 'r2' }), recipe({ id: 'r3' })],
      lines: [],
      constraints: [],
      history: [],
      ...over
    })
  }

  const monday = { date: '2026-08-03', people: [ADULT, TODDLER] }

  it('scores every live recipe the night could have', () => {
    expect(rankCandidates(context(), monday).map(c => c.recipe.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('leaves out anything an allergy rules out, rather than scoring it low', () => {
    const ranked = rankCandidates(
      context({
        lines: [line('r2', 'peanut butter')],
        constraints: [{ person_id: ADULT.id, kind: 'allergy', tag: 'peanut', deleted_at: null }]
      }),
      monday
    )
    expect(ranked.map(c => c.recipe.id)).toEqual(['r1', 'r3'])
  })

  it('leaves out what the week has already chosen', () => {
    const ranked = rankCandidates(
      context({ alreadyPlanned: [{ date: '2026-08-04', recipe_id: 'r1' }] }),
      monday
    )
    expect(ranked.map(c => c.recipe.id)).toEqual(['r2', 'r3'])
  })

  it('keeps library order, because the weighted pick draws against it', () => {
    // Sorting here would remap every seeded outcome onto a different recipe.
    const ranked = rankCandidates(
      context({ history: [{ date: '2026-08-02', recipe_id: 'r1' }] }),
      monday
    )
    expect(ranked.map(c => c.recipe.id)).toEqual(['r1', 'r2', 'r3'])
    expect(ranked[0]!.score).toBeLessThan(ranked[1]!.score)
  })

  it('ranks something cooked yesterday below something never cooked', () => {
    const [best] = topCandidates(
      context({ history: [{ date: '2026-08-02', recipe_id: 'r1' }] }),
      monday,
      3
    )
    expect(best!.recipe.id).not.toBe('r1')
  })

  it('rewards sharing an ingredient with a night already planned', () => {
    const ranked = topCandidates(
      context({
        lines: [line('r1', 'coriander', 'i-cor'), line('r2', 'coriander', 'i-cor')],
        alreadyPlanned: [{ date: '2026-08-04', recipe_id: 'r1' }],
        // Everything equally rested, so overlap is the only thing left to
        // separate them — otherwise r3's never-cooked bonus is the louder fact.
        history: [
          { date: '2026-06-01', recipe_id: 'r2' },
          { date: '2026-06-01', recipe_id: 'r3' }
        ]
      }),
      monday,
      3
    )
    expect(ranked[0]!.recipe.id).toBe('r2')
    expect(ranked[0]!.reason).toEqual({ kind: 'overlap', shared: 1 })
  })

  it('puts a shortlisted meal top, and says so', () => {
    const ranked = topCandidates(
      context({
        recipes: [recipe({ id: 'r1' }), recipe({ id: 'r2', shortlisted_at: '2026-08-01T09:00:00Z' })],
        // Both cooked the same day long ago, so nothing but the shortlist
        // separates them — otherwise a never-cooked bonus is doing the work.
        history: [
          { date: '2026-06-01', recipe_id: 'r1' },
          { date: '2026-06-01', recipe_id: 'r2' }
        ]
      }),
      monday,
      2
    )
    expect(ranked[0]!.recipe.id).toBe('r2')
    expect(ranked[0]!.reason).toEqual({ kind: 'shortlist' })
    expect(suggestionReason(ranked[0]!)).toBe('On the shortlist')
  })

  it('does not let the shortlist override an allergy', () => {
    // The bonus is scoring; allergies are a filter. A filter cannot be outbid.
    const ranked = rankCandidates(
      context({
        recipes: [recipe({ id: 'r1' }), recipe({ id: 'satay', shortlisted_at: '2026-08-01T09:00:00Z' })],
        lines: [line('satay', 'peanut butter')],
        constraints: [{ person_id: ADULT.id, kind: 'allergy', tag: 'peanut', deleted_at: null }]
      }),
      monday
    )
    expect(ranked.map(c => c.recipe.id)).toEqual(['r1'])
  })

  it('still leans away from a shortlisted meal cooked yesterday', () => {
    // A lean, not a law: the recency penalty is bigger than the bonus, so
    // shortlisting something does not put it back on the table the next night.
    const ranked = topCandidates(
      context({
        recipes: [recipe({ id: 'r1' }), recipe({ id: 'r2', shortlisted_at: '2026-08-01T09:00:00Z' })],
        history: [
          { date: '2026-08-02', recipe_id: 'r2' },
          { date: '2026-06-01', recipe_id: 'r1' }
        ]
      }),
      monday,
      2
    )
    expect(ranked[0]!.recipe.id).toBe('r1')
  })

  it('is empty when every recipe is already spoken for', () => {
    expect(rankCandidates(
      context({
        alreadyPlanned: [
          { date: '2026-08-04', recipe_id: 'r1' },
          { date: '2026-08-05', recipe_id: 'r2' },
          { date: '2026-08-06', recipe_id: 'r3' }
        ]
      }),
      monday
    )).toEqual([])
  })
})

describe('suggestionReason', () => {
  const candidate = (reason: RankReason): RankedCandidate => ({
    recipe: recipe({ id: 'r1' }),
    score: 0,
    weight: 1,
    reason
  })

  it('leads with the cupboard when the cupboard covers it', () => {
    expect(suggestionReason(candidate({ kind: 'never' }), { allPantry: true }))
      .toBe('All pantry — nothing to buy')
  })

  it('names the night the time fits', () => {
    expect(suggestionReason(candidate({ kind: 'quick', minutes: 25, budget: 30 })))
      .toBe('25 min — fits a 30 min night')
  })

  it('counts weeks rather than days since it was last cooked', () => {
    expect(suggestionReason(candidate({ kind: 'rested', days: 15 })))
      .toBe('Nothing like it for 2 weeks')
  })

  it('prefers a track record when there is one', () => {
    expect(suggestionReason(candidate({ kind: 'rested', days: 15 }), { cookedTimes: 11 }))
      .toBe('Cooked 11× — nobody complains')
  })
})

describe('eaters', () => {
  it('counts everybody but a pre-weaning baby', () => {
    expect(eaters([ADULT, TODDLER, BABY]).map(p => p.id)).toEqual([ADULT.id, TODDLER.id])
  })

  it('counts a weaning baby, who is eating something', () => {
    expect(eaters([{ id: 'w', stage: 'weaning' }])).toHaveLength(1)
  })
})
