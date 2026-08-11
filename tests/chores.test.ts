import { describe, expect, it } from 'vitest'
import {
  choreCompletionId,
  choreOccurrencesOn,
  choreScheduleLabel,
  isoWeekday,
  ordinalDay,
  type ChoreCompletionLike,
  type ChoreLike
} from '../app/utils/chores'
import { dayLabel } from '../app/utils/week'

const HOUSEHOLD = '11111111-2222-3333-4444-555555555555'

// 2026-07-30 is a Thursday, which is the day the board tests are drawn for too.
const THURSDAY = '2026-07-30'
const FRIDAY = '2026-07-31'

function chore(overrides: Partial<ChoreLike> & { id: string }): ChoreLike {
  return {
    household_id: HOUSEHOLD,
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
  return choreOccurrencesOn(date, chores, completions)
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

  it('keys the tick on the chore’s own household, not on anything passed alongside', () => {
    // The board asks this question with whatever the device happens to be
    // holding. Which household a chore is in is written on it, so a device that
    // has not worked out its own identity yet still draws the day and still
    // lands its ticks on the row the other phone is writing.
    const other = '99999999-8888-7777-6666-555555555555'
    const bins = chore({ id: 'bins', name: 'Bins out', household_id: other, weekdays: [4] })

    expect(occurrences(THURSDAY, [bins])[0]?.completionId)
      .toBe(choreCompletionId(other, 'bins', THURSDAY))
  })

  it('resolves a tick written against the chore’s household', () => {
    const other = '99999999-8888-7777-6666-555555555555'
    const bins = chore({ id: 'bins', name: 'Bins out', household_id: other, weekdays: [4] })
    const ticked = completion('bins', THURSDAY, {
      id: choreCompletionId(other, 'bins', THURSDAY)
    })

    expect(occurrences(THURSDAY, [bins], [ticked])[0]?.done).toBe(true)
  })
})

describe('every other week', () => {
  // Every other Thursday, starting the week of 2026-07-30.
  const recycling = chore({
    id: 'recycling',
    name: 'Recycling',
    rule: 'weekly',
    weekdays: [4],
    week_interval: 2,
    anchor_date: THURSDAY
  })

  it('runs one week in two, from the week it starts in', () => {
    expect(occurrences(THURSDAY, [recycling])).toHaveLength(1)
    expect(occurrences('2026-08-06', [recycling])).toEqual([])
    expect(occurrences('2026-08-13', [recycling])).toHaveLength(1)
    expect(occurrences('2026-08-20', [recycling])).toEqual([])
  })

  it('does not run before it starts', () => {
    expect(occurrences('2026-07-16', [recycling])).toEqual([])
    expect(occurrences('2026-07-23', [recycling])).toEqual([])
  })

  it('counts weeks, not days from the anchor — any day of the starting week does', () => {
    // Monday of the same week is the same fortnight.
    const fromMonday = chore({ ...recycling, anchor_date: '2026-07-27' })
    expect(occurrences(THURSDAY, [fromMonday])).toHaveLength(1)
    expect(occurrences('2026-08-06', [fromMonday])).toEqual([])
    expect(occurrences('2026-08-13', [fromMonday])).toHaveLength(1)
  })

  it('keeps counting across the new year', () => {
    const newYear = chore({ ...recycling, anchor_date: '2026-12-31' })
    expect(occurrences('2026-12-31', [newYear])).toHaveLength(1)
    expect(occurrences('2027-01-07', [newYear])).toEqual([])
    expect(occurrences('2027-01-14', [newYear])).toHaveLength(1)
  })

  it('still runs every week when the interval is 1', () => {
    const weekly = chore({ ...recycling, week_interval: 1 })
    expect(occurrences(THURSDAY, [weekly])).toHaveLength(1)
    expect(occurrences('2026-08-06', [weekly])).toHaveLength(1)
  })

  it('only runs on the weekdays it was given', () => {
    expect(occurrences(FRIDAY, [recycling])).toEqual([])
  })
})

