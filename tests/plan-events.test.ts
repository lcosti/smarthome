import { describe, expect, it } from 'vitest'
import { rankOf } from '../app/composables/usePlanEvents'

const event = (time: string | null) => ({ id: 'e', title: 'x', time, hue: null })

describe('what a night shows first', () => {
  it('puts the shape of the day above anything happening during it', () => {
    expect(rankOf(event(null))).toBeLessThan(rankOf(event('18:30')))
  })

  it('puts the evening above the morning', () => {
    // A card has room for two. Spending them on "bin day, 07:00" instead of
    // "football, 18:30" is showing the one that cannot change what is cooked.
    expect(rankOf(event('18:30'))).toBeLessThan(rankOf(event('07:00')))
  })

  it('treats mid-afternoon as already eating into the cooking', () => {
    expect(rankOf(event('15:00'))).toBe(rankOf(event('20:00')))
    expect(rankOf(event('14:59'))).toBeGreaterThan(rankOf(event('15:00')))
  })
})
