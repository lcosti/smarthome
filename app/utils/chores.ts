/**
 * Chores, and how a rule becomes a row on today's card.
 *
 * Nothing here is stored per day. A weekly chore is one row saying "Tuesdays",
 * and every Tuesday it will ever have is worked out at read time — which is what
 * keeps it working on a tablet that has been in airplane mode for a fortnight,
 * with no job minting occurrences forward and nothing to catch up on. The same
 * goes for "every other Tuesday" and "first Sunday of the month": more to say in
 * the row, nothing more to store per day.
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
import { dayLabel } from './week'

/**
 * Which shape a chore's rule is.
 *
 * Fortnightly is not one of these: "every other Tuesday" is a weekly rule with
 * `week_interval` 2, because it answers every question a weekly rule does and
 * one more. Splitting it out would mean two branches saying the same thing about
 * weekdays, and a chore that changed its mind about how often would change kind.
 */
export type ChoreRule = 'weekly' | 'monthly' | 'once'

export interface ChoreLike {
  id: string
  name: string
  person_id: string | null
  /**
   * Which shape this chore is. Optional here, and absent means "work it out from
   * the columns" — rows written before 20260810000002_chore_recurrence.sql, and
   * any older tab still writing them, only ever had the two original shapes.
   */
  rule?: string | null
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. Null or empty for a one-off. */
  weekdays: number[] | null
  /** Weeks between occurrences. Null or 1 is every week, 2 is every other week. */
  week_interval?: number | null
  /** 'YYYY-MM-DD'. The week an every-other-week rule starts in, and its phase. */
  anchor_date?: string | null
  /** Day of the month, 1-31, clamped to the month's last day. */
  month_day?: number | null
  /** Which occurrence of `month_weekday` in the month: 1-4, or -1 for the last. */
  month_week?: number | null
  /** ISO weekday paired with `month_week`. */
  month_weekday?: number | null
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

/** The parts of a 'YYYY-MM-DD' string, as numbers. */
function dateParts(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number)
  return [year ?? 1970, month ?? 1, day ?? 1]
}

/** Days since the epoch. Whole days only, and so safe to subtract and divide. */
function epochDay(date: string): number {
  const [year, month, day] = dateParts(date)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

/** The epoch day of the Monday of this date's week. */
function mondayEpochDay(date: string): number {
  return epochDay(date) - (isoWeekday(date) - 1)
}

/** How many days a month has, February included. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Which shape a row is, without trusting it to say so.
 *
 * Every row written before the recurrence migration has no `rule`, and which of
 * the two original shapes it was has always been readable off `due_date`. That
 * reading is the fallback, so an unmigrated library behaves exactly as it did.
 */
export function choreRule(chore: ChoreLike): ChoreRule {
  if (chore.rule === 'weekly' || chore.rule === 'monthly' || chore.rule === 'once') return chore.rule
  return chore.due_date ? 'once' : 'weekly'
}

/**
 * A weekly rule, at whatever interval.
 *
 * Every week is the common case and asks nothing of the anchor. At a longer
 * interval the anchor's Monday is the phase: the date's week has to be a whole
 * number of intervals after it, and never before it, so "starting today" means
 * what it says rather than back-dating a fortnight through the whole year.
 *
 * An interval with no anchor falls back to every week. It cannot come from the
 * editor, and of the two ways to be wrong about a chore, showing it too often is
 * the one somebody notices.
 */
function occursWeekly(chore: ChoreLike, date: string): boolean {
  if (!chore.weekdays?.length) return false
  if (!chore.weekdays.includes(isoWeekday(date))) return false

  const interval = chore.week_interval ?? 1
  if (interval <= 1 || !chore.anchor_date) return true

  const weeks = (mondayEpochDay(date) - mondayEpochDay(chore.anchor_date)) / 7
  return weeks >= 0 && weeks % interval === 0
}

/**
 * A monthly rule, either by date or by ordinal weekday.
 *
 * A day past the end of a short month falls back to that month's last day: the
 * 31st is 28 February, because "every month" means every month and a chore that
 * quietly skipped a third of the year would be worse than a day out.
 *
 * The ordinal form needs no such clamp — the editor offers first to fourth and
 * last, so "the fifth Monday" is not a thing anybody can ask for.
 */
function occursMonthly(chore: ChoreLike, date: string): boolean {
  const [year, month, day] = dateParts(date)

  if (chore.month_day) return day === Math.min(chore.month_day, daysInMonth(year, month))

  if (!chore.month_week || !chore.month_weekday) return false
  if (isoWeekday(date) !== chore.month_weekday) return false
  if (chore.month_week === -1) return day + 7 > daysInMonth(year, month)
  return Math.floor((day - 1) / 7) + 1 === chore.month_week
}

/** Whether a chore's rule puts it on this date at all. */
function occursOn(chore: ChoreLike, date: string): boolean {
  switch (choreRule(chore)) {
    case 'once': return chore.due_date === date
    case 'monthly': return occursMonthly(chore, date)
    default: return occursWeekly(chore, date)
  }
}

/** Monday first, as the week is read everywhere else in the app. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "First", "Second", "Third", "Fourth" — the editor offers these and "Last". */
export const ORDINAL_LABELS = ['First', 'Second', 'Third', 'Fourth']

/** "1st", "22nd", "31st". */
export function ordinalDay(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13
    ? 'th'
    : ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'
  return `${day}${suffix}`
}

/**
 * A rule, said out loud: "Tue, Fri", "Every other Tue", "First Sun of the
 * month", "Sat 15 Aug".
 *
 * One function rather than a branch wherever a chore is listed. There is one
 * reader today — the settings list — and it built this phrase inline back when a
 * chore was two shapes and the phrase was one line. Four shapes is where that
 * stops being a line worth copying.
 */
export function choreScheduleLabel(chore: ChoreLike): string {
  switch (choreRule(chore)) {
    case 'once':
      return chore.due_date ? dayLabel(chore.due_date) : ''

    case 'monthly': {
      if (chore.month_day) return `${ordinalDay(chore.month_day)} of the month`
      if (!chore.month_week || !chore.month_weekday) return ''
      const which = chore.month_week === -1 ? 'Last' : ORDINAL_LABELS[chore.month_week - 1] ?? ''
      return `${which} ${WEEKDAY_LABELS[chore.month_weekday - 1]} of the month`
    }

    default: {
      if (!chore.weekdays?.length) return ''
      const days = chore.weekdays.map(day => WEEKDAY_LABELS[day - 1]).join(', ')
      return (chore.week_interval ?? 1) > 1 ? `Every other ${days}` : days
    }
  }
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