describe('every month', () => {
  it('runs on its day of the month and no other', () => {
    const rent = chore({ id: 'rent', name: 'Rent', rule: 'monthly', month_day: 15 })
    expect(occurrences('2026-08-15', [rent])).toHaveLength(1)
    expect(occurrences('2026-08-14', [rent])).toEqual([])
    expect(occurrences('2026-09-15', [rent])).toHaveLength(1)
  })

  it('falls back to the last day in a month that is too short', () => {
    const last = chore({ id: 'last', name: 'Meter reading', rule: 'monthly', month_day: 31 })
    expect(occurrences('2026-03-31', [last])).toHaveLength(1)
    // February 2026 has 28 days, February 2028 has 29, April has 30.
    expect(occurrences('2026-02-28', [last])).toHaveLength(1)
    expect(occurrences('2028-02-29', [last])).toHaveLength(1)
    expect(occurrences('2028-02-28', [last])).toEqual([])
    expect(occurrences('2026-04-30', [last])).toHaveLength(1)
    expect(occurrences('2026-04-29', [last])).toEqual([])
  })

  it('runs on an ordinal weekday', () => {
    // August 2026 starts on a Saturday: the first Sunday is the 2nd.
    const alarms = chore({
      id: 'alarms', name: 'Smoke alarms', rule: 'monthly', month_week: 1, month_weekday: 7
    })
    expect(occurrences('2026-08-02', [alarms])).toHaveLength(1)
    expect(occurrences('2026-08-09', [alarms])).toEqual([])
    // September's first Sunday is the 6th.
    expect(occurrences('2026-09-06', [alarms])).toHaveLength(1)
  })

  it('counts a fourth weekday from the start of the month', () => {
    // Fridays in August 2026: 7, 14, 21, 28.
    const shed = chore({
      id: 'shed', name: 'Shed', rule: 'monthly', month_week: 4, month_weekday: 5
    })
    expect(occurrences('2026-08-28', [shed])).toHaveLength(1)
    expect(occurrences('2026-08-21', [shed])).toEqual([])
  })

  it('finds the last weekday whether the month has four of them or five', () => {
    const bins = chore({
      id: 'bins', name: 'Big bin', rule: 'monthly', month_week: -1, month_weekday: 1
    })
    // Mondays in August 2026: 3, 10, 17, 24, 31.
    expect(occurrences('2026-08-31', [bins])).toHaveLength(1)
    expect(occurrences('2026-08-24', [bins])).toEqual([])
    // Mondays in September 2026: 7, 14, 21, 28.
    expect(occurrences('2026-09-28', [bins])).toHaveLength(1)
    expect(occurrences('2026-09-21', [bins])).toEqual([])
  })

  it('never runs when the month rule says nothing', () => {
    const half = chore({ id: 'half', name: 'Half a rule', rule: 'monthly' })
    expect(occurrences('2026-08-15', [half])).toEqual([])
    expect(occurrences('2026-08-16', [half])).toEqual([])
  })
})

describe('a chore written before the recurrence migration', () => {
  it('reads a weekly rule off its weekdays, with no rule column at all', () => {
    const bins = chore({ id: 'bins', name: 'Bins out', weekdays: [4] })
    expect(occurrences(THURSDAY, [bins])).toHaveLength(1)
    expect(occurrences(FRIDAY, [bins])).toEqual([])
  })

  it('reads a one-off off its date', () => {
    const gate = chore({ id: 'gate', name: 'Fix the gate', due_date: THURSDAY })
    expect(occurrences(THURSDAY, [gate])).toHaveLength(1)
  })

  it('does the same when the rule column says something it does not understand', () => {
    const odd = chore({ id: 'odd', name: 'Odd', rule: 'quarterly', weekdays: [4] })
    expect(occurrences(THURSDAY, [odd])).toHaveLength(1)
  })
})

describe('saying a rule out loud', () => {
  it('numbers a day of the month', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinalDay))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '31st'])
  })

  it('says each shape the way somebody would', () => {
    expect(choreScheduleLabel(chore({ id: 'a', weekdays: [2, 5] }))).toBe('Tue, Fri')
    expect(choreScheduleLabel(chore({
      id: 'b', weekdays: [2], week_interval: 2, anchor_date: THURSDAY
    }))).toBe('Every other Tue')
    expect(choreScheduleLabel(chore({ id: 'c', rule: 'monthly', month_day: 15 })))
      .toBe('15th of the month')
    expect(choreScheduleLabel(chore({
      id: 'd', rule: 'monthly', month_week: 1, month_weekday: 7
    }))).toBe('First Sun of the month')
    expect(choreScheduleLabel(chore({
      id: 'e', rule: 'monthly', month_week: -1, month_weekday: 1
    }))).toBe('Last Mon of the month')
    expect(choreScheduleLabel(chore({ id: 'f', due_date: THURSDAY }))).toBe(dayLabel(THURSDAY))
  })

  it('says nothing rather than something wrong about a half-written rule', () => {
    expect(choreScheduleLabel(chore({ id: 'g', rule: 'monthly' }))).toBe('')
    expect(choreScheduleLabel(chore({ id: 'h', rule: 'weekly' }))).toBe('')
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
