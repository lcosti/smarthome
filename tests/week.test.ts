import { describe, expect, it } from 'vitest'
import {
  addDays, dayLabel, isoDate, isoWeekNumber, mondayOf, todayIso, weekDates, weekLabel
} from '../app/utils/week'

describe('isoDate', () => {
  it('formats a local calendar date', () => {
    expect(isoDate(new Date(2026, 7, 4))).toBe('2026-08-04')
  })

  it('zero-pads single digit months and days', () => {
    expect(isoDate(new Date(2026, 0, 9))).toBe('2026-01-09')
  })

  it('uses the local date late at night, not the UTC one', () => {
    // The bug this guards: toISOString() on 23:30 in a positive-offset zone
    // reports tomorrow, filing Tuesday's dinner under Wednesday.
    const lateEvening = new Date(2026, 7, 4, 23, 30)
    expect(isoDate(lateEvening)).toBe('2026-08-04')
    expect(isoDate(lateEvening)).toBe(isoDate(new Date(2026, 7, 4, 0, 30)))
  })
})

describe('mondayOf', () => {
  it('returns the same day when given a Monday', () => {
    expect(isoDate(mondayOf(new Date(2026, 7, 3)))).toBe('2026-08-03')
  })

  it('walks back from midweek', () => {
    expect(isoDate(mondayOf(new Date(2026, 7, 6)))).toBe('2026-08-03')
  })

  it('treats Sunday as the end of the week it started, not the start of the next', () => {
    expect(isoDate(mondayOf(new Date(2026, 7, 9)))).toBe('2026-08-03')
  })

  it('crosses a month boundary', () => {
    expect(isoDate(mondayOf(new Date(2026, 7, 1)))).toBe('2026-07-27')
  })

  it('crosses a year boundary', () => {
    expect(isoDate(mondayOf(new Date(2027, 0, 1)))).toBe('2026-12-28')
  })

  it('zeroes the time so week arithmetic never drifts', () => {
    const monday = mondayOf(new Date(2026, 7, 6, 17, 45, 30, 123))
    expect([monday.getHours(), monday.getMinutes(), monday.getSeconds(), monday.getMilliseconds()])
      .toEqual([0, 0, 0, 0])
  })

  it('survives the spring and autumn clock changes', () => {
    // UK DST 2026: forward 29 March, back 25 October — both Sundays, so both
    // weeks contain a day that is 23 or 25 hours long.
    expect(isoDate(mondayOf(new Date(2026, 2, 29)))).toBe('2026-03-23')
    expect(isoDate(mondayOf(new Date(2026, 9, 25)))).toBe('2026-10-19')
    expect(weekDates(mondayOf(new Date(2026, 2, 29)))).toHaveLength(7)
  })
})

describe('addDays', () => {
  it('moves forward and backward without mutating its argument', () => {
    const start = new Date(2026, 7, 4)
    expect(isoDate(addDays(start, 3))).toBe('2026-08-07')
    expect(isoDate(addDays(start, -5))).toBe('2026-07-30')
    expect(isoDate(start)).toBe('2026-08-04')
  })

  it('rolls over a leap day', () => {
    expect(isoDate(addDays(new Date(2028, 1, 28), 1))).toBe('2028-02-29')
  })
})

describe('weekDates', () => {
  it('returns seven consecutive dates from the Monday', () => {
    expect(weekDates(mondayOf(new Date(2026, 7, 6)))).toEqual([
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
      '2026-08-07', '2026-08-08', '2026-08-09'
    ])
  })

  it('spans a month boundary without gaps', () => {
    const dates = weekDates(mondayOf(new Date(2026, 6, 30)))
    expect(dates).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
      '2026-07-31', '2026-08-01', '2026-08-02'
    ])
  })

  it('produces the same seven days across a DST change', () => {
    expect(weekDates(mondayOf(new Date(2026, 9, 25)))).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22',
      '2026-10-23', '2026-10-24', '2026-10-25'
    ])
  })
})

describe('labels', () => {
  // Exact wording is locale-dependent, so assert the parts that must be present
  // rather than pinning a format the CI runner may not share.
  it('names the weekday and the day of the month', () => {
    const label = dayLabel('2026-08-04')
    expect(label).toContain('4')
    expect(label.toLowerCase()).toMatch(/tue/)
  })

  it('reads the date key as a local date, not a UTC instant', () => {
    // '2026-08-04' parsed by the Date constructor would be midnight UTC, which
    // is 3 August in the Americas.
    expect(dayLabel('2026-08-04')).toContain('4')
  })

  it('shows both ends of the week', () => {
    const label = weekLabel(mondayOf(new Date(2026, 7, 6)))
    expect(label).toContain('3')
    expect(label).toContain('9')
  })

  it('names the month once within a month and twice across one', () => {
    const within = weekLabel(mondayOf(new Date(2026, 7, 6)))
    const across = weekLabel(mondayOf(new Date(2026, 6, 30)))
    const monthCount = (text: string) => (text.match(/[A-Za-z]{3,}/g) ?? []).length
    expect(monthCount(within)).toBe(1)
    expect(monthCount(across)).toBe(2)
  })
})

describe('todayIso', () => {
  it('agrees with isoDate of now', () => {
    expect(todayIso()).toBe(isoDate(new Date()))
  })
})

describe('isoWeekNumber', () => {
  it('numbers an ordinary week', () => {
    // The Friday the design was drawn for.
    expect(isoWeekNumber(new Date(2026, 6, 31))).toBe(31)
    // Every day of that week is the same number.
    expect(isoWeekNumber(new Date(2026, 6, 27))).toBe(31)
    expect(isoWeekNumber(new Date(2026, 7, 2))).toBe(31)
  })

  it('gives January its predecessor\'s number when the year starts mid-week', () => {
    // 1 January 2027 is a Friday, so that week's Thursday is still in 2026:
    // week 53 of 2026, not week 1 of 2027.
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53)
    expect(isoWeekNumber(new Date(2027, 0, 4))).toBe(1)
  })

  it('gives late December next year\'s number when the year ends mid-week', () => {
    // 31 December 2024 is a Tuesday, in the week whose Thursday is 2 January.
    expect(isoWeekNumber(new Date(2024, 11, 31))).toBe(1)
  })

  it('numbers a year that starts on a Thursday from the first', () => {
    // 1 January 2026 is a Thursday, so it is in week 1 by definition.
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1)
  })
})
