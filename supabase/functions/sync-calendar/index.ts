// Keeps a local copy of the family's Google Calendar, so the wall board can show
// today's schedule — including with the wifi down.
//
// Called by pg_cron every five minutes (see the migration that creates the job).
// It holds a service account key and the service role, so it is guarded by a
// shared secret rather than a user JWT: pg_cron has no session to present.
//
// Everything it writes is derived from what Google says. That makes a stray
// invocation harmless — worst case it does the same work twice and writes
// nothing the second time.
//
// Local trial, with no Google account:
//   echo 'GOOGLE_CALENDAR_MOCK=1' >> supabase/functions/.env
//   supabase functions serve sync-calendar --env-file supabase/functions/.env
//   curl -X POST http://127.0.0.1:54321/functions/v1/sync-calendar
//   # run it twice: the second run soft-deletes the event the fixtures drop

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  changedRows,
  resolvePersonId,
  toRows,
  vanishedIds,
  type CalendarRow,
  type GoogleEvent
} from '../_shared/calendar-events.ts'
import { fetchEvents, getAccessToken, parseServiceAccount } from '../_shared/google-auth.ts'
import { guardMethod, json } from '../_shared/http.ts'
import { mockEvents } from './fixtures.ts'

/** One calendar, and whose it is. `person` is a name from the people table. */
interface CalendarConfig {
  calendarId: string
  person?: string | null
}

/** Yesterday through next week: everything the board can currently ask about. */
const WINDOW_DAYS_BACK = 1
const WINDOW_DAYS_FORWARD = 8

/**
 * How long a row that has left the window is kept.
 *
 * Long enough that a device switched off for a fortnight still learns about a
 * cancellation through the ordinary soft-delete path when it comes back, rather
 * than keeping a ghost event forever because the row vanished while it was away.
 */
const RETENTION_DAYS = 30

function isoDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

Deno.serve(async (req) => {
  const guard = guardMethod(req)
  if (guard) return guard

  // Unset locally, where the function is only reachable from the machine it runs
  // on. Set in production, where the whole internet can see the URL.
  const expected = Deno.env.get('SYNC_SECRET')
  if (expected && req.headers.get('x-sync-secret') !== expected) {
    return json(401, { error: 'bad or missing x-sync-secret' })
  }

  const timeZone = Deno.env.get('HOUSEHOLD_TZ') ?? 'Europe/London'
  const mock = Deno.env.get('GOOGLE_CALENDAR_MOCK') === '1'

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // One household in practice, but resolved rather than assumed — same approach
  // as the keepalive ping, and it keeps a second household from being a rewrite.
  let householdId = Deno.env.get('HOUSEHOLD_ID') ?? null
  if (!householdId) {
    const { data, error } = await client
      .from('households')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) return json(500, { error: `household lookup failed: ${error.message}` })
    if (!data) return json(200, { skipped: 'no household yet' })
    householdId = data.id
  }

  const { data: people, error: peopleError } = await client
    .from('people')
    .select('id, name')
    .eq('household_id', householdId)
    .is('deleted_at', null)
  if (peopleError) return json(500, { error: `people lookup failed: ${peopleError.message}` })

  let calendars: CalendarConfig[]
  try {
    calendars = mock
      ? [{ calendarId: 'mock', person: people?.[0]?.name ?? null }]
      : JSON.parse(Deno.env.get('GOOGLE_CALENDARS') ?? '[]') as CalendarConfig[]
  } catch {
    return json(500, { error: 'GOOGLE_CALENDARS is not valid JSON' })
  }
  // A household that has not connected a calendar is not an error. The board
  // simply has an empty schedule card, which is a designed state.
  if (!calendars.length) return json(200, { skipped: 'no calendars configured' })

  const now = new Date()
  const nowIso = now.toISOString()
  const timeMin = new Date(now)
  timeMin.setDate(timeMin.getDate() - WINDOW_DAYS_BACK)
  const timeMax = new Date(now)
  timeMax.setDate(timeMax.getDate() + WINDOW_DAYS_FORWARD)

  // --- fetch and map --------------------------------------------------------

  let token: string | null = null
  if (!mock) {
    const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT')
    if (!raw) return json(500, { error: 'GOOGLE_SERVICE_ACCOUNT is not set' })
    try {
      token = await getAccessToken(parseServiceAccount(raw))
    } catch (error) {
      return json(500, { error: `google auth failed: ${(error as Error).message}` })
    }
  }

  const rows: CalendarRow[] = []
  for (const calendar of calendars) {
    let events: GoogleEvent[]
    try {
      events = mock
        ? mockEvents(now, Number(new URL(req.url).searchParams.get('run') ?? '1'))
        : await fetchEvents(token!, calendar.calendarId, timeMin, timeMax) as GoogleEvent[]
    } catch (error) {
      // One calendar failing must not lose the others. The board keeps whatever
      // it already had for this one, which is exactly the offline story.
      console.error('calendar fetch failed', calendar.calendarId, (error as Error).message)
      continue
    }

    rows.push(...await toRows(events, {
      householdId,
      calendarId: calendar.calendarId,
      personId: resolvePersonId(calendar.person, people ?? []),
      timeZone,
      now: nowIso
    }))
  }

  // --- write only what changed ----------------------------------------------

  const windowStart = isoDay(timeMin, timeZone)
  const windowEnd = isoDay(timeMax, timeZone)

  const { data: existingRows, error: existingError } = await client
    .from('calendar_events')
    .select('id, google_updated_at, deleted_at')
    .eq('household_id', householdId)
    .gte('start_date', windowStart)
    .lte('start_date', windowEnd)
  if (existingError) return json(500, { error: `read failed: ${existingError.message}` })

  const existing = new Map(
    (existingRows ?? []).map(row => [row.id, {
      google_updated_at: row.google_updated_at,
      deleted_at: row.deleted_at
    }])
  )

  const changed = changedRows(rows, existing)
  if (changed.length) {
    // created_at must not be reset on a row that already exists.
    const payload = changed.map(row =>
      existing.has(row.id) ? { ...row, created_at: undefined } : row
    )
    const { error } = await client.from('calendar_events').upsert(payload)
    if (error) return json(500, { error: `upsert failed: ${error.message}` })
  }

  const vanished = vanishedIds(rows, existing)
  if (vanished.length) {
    const { error } = await client
      .from('calendar_events')
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .in('id', vanished)
    if (error) return json(500, { error: `soft delete failed: ${error.message}` })
  }

  // --- retention ------------------------------------------------------------

  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
  const { error: pruneError } = await client
    .from('calendar_events')
    .delete()
    .eq('household_id', householdId)
    .lt('end_date', isoDay(cutoff, timeZone))
  if (pruneError) console.error('retention prune failed', pruneError.message)

  return json(200, {
    fetched: rows.length,
    written: changed.length,
    removed: vanished.length,
    mock
  })
})
