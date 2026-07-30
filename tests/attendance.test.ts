import { describe, expect, it } from 'vitest'
import {
  attendanceId,
  awayPeople,
  constraintId,
  isHardConstraint,
  isPresent,
  normaliseTag,
  presentPeople,
  type AttendanceLike
} from '../app/utils/attendance'

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111'
const TOM = '22222222-2222-4222-8222-222222222222'
const AMY = '33333333-3333-4333-8333-333333333333'

function row(overrides: Partial<AttendanceLike> = {}): AttendanceLike {
  return {
    id: 'row-1',
    person_id: TOM,
    date: '2026-08-04',
    meal: 'dinner',
    present: false,
    deleted_at: null,
    ...overrides
  }
}

function person(id: string, deleted = false) {
  return { id, deleted_at: deleted ? '2026-08-01T00:00:00.000Z' : null }
}

describe('isPresent', () => {
  it('treats no row at all as present', () => {
    // The whole design: a quiet week writes nothing, and everybody is still home.
    expect(isPresent(TOM, '2026-08-04', 'dinner', [])).toBe(true)
  })

  it('treats a false row as away', () => {
    expect(isPresent(TOM, '2026-08-04', 'dinner', [row()])).toBe(false)
  })

  it('treats a row flipped back to true as present', () => {
    // Marking somebody back in is an update, not a delete.
    expect(isPresent(TOM, '2026-08-04', 'dinner', [row({ present: true })])).toBe(true)
  })

  it('treats a soft-deleted absence as present', () => {
    // Deleting the record of an absence says the absence never happened.
    const deleted = row({ deleted_at: '2026-08-02T00:00:00.000Z' })
    expect(isPresent(TOM, '2026-08-04', 'dinner', [deleted])).toBe(true)
  })

  it('does not confuse another night, another meal or another person', () => {
    const rows = [
      row({ id: 'a', date: '2026-08-05' }),
      row({ id: 'b', meal: 'lunch' }),
      row({ id: 'c', person_id: AMY })
    ]
    expect(isPresent(TOM, '2026-08-04', 'dinner', rows)).toBe(true)
  })
})

describe('presentPeople', () => {
  const people = [person(TOM), person(AMY)]

  it('returns everybody when the roster is empty', () => {
    expect(presentPeople(people, [], '2026-08-04', 'dinner').map(p => p.id)).toEqual([TOM, AMY])
  })

  it('drops whoever is marked away that night', () => {
    const present = presentPeople(people, [row()], '2026-08-04', 'dinner')
    expect(present.map(p => p.id)).toEqual([AMY])
  })

  it('drops soft-deleted people whatever the roster says', () => {
    const withGone = [...people, person('44444444-4444-4444-8444-444444444444', true)]
    expect(presentPeople(withGone, [], '2026-08-04', 'dinner')).toHaveLength(2)
  })

  it('counts a person the roster has never mentioned', () => {
    // A baby added today is present this week without anybody touching a toggle.
    const baby = person('55555555-5555-4555-8555-555555555555')
    const present = presentPeople([...people, baby], [row()], '2026-08-04', 'dinner')
    expect(present.map(p => p.id)).toEqual([AMY, baby.id])
  })
})

describe('awayPeople', () => {
  it('is empty when everybody is home', () => {
    expect(awayPeople([person(TOM), person(AMY)], [], '2026-08-04', 'dinner')).toEqual([])
  })

  it('names only who is out', () => {
    const away = awayPeople([person(TOM), person(AMY)], [row()], '2026-08-04', 'dinner')
    expect(away.map(p => p.id)).toEqual([TOM])
  })
})

describe('attendanceId', () => {
  it('is the same on two devices for the same cell', () => {
    // Two phones toggling the same Tuesday must upsert one row, not two.
    expect(attendanceId(HOUSEHOLD, TOM, '2026-08-04', 'dinner'))
      .toBe(attendanceId(HOUSEHOLD, TOM, '2026-08-04', 'dinner'))
  })

  it('differs by person, date and meal', () => {
    const base = attendanceId(HOUSEHOLD, TOM, '2026-08-04', 'dinner')
    expect(attendanceId(HOUSEHOLD, AMY, '2026-08-04', 'dinner')).not.toBe(base)
    expect(attendanceId(HOUSEHOLD, TOM, '2026-08-05', 'dinner')).not.toBe(base)
    expect(attendanceId(HOUSEHOLD, TOM, '2026-08-04', 'lunch')).not.toBe(base)
  })

  it('is a v5 uuid', () => {
    expect(attendanceId(HOUSEHOLD, TOM, '2026-08-04', 'dinner'))
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('constraintId', () => {
  it('ignores case and spacing in the tag', () => {
    expect(constraintId(HOUSEHOLD, TOM, 'allergy', '  Peanut  '))
      .toBe(constraintId(HOUSEHOLD, TOM, 'allergy', 'peanut'))
  })

  it('keeps an allergy and a dislike of the same thing apart', () => {
    expect(constraintId(HOUSEHOLD, TOM, 'allergy', 'peanut'))
      .not.toBe(constraintId(HOUSEHOLD, TOM, 'dislike', 'peanut'))
  })
})

describe('normaliseTag', () => {
  it('collapses whitespace and case', () => {
    expect(normaliseTag('  Chopped   Tomatoes ')).toBe('chopped tomatoes')
  })
})

describe('isHardConstraint', () => {
  it('separates what must be obeyed from what merely costs points', () => {
    expect(isHardConstraint('allergy')).toBe(true)
    expect(isHardConstraint('intolerance')).toBe(true)
    expect(isHardConstraint('dislike')).toBe(false)
    expect(isHardConstraint('preference')).toBe(false)
  })
})
