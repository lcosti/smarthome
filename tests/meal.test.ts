import { describe, expect, it } from 'vitest'
import {
  DINNER,
  isMeal,
  isMealTagged,
  MEALS,
  mealFitRank,
  mealRank,
  suitsMeal,
  type MealSuits
} from '../app/utils/meal'

function suits(overrides: Partial<MealSuits> = {}): MealSuits {
  return { suits_breakfast: false, suits_lunch: false, suits_dinner: false, ...overrides }
}

describe('MEALS', () => {
  it('runs in the order a day happens', () => {
    // Everything that lays the three out — the wide grid's columns, the two rows
    // under the phone's dinner, the "add to" chips — renders this array in
    // order, so the order is the design rather than an implementation detail.
    expect([...MEALS]).toEqual(['breakfast', 'lunch', 'dinner'])
  })

  it('has dinner as the slot everything defaults to', () => {
    expect(DINNER).toBe('dinner')
    expect(MEALS.includes(DINNER)).toBe(true)
  })
})

describe('mealRank', () => {
  it('ranks the three slots in order', () => {
    expect(mealRank('breakfast')).toBe(0)
    expect(mealRank('lunch')).toBe(1)
    expect(mealRank('dinner')).toBe(2)
  })

  it('sorts a meal it has never heard of last, not first', () => {
    // The column has no check constraint, so a row written by a later version of
    // the app can sync into this one. `indexOf` returning -1 would file "supper"
    // above breakfast, which is the one answer that is definitely wrong.
    expect(mealRank('supper')).toBeGreaterThan(mealRank('dinner'))
  })

  it('orders two meals on one date when the review groups by meal', () => {
    const keys = ['dinner', 'breakfast', 'lunch']
      .map(meal => `2026-08-10#${mealRank(meal)}`)
      .sort()

    expect(keys).toEqual(['2026-08-10#0', '2026-08-10#1', '2026-08-10#2'])
  })
})

describe('isMeal', () => {
  it('accepts the three and refuses anything else', () => {
    expect(isMeal('lunch')).toBe(true)
    expect(isMeal('supper')).toBe(false)
    expect(isMeal('')).toBe(false)
  })
})

describe('which meals a recipe suits', () => {
  it('treats nothing ticked as no opinion rather than as suiting nothing', () => {
    // The state every recipe in the library is in until somebody labels one, and
    // the reason the column could land with no backfill. If this ever flips, a
    // household that has labelled nothing gets an empty list at every slot.
    const unlabelled = suits()

    expect(isMealTagged(unlabelled)).toBe(false)
    expect(MEALS.every(meal => suitsMeal(unlabelled, meal))).toBe(true)
  })

  it('narrows to what was ticked once anything is', () => {
    const porridge = suits({ suits_breakfast: true })

    expect(suitsMeal(porridge, 'breakfast')).toBe(true)
    expect(suitsMeal(porridge, 'lunch')).toBe(false)
    expect(suitsMeal(porridge, 'dinner')).toBe(false)
  })

  it('lets one recipe be two meals', () => {
    const soup = suits({ suits_lunch: true, suits_dinner: true })

    expect(suitsMeal(soup, 'lunch')).toBe(true)
    expect(suitsMeal(soup, 'dinner')).toBe(true)
    expect(suitsMeal(soup, 'breakfast')).toBe(false)
  })
})

describe('mealFitRank', () => {
  it('puts a labelled match above an unlabelled recipe above another meal’s', () => {
    // Three tiers rather than a yes/no: "nobody said" and "somebody said it is a
    // dinner" are both "not a breakfast", and only the second is a reason to
    // sink it.
    expect(mealFitRank(suits({ suits_breakfast: true }), 'breakfast')).toBe(0)
    expect(mealFitRank(suits(), 'breakfast')).toBe(1)
    expect(mealFitRank(suits({ suits_dinner: true }), 'breakfast')).toBe(2)
  })

  it('leaves an unlabelled library in the order it was already in', () => {
    // The property that makes labelling worth doing to five recipes rather than
    // compulsory across four hundred: with nothing ticked, every rank ties and
    // the alphabetical sort behind it survives untouched.
    const library = ['Chilli', 'Apple cake', 'Beans'].map(name => ({ name, ...suits() }))
    const sorted = [...library].sort((a, b) =>
      mealFitRank(a, 'dinner') - mealFitRank(b, 'dinner') || a.name.localeCompare(b.name)
    )

    expect(sorted.map(r => r.name)).toEqual(['Apple cake', 'Beans', 'Chilli'])
  })

  it('floats the breakfast to the top of a list it would sort last in', () => {
    const library = [
      { name: 'Apple cake', ...suits() },
      { name: 'Beef stew', ...suits({ suits_dinner: true }) },
      { name: 'Porridge', ...suits({ suits_breakfast: true }) }
    ]
    const sorted = [...library].sort((a, b) =>
      mealFitRank(a, 'breakfast') - mealFitRank(b, 'breakfast') || a.name.localeCompare(b.name)
    )

    expect(sorted.map(r => r.name)).toEqual(['Porridge', 'Apple cake', 'Beef stew'])
  })
})
