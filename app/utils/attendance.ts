/**
 * Who is home, and how that question is answered from very few rows.
 *
 * The contract, which everything here depends on: NO ROW MEANS PRESENT. A row
 * exists only once somebody has said otherwise, carrying `present: false`;
 * marking them back in is that row flipping to true, never a deletion.
 *
 * Absence is the exception — most nights everybody is home — so this keeps a
 * quiet week at zero writes, lets a newly added baby be counted before anybody
 * has touched the roster, and means next week already reads correctly. The cost
 * is that "present" and "never asked" are the same state, which is fine: they
 * lead to the same plan.
 *
 * Pure, and deliberately shaped for the generator, which will ask this same
 * question for seven nights in a row.
 */

import { ATTENDANCE_NAMESPACE, CONSTRAINT_NAMESPACE, uuidv5 } from './uuid5'

export interface AttendanceLike {
  id: string
  person_id: string
  date: string
  meal: string
  present: boolean
  deleted_at: string | null
}

export interface PersonLike {
  id: string
  deleted_at: string | null
}

/** The kinds of constraint, split by what the generator is allowed to do with them. */
export const HARD_CONSTRAINT_KINDS = ['allergy', 'intolerance'] as const
export const SOFT_CONSTRAINT_KINDS = ['dislike', 'preference'] as const
export const CONSTRAINT_KINDS = [...HARD_CONSTRAINT_KINDS, ...SOFT_CONSTRAINT_KINDS] as const

export type ConstraintKind = typeof CONSTRAINT_KINDS[number]

/** Hard kinds filter a recipe out; soft kinds only cost it points. */
export function isHardConstraint(kind: string): boolean {
  return (HARD_CONSTRAINT_KINDS as readonly string[]).includes(kind)
}

/**
 * The id a given roster cell always produces, so two devices toggling the same
 * night converge through the ordinary last-write-wins path.
 */
export function attendanceId(
  householdId: string,
  personId: string,
  date: string,
  meal: string
): string {
  return uuidv5(ATTENDANCE_NAMESPACE, `${householdId}:${personId}:${date}:${meal}`)
}

/** Same trick for a constraint, keyed on the normalised tag. */
export function constraintId(
  householdId: string,
  personId: string,
  kind: string,
  tag: string
): string {
  return uuidv5(CONSTRAINT_NAMESPACE, `${householdId}:${personId}:${kind}:${normaliseTag(tag)}`)
}

/** Tags are compared loosely and stored as typed, as ingredient names are. */
export function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Whether a person is expected at a given meal.
 *
 * A soft-deleted row counts as present: deleting the record of an absence is
 * saying the absence never happened.
 */
export function isPresent(
  personId: string,
  date: string,
  meal: string,
  rows: Iterable<AttendanceLike>
): boolean {
  for (const row of rows) {
    if (row.deleted_at) continue
    if (row.person_id !== personId || row.date !== date || row.meal !== meal) continue
    if (!row.present) return false
  }
  return true
}

/**
 * How many of these dates a person is eating here.
 *
 * The week's nights, not the nights somebody has already chosen a dinner for.
 * The roster's "2 of 7 nights" is a fact about the household's diary and must
 * not move when a meal is planned — counting only planned nights made an
 * unplanned week say "0 of 0" to everybody, including the person who is in for
 * two of them.
 */
export function nightsPresent(
  personId: string,
  dates: Iterable<string>,
  meal: string,
  rows: Iterable<AttendanceLike>
): number {
  const all = [...rows]
  let count = 0
  for (const date of dates) {
    if (isPresent(personId, date, meal, all)) count++
  }
  return count
}

/**
 * Everybody eating at a given meal, in the order they were given.
 *
 * This is the generator's entry point: hard-filter the library against these
 * people's allergies, then adapt a portion for each of their life stages.
 */
export function presentPeople<T extends PersonLike>(
  people: Iterable<T>,
  rows: Iterable<AttendanceLike>,
  date: string,
  meal: string
): T[] {
  const away = new Set<string>()
  for (const row of rows) {
    if (row.deleted_at || row.present) continue
    if (row.date !== date || row.meal !== meal) continue
    away.add(row.person_id)
  }
  return [...people].filter(person => !person.deleted_at && !away.has(person.id))
}

/** Just the names of who is out, for the one dim line on a plan night. */
export function awayPeople<T extends PersonLike>(
  people: Iterable<T>,
  rows: Iterable<AttendanceLike>,
  date: string,
  meal: string
): T[] {
  const present = new Set(presentPeople(people, rows, date, meal).map(person => person.id))
  return [...people].filter(person => !person.deleted_at && !present.has(person.id))
}
