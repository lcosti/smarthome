import { describe, expect, it } from 'vitest'
import {
  choreCompletionId,
  choreOccurrencesOn,
  isoWeekday,
  type ChoreCompletionLike,
  type ChoreLike
} from '../app/utils/chores'

const HOUSEHOLD = '11111111-2222-3333-4444-555555555555'

// 2026-07-30 is a Thursday, which is the day the board tests are drawn for too.
const THURSDAY = '2026-07-30'
const FRIDAY = '2026-07-31'

function chore(overrides: Partial<ChoreLike> & { id: string }): ChoreLike {
  return {
    name: overrides.id,
    person_id: null,
    weekdays: null,
    due_date: null,
    at_time: null,
    deleted_at: null,
    ...overrides
  }
}

function completion(
  choreId: string,
  date: string,
  overrides: Partial<ChoreCompletionLike> = {}
): ChoreCompletionLike {
  return {
    id: choreCompletionId(HOUSEHOLD, choreId, date),
    chore_id: choreId,
    date,
    done: true,
    deleted_at: null,
    ...overrides
  }
}

function occurrences(date: string, chores: ChoreLike[], completions: ChoreCompletionLike[] = []) {
  return choreOccurrencesOn(date, chores, completions, HOUSEHOLD)
}

describe('isoWeekday', () => {
  it('counts from Monday, and puts Sunday last', () => {
    expect(isoWeekday('2026-07-27')).toBe(1)
    expect(isoWeekday(THURSDAY)).toBe(4)
    expect(isoWeekday('2026-08-02')).toBe(7)
  })

  it('is unmoved by the clocks going forward', () => {
    // The UK springs forward on 2026-03-29, which is a Sunday. A date parsed
    // through local midnight is the classic place that lands on the wrong day.
    expect(isoWeekday('2026-03-28')).toBe(6)
    expect(isoWeekday('2026-03-29')).toBe(7)
    expect(isoWeekday('2026-03-30')).toBe(1)
    // And back again, on 2026-10-25.
    expect(isoWeekday('2026-10-25')).toBe(7)
    expect(isoWeekday('2026-10-26')).toBe(1)
  })
})

describe('choreCompletionId', () => {
  it('is the same id from the same three facts, and different from any other', () => {
    expect(choreCompletionId(HOUSEHOLD, 'bins', THURSDAY))
      .toBe(choreCompletionId(HOUSEHOLD, 'bins', THURSDAY))
    expect(choreCompletionId(HOUSEHOLD, 'bins', THURSDAY))
      .not.toBe(choreCompletionId(HOUSEHOLD, 'bins', FRIDAY))
    expect(choreCompletionId(HOUSEHOLD, 'bins', THURSDAY))
      .not.toBe(choreCompletionId(HOUSEHOLD, 'recycling', THURSDAY))
  })

  it('is a v5 uuid', () => {
    expect(choreCompletionId(HOUSEHOLD, 'bins', THURSDAY))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('which chores fall on a day', () => {
  it('puts a weekly chore on its weekday and nowhere else', () => {
    const bins = chore({ id: 'bins', name: 'Bins out', weekdays: [4] })
    expect(occurrences(THURSDAY, [bins]).map(o => o.title)).toEqual(['Bins out'])
    expect(occurrences(FRIDAY, [bins])).toEqual([])
  })

  it('treats a chore on two weekdays as one chore on both', () => {
    const hoover = chore({ id: 'hoover', name: 'Hoover', weekdays: [4, 5] })
    expect(occurrences(THURSDAY, [hoover])).toHaveLength(1)
    expect(occurrences(FRIDAY, [hoover])).toHaveLength(1)
    expect(occurrences('2026-08-01', [hoover])).toEqual([])
  })

  it('puts a one-off on its date only, and does not carry it forward', () => {
    const gate = chore({ id: 'gate', name: 'Fix the gate', due_date: THURSDAY })
    expect(occurrences(THURSDAY, [gate]).map(o => o.title)).toEqual(['Fix the gate'])
    expect(occurrences(FRIDAY, [gate])).toEqual([])
  })

  it('ignores a deleted chore', () => {
    const gone = chore({
      id: 'gone', name: 'Gone', weekdays: [4], deleted_at: '2026-07-29T10:00:00.000Z'
    })
    expect(occurrences(THURSDAY, [gone])).toEqual([])
  })

  it('carries whose it is and when, untouched', () => {
    const bins = chore({
      id: 'bins', name: 'Bins out', weekdays: [4], person_id: 'luke', at_time: '19:00'
    })
    expect(occurrences(THURSDAY, [bins])[0]).toMatchObject({
      choreId: 'bins',
      completionId: choreCompletionId(HOUSEHOLD, 'bins', THURSDAY),
      date: THURSDAY,
      title: 'Bins out',
      personId: 'luke',
      time: '19:00',
      done: false
    })
  })

  it('sorts untimed first, then by the clock, then by name', () => {
    const chores = [
      chore({ id: 'c', name: 'Washing', weekdays: [4], at_time: '19:00' }),
      chore({ id: 'a', name: 'Water the plants', weekdays: [4] }),
      chore({ id: 'b', name: 'Bins out', weekdays: [4], at_time: '07:30' }),
      chore({ id: 'd', name: 'Airing cupboard', weekdays: [4] })
    ]
    expect(occurrences(THURSDAY, chores).map(o => o.title))
      .toEqual(['Airing cupboard', 'Water the plants', 'Bins out', 'Washing'])
  })
})

describe('whether a chore has been done', () => {
  const bins = chore({ id: 'bins', name: 'Bins out', weekdays: [4] })

  it('is not done when nothing has been written', () => {
    expect(occurrences(THURSDAY, [bins])[0]?.done).toBe(false)
  })

  it('is done when a live row says so', () => {
    expect(occurrences(THURSDAY, [bins], [completion('bins', THURSDAY)])[0]?.done).toBe(true)
  })

  it('goes back to not done when the row is flipped rather than deleted', () => {
    const untick = [completion('bins', THURSDAY, { done: false })]
    expect(occurrences(THURSDAY, [bins], untick)[0]?.done).toBe(false)
  })

  it('ignores a soft-deleted tick', () => {
    const deleted = [completion('bins', THURSDAY, { deleted_at: '2026-07-30T21:00:00.000Z' })]
    expect(occurrences(THURSDAY, [bins], deleted)[0]?.done).toBe(false)
  })

  it('does not let one day\'s tick answer for another', () => {
    const thursdayDone = [completion('bins', THURSDAY)]
    const nextWeek = '2026-08-06'
    expect(occurrences(nextWeek, [bins], thursdayDone)[0]?.done).toBe(false)
  })
})
