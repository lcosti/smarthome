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
  syncOutcome,
  toRows,
  vanishedIds,
  type CalendarRow,
  type GoogleEvent,
  type SyncOutcome
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

/** A run that ended before it did any work, with the reason it stopped. */
function halted(outcome: 'skipped' | 'error', detail: string): SyncOutcome {
  return { outcome, detail, fetched: 0, written: 0, removed: 0, calendars_failed: 0 }
}

/**
 * Record what this run did, then answer.
 *
 * Every exit below runs through here, because the failure this whole table exists
 * to fix was a function that returned a perfectly clear 500 to pg_cron, which threw
 * it away. The response body is for whoever is holding a curl; the row is for the
 * household.
 *
 * A write failure here is swallowed on purpose: it must not turn a successful sync
 * into a 500, and there is nowhere left to report it to anyway.
 */
async function finish(
  // deno-lint-ignore no-explicit-any
  client: any,
  householdId: string,
  status: SyncOutcome,
  ranAt: string
): Promise<Response> {
  const { error } = await client
    .from('calendar_sync_status')
    .upsert({ household_id: householdId, ran_at: ranAt, updated_at: ranAt, ...status },
      { onConflict: 'household_id' })
  if (error) console.error('sync status write failed', error.message)
  return json(status.outcome === 'error' ? 500 : 200, status)
}

Deno.serve(async (req) => {
  const guard = guardMethod(req)
  if (guard) return guard

  // This function runs as the service role and verify_jwt is off, so the shared
  // secret is the only thing standing between it and the whole internet. Fail
  // closed: an unset secret has to be an outage rather than an open door, or
  // forgetting to set it in production silently publishes the service role.
  // Serving locally therefore needs it too — see supabase/functions/.env.example.
  const expected = Deno.env.get('SYNC_SECRET')
  if (!expected) return json(500, { error: 'SYNC_SECRET is not configured' })
  if (req.headers.get('x-sync-secret') !== expected) {
    return json(401, { error: 'bad or missing x-sync-secret' })
  }

  const timeZone = Deno.env.get('HOUSEHOLD_TZ') ?? 'Europe/London'
  const mock = Deno.env.get('GOOGLE_CALENDAR_MOCK') === '1'

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const now = new Date()
  const nowIso = now.toISOString()

  // One household in practice, but resolved rather than assumed — same approach
  // as the keepalive ping, and it keeps a second household from being a rewrite.
  //
  // Nothing above this point can leave a status row: there is no household to hang
  // one off yet. Those two failures stay response-only, which is tolerable because
  // both are visible the moment anyone calls the function by hand.
  const configured = Deno.env.get('HOUSEHOLD_ID')
  let householdId: string
  if (configured) {
    householdId = configured
  } else {
    const { data, error } = await client
      .from('households')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) return json(500, { error: `household lookup failed: ${error.message}` })
    if (!data) return json(200, { skipped: 'no household yet' })
    householdId = data.id as string
  }

  const { data: people, error: peopleError } = await client
    .from('people')
    .select('id, name')
    .eq('household_id', householdId)
    .is('deleted_at', null)
  if (peopleError) {
    return await finish(client, householdId, halted(
      'error', `people lookup failed: ${peopleError.message}`), nowIso)
  }

  let calendars: CalendarConfig[]
  try {
    calendars = mock
      ? [{ calendarId: 'mock', person: people?.[0]?.name ?? null }]
      : JSON.parse(Deno.env.get('GOOGLE_CALENDARS') ?? '[]') as CalendarConfig[]
  } catch {
    return await finish(client, householdId, halted(
      'error', 'The GOOGLE_CALENDARS function secret is not valid JSON.'), nowIso)
  }
  // A household that has not connected a calendar is not an error. The board
  // simply has an empty schedule card, which is a designed state — but it is now a
  // recorded one, so the screen can say "no calendars configured" rather than
  // leaving the reader to guess between that and four different breakages.
  if (!calendars.length) {
    return await finish(client, householdId, halted(
      'skipped',
      'No calendars are configured. Set the GOOGLE_CALENDARS function secret to '
      + 'connect one.'), nowIso)
  }

  const timeMin = new Date(now)
  timeMin.setDate(timeMin.getDate() - WINDOW_DAYS_BACK)
  const timeMax = new Date(now)
  timeMax.setDate(timeMax.getDate() + WINDOW_DAYS_FORWARD)

  // --- fetch and map --------------------------------------------------------

  let token: string | null = null
  if (!mock) {
    const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT')
    if (!raw) {
      return await finish(client, householdId, halted(
        'error', 'The GOOGLE_SERVICE_ACCOUNT function secret is not set.'), nowIso)
    }
    try {
      token = await getAccessToken(parseServiceAccount(raw))
    } catch (error) {
      return await finish(client, householdId, halted(
        'error', `Google would not authenticate: ${(error as Error).message}`), nowIso)
    }
  }

  // What went wrong, per calendar, kept rather than only logged. A 403 here is the
  // single most likely reason a correctly configured household still sees nothing:
  // the calendar was never shared with the service account's address.
  const problems: string[] = []
  const rows: CalendarRow[] = []
  for (const calendar of calendars) {
    let events: GoogleEvent[]
    try {
      events = mock
        ? mockEvents(now, Number(new URL(req.url).searchParams.get('run') ?? '1'))
        : await fetchEvents(token!, calendar.calendarId, timeMin, timeMax) as GoogleEvent[]
    } catch (error) {
      // One calendar failing must not lose the others. The board keeps whatever
      // it already had for this one, which is exactly the offline story — but the
      // run is no longer a success, and the household is told which calendar.
      const message = (error as Error).message
      console.error('calendar fetch failed', calendar.calendarId, message)
      problems.push(`${calendar.calendarId}: ${message}`)
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
  if (existingError) {
    return await finish(client, householdId, halted(
      'error', `read failed: ${existingError.message}`), nowIso)
  }

  const existing = new Map(
    (existingRows ?? []).map(row => [row.id, {
      google_updated_at: row.google_updated_at,
      deleted_at: row.deleted_at
    }])
  )

  const changed = changedRows(rows, existing)
  if (changed.length) {
    // Rows never carry created_at: the column default covers inserts, and the
    // conflict update leaves the existing value alone. Sending it on some rows
    // but not others would make PostgREST null-fill the gaps across the batch.
    const { error } = await client.from('calendar_events').upsert(changed)
    if (error) {
      return await finish(client, householdId, halted(
        'error', `upsert failed: ${error.message}`), nowIso)
    }
  }

  const vanished = vanishedIds(rows, existing)
  if (vanished.length) {
    const { error } = await client
      .from('calendar_events')
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .in('id', vanished)
    if (error) {
      return await finish(client, householdId, halted(
        'error', `soft delete failed: ${error.message}`), nowIso)
    }
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

  return await finish(client, householdId, syncOutcome({
    fetched: rows.length,
    written: changed.length,
    removed: vanished.length
  }, problems), nowIso)
})
