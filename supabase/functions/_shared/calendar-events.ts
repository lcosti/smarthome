/**
 * Turning Google Calendar events into rows this household's board can render.
 *
 * Pure, and importing nothing but the uuid helper, so vitest can exercise it
 * from tests/ without a Deno runtime, a network, or a Google account — the same
 * arrangement _shared/jsonld.ts has.
 *
 * The hard part is not the shape of the JSON, it is deciding which household day
 * an event belongs to. Google answers in UTC instants or in bare dates; the
 * board asks "what is on today", and today is a local thing. That conversion
 * happens once, here, and the answer is stored on the row so nothing downstream
 * has to guess.
 */

import { CALENDAR_NAMESPACE, uuidv5 } from './uuid5.ts'

/** The subset of Google's event resource this app looks at. */
export interface GoogleEvent {
  id?: string
  status?: string
  summary?: string
  updated?: string
  start?: { date?: string, dateTime?: string }
  end?: { date?: string, dateTime?: string }
}

export interface CalendarRow {
  id: string
  household_id: string
  person_id: string | null
  calendar_id: string
  google_event_id: string
  title: string
  all_day: boolean
  starts_at: string
  ends_at: string
  start_date: string
  end_date: string
  google_updated_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface MapOptions {
  householdId: string
  calendarId: string
  personId: string | null
  timeZone: string
  now: string
}

/**
 * The local calendar date of an instant, in a named zone.
 *
 * Via Intl rather than by adding an offset, because the offset is not a
 * constant: an event at 00:30 on the last Sunday in October is on a different
 * date depending on which side of the clock change it falls, and only the zone
 * database knows which.
 */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(instant)
  // en-CA formats as YYYY-MM-DD, which is the format this app stores dates in.
  return parts
}

/** The day after a 'YYYY-MM-DD', without going near a Date and its timezone. */
export function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1))
  return next.toISOString().slice(0, 10)
}

/**
 * One Google event as a row, or null if it is not something to show.
 *
 * Cancelled events are dropped rather than mapped: the caller learns they are
 * gone from their absence, and soft-deletes whatever it already had for them,
 * which is the same path an event silently removed from the calendar takes.
 */
export async function toRow(
  event: GoogleEvent,
  options: MapOptions
): Promise<CalendarRow | null> {
  if (!event.id || event.status === 'cancelled') return null

  const allDay = Boolean(event.start?.date)
  const startRaw = event.start?.date ?? event.start?.dateTime
  if (!startRaw) return null
  const endRaw = event.end?.date ?? event.end?.dateTime ?? startRaw

  let startDate: string
  let endDate: string
  let startsAt: Date
  let endsAt: Date

  if (allDay) {
    // Bare dates, already half-open the way the board wants them. The instants
    // are derived for completeness rather than used for placement, so a DST
    // shift in them cannot move the event to another day.
    startDate = startRaw
    endDate = endRaw > startRaw ? endRaw : nextDate(startRaw)
    startsAt = new Date(`${startRaw}T00:00:00Z`)
    endsAt = new Date(`${endDate}T00:00:00Z`)
  } else {
    startsAt = new Date(startRaw)
    endsAt = new Date(endRaw)
    if (Number.isNaN(startsAt.getTime())) return null
    if (Number.isNaN(endsAt.getTime())) endsAt = startsAt
    startDate = localDate(startsAt, options.timeZone)
    // A timed event belongs to the day it starts, even when it runs past
    // midnight — 23:30 on Thursday is Thursday's, to everybody in the house.
    endDate = startDate
  }

  return {
    id: await uuidv5(CALENDAR_NAMESPACE, `${options.calendarId}:${event.id}`),
    household_id: options.householdId,
    person_id: options.personId,
    calendar_id: options.calendarId,
    google_event_id: event.id,
    title: event.summary?.trim() || 'Busy',
    all_day: allDay,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    start_date: startDate,
    end_date: endDate,
    google_updated_at: event.updated ?? null,
    deleted_at: null,
    created_at: options.now,
    updated_at: options.now
  }
}

/** Every event on one calendar, as rows, skipping the ones worth skipping. */
export async function toRows(
  events: GoogleEvent[],
  options: MapOptions
): Promise<CalendarRow[]> {
  const rows: CalendarRow[] = []
  for (const event of events) {
    const row = await toRow(event, options)
    if (row) rows.push(row)
  }
  return rows
}

/**
 * Which rows actually need writing.
 *
 * Google's own `updated` stamp is the comparison, so a run that finds nothing
 * new writes nothing at all. That matters more than it looks: every write is
 * broadcast over realtime to every device, and a five-minute sync that rewrote
 * every event would be a steady drip of traffic saying nothing changed.
 */
export function changedRows(
  rows: CalendarRow[],
  existing: Map<string, { google_updated_at: string | null, deleted_at: string | null }>
): CalendarRow[] {
  return rows.filter((row) => {
    const previous = existing.get(row.id)
    if (!previous) return true
    // A row that had been soft-deleted and has come back must be written even if
    // Google considers it unchanged.
    if (previous.deleted_at) return true
    return previous.google_updated_at !== row.google_updated_at
  })
}

/**
 * The ids we hold for this window that Google no longer returns.
 *
 * These are cancellations and deletions. They are soft-deleted rather than
 * removed, so that devices learn about them through the ordinary row-update path
 * instead of having to notice something missing.
 */
export function vanishedIds(
  fetched: CalendarRow[],
  existing: Map<string, { google_updated_at: string | null, deleted_at: string | null }>
): string[] {
  const seen = new Set(fetched.map(row => row.id))
  return [...existing.entries()]
    .filter(([id, row]) => !seen.has(id) && !row.deleted_at)
    .map(([id]) => id)
}

/** What a sync run is reporting back to the household. */
export interface SyncOutcome {
  outcome: 'ok' | 'skipped' | 'error'
  detail: string | null
  fetched: number
  written: number
  removed: number
  calendars_failed: number
}

/**
 * Turn the result of a run into the row the settings page reads.
 *
 * Pure, and separate from the function, because this is the part with a decision
 * in it: a run where one calendar of three threw is not a success. The board is
 * showing a day with a third of it missing, and the whole point of the status row
 * is that it says so rather than looking identical to a quiet Tuesday.
 */
export function syncOutcome(
  counts: { fetched: number, written: number, removed: number },
  problems: string[]
): SyncOutcome {
  return {
    outcome: problems.length ? 'error' : 'ok',
    detail: problems.length ? problems.join('; ') : null,
    ...counts,
    calendars_failed: problems.length
  }
}

/** Match a configured calendar to a person by name, forgiving case and spacing. */
export function resolvePersonId(
  name: string | null | undefined,
  people: { id: string, name: string }[]
): string | null {
  if (!name) return null
  const wanted = name.trim().toLowerCase()
  return people.find(person => person.name.trim().toLowerCase() === wanted)?.id ?? null
}
