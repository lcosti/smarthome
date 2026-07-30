/**
 * Life stage, worked out from a date of birth every time it is asked for.
 *
 * Nothing stores the label. The baby ages up on its own and nobody edits a
 * config, which is the whole point: a household that wrote "weaning" down in
 * March would still be pureeing carrots for a toddler in December.
 *
 * Dates are 'YYYY-MM-DD' strings compared as calendar dates, in the same spirit
 * as week.ts — no Date arithmetic, no timezones, no chance of a birthday landing
 * a day early west of Greenwich.
 */

/**
 * 'baby' is not in the original four. It is here because the generator has to be
 * able to say "nothing on a plate for this one yet", and a three-month-old is a
 * genuinely different case from a six-month-old learning to eat.
 */
export type LifeStage = 'baby' | 'weaning' | 'toddler' | 'child' | 'adult'

/**
 * Where each stage begins, in whole months since birth. Editable — these are a
 * reasonable reading of how feeding actually changes, not anything official.
 *
 * Solids start around six months; a first birthday ends purees; three is when a
 * child eats a smaller version of the family meal rather than an adapted one;
 * thirteen is when the portion stops being smaller at all.
 */
export const STAGE_FROM_MONTHS = {
  weaning: 6,
  toddler: 12,
  child: 36,
  adult: 156
} as const

/** Y, M and D of a 'YYYY-MM-DD' string. */
function parts(iso: string): [number, number, number] {
  const [year, month, day] = iso.split('-').map(Number)
  return [year ?? 0, month ?? 0, day ?? 0]
}

/**
 * Whole months from `from` to `to`, as a person would count them: the count only
 * goes up on the day-of-month it went up on at birth.
 *
 * A 29 February birth date has no anniversary in most years, so by this
 * arithmetic it falls on 1 March — the ordinary convention, and the kind one,
 * since the alternative is a child who is briefly a month younger than they were
 * the day before.
 */
function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = parts(from)
  const [toYear, toMonth, toDay] = parts(to)
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth)
  return toDay < fromDay ? months - 1 : months
}

/**
 * The stage a person is at on a given date.
 *
 * A null date of birth means adult. Every row written before this existed belongs
 * to somebody who signed in, and an unknown age is far likelier to be an adult
 * who never filled the field in than a baby.
 */
export function deriveLifeStage(dateOfBirth: string | null, onDate: string): LifeStage {
  if (!dateOfBirth) return 'adult'
  const months = monthsBetween(dateOfBirth, onDate)
  // A date of birth in the future is somebody mistyping, or a pregnancy entered
  // early. Either way the youngest stage is the safe answer.
  if (months < STAGE_FROM_MONTHS.weaning) return 'baby'
  if (months < STAGE_FROM_MONTHS.toddler) return 'weaning'
  if (months < STAGE_FROM_MONTHS.child) return 'toddler'
  if (months < STAGE_FROM_MONTHS.adult) return 'child'
  return 'adult'
}

/** How a stage is written where a person reads it. */
export const STAGE_LABEL: Record<LifeStage, string> = {
  baby: 'Baby',
  weaning: 'Weaning',
  toddler: 'Toddler',
  child: 'Child',
  adult: 'Adult'
}

/** Roughly "2y 4m", for showing next to a date of birth so a typo is obvious. */
export function ageLabel(dateOfBirth: string | null, onDate: string): string | null {
  if (!dateOfBirth) return null
  const months = monthsBetween(dateOfBirth, onDate)
  if (months < 0) return 'not born yet'
  if (months < 24) return `${months}m`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest === 0 ? `${years}y` : `${years}y ${rest}m`
}
