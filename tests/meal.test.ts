import { describe, expect, it } from 'vitest'
import { DINNER, isMeal, MEALS, mealRank } from '../app/utils/meal'

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
