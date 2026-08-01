/**
 * Chores, and how a rule becomes a row on today's card.
 *
 * Nothing here is stored per day. A weekly chore is one row saying "Tuesdays",
 * and every Tuesday it will ever have is worked out at read time — which is what
 * keeps it working on a tablet that has been in airplane mode for a fortnight,
 * with no job minting occurrences forward and nothing to catch up on.
 *
 * The tick is the only fact a day produces, and it follows the attendance
 * contract exactly: NO ROW MEANS NOT DONE, unticking writes `done: false`, and
 * the id is derived from (household, chore, date) so two people at the board
 * land on one row.
 *
 * Pure, and shaped so the board can ask it the same question for two days
 * running.
 */

import { CHORE_COMPLETION_NAMESPACE, uuidv5 } from './uuid5'

export interface ChoreLike {
  id: string
  name: string
  person_id: string | null
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. Null or empty for a one-off. */
  weekdays: number[] | null
  /** 'YYYY-MM-DD' for a one-off, null for a weekly rule. */
  due_date: string | null
  /** 'HH:MM', or null for a chore with no particular time. */
  at_time: string | null
  deleted_at: string | null
}

export interface ChoreCompletionLike {
  id: string
  chore_id: string
  date: string
  done: boolean
  deleted_at: string | null
}

/** One chore on one day, ready for the schedule to place it. */
export interface ChoreOccurrence {
  choreId: string
  /** The completion row's id, which is also this row's identity on the card. */
  completionId: string
  date: string
  title: string
  personId: string | null
  /** 'HH:MM', or null to mean "some time today". */
  time: string | null
  done: boolean
}

export function choreCompletionId(householdId: string, choreId: string, date: string): string {
  return uuidv5(CHORE_COMPLETION_NAMESPACE, `${householdId}:${choreId}:${date}`)
}

/**
 * ISO weekday of a 'YYYY-MM-DD' string, 1 = Monday .. 7 = Sunday.
 *
 * Built through `Date.UTC` on the parts rather than parsed as a local date: a
 * date string is a calendar fact with no instant behind it, and going via local
 * midnight is what makes the answer wrong on the two mornings a year the clocks
 * move.
 */
export function isoWeekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay()
  // getUTCDay is 0 = Sunday; ISO puts Sunday last.
  return weekday === 0 ? 7 : weekday
}

/** Whether a chore's rule puts it on this date at all. */
function occursOn(chore: ChoreLike, date: string): boolean {
  if (chore.weekdays?.length) return chore.weekdays.includes(isoWeekday(date))
  return chore.due_date === date
}

/**
 * Every chore falling on one day, with its tick already resolved.
 *
 * A one-off shows only on its own date. It does not carry forward when it is
 * missed, which is a decision rather than an omission: a board that accumulates
 * everything nobody got round to stops being today's board.
 */
export function choreOccurrencesOn(
  date: string,
  chores: ChoreLike[],
  completions: ChoreCompletionLike[],
  householdId: string
): ChoreOccurrence[] {
  const done = new Set(
    completions
      .filter(row => !row.deleted_at && row.done && row.date === date)
      .map(row => row.chore_id)
  )

  return chores
    .filter(chore => !chore.deleted_at && occursOn(chore, date))
    .map(chore => ({
      choreId: chore.id,
      completionId: choreCompletionId(householdId, chore.id, date),
      date,
      title: chore.name,
      personId: chore.person_id,
      time: chore.at_time,
      done: done.has(chore.id)
    }))
    // Untimed first, then by the clock, then by name — a stable order before the
    // board sorts the whole day, so two chores at 09:00 never swap places
    // between renders.
    .sort((a, b) =>
      (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title)
    )
}
