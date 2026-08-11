import { deriveLifeStage } from './people'

/**
 * Who can be at the stove, and who is by default.
 *
 * Cooking is an adult's job: the picker offers adults only, and life stage is
 * derived from the birth date on the day in question, never stored — the same
 * rule as everywhere else, so a child starts being offered dinner duty on the
 * right birthday with nobody editing anything.
 *
 * The default is derived rather than written, on the pattern of life stage
 * itself: a night whose `cook_person_id` is null and whose table has exactly
 * one adult at it is that adult's to cook, and the answer follows the roster —
 * mark the other adult away after the week is planned and the night reassigns
 * itself, with no write to go stale. An explicit choice always wins.
 */

/** The one fact this file reads off a person; structural, as PersonLike is. */
export interface CookLike {
  date_of_birth: string | null
}

/** The people old enough to be handed the stove, as of the given day. */
export function adultsAmong<T extends CookLike>(people: T[], onDate: string): T[] {
  return people.filter(person => deriveLifeStage(person.date_of_birth, onDate) === 'adult')
}

/**
 * The cook nobody had to pick: the sole adult at the table, or null.
 *
 * Takes who is *present* — the roster's answer for the date — not the whole
 * household. Two adults home is a decision still to make; none is a night with
 * no default worth claiming.
 */
export function defaultCook<T extends CookLike>(present: T[], onDate: string): T | null {
  const adults = adultsAmong(present, onDate)
  return adults.length === 1 ? adults[0]! : null
}
