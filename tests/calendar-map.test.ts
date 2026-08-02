import { describe, expect, it } from 'vitest'
import { uuidv5 as appUuidv5, DERIVE_NAMESPACE } from '../app/utils/uuid5'
import {
  changedRows,
  localDate,
  nextDate,
  resolvePersonId,
  syncOutcome,
  toRow,
  toRows,
  vanishedIds,
  type CalendarRow,
  type GoogleEvent
} from '../supabase/functions/_shared/calendar-events'
import { CALENDAR_NAMESPACE, uuidv5 } from '../supabase/functions/_shared/uuid5'

const OPTIONS = {
  householdId: 'household-1',
  calendarId: 'family@group.calendar.google.com',
  personId: null,
  timeZone: 'Europe/London',
  now: '2026-07-30T16:00:00.000Z'
}

describe('uuidv5, edge-function copy', () => {
  it('agrees with the app\'s implementation', async () => {
    // If these ever diverge, every calendar row is minted under two ids and the
    // board shows each of today's events twice.
    for (const name of ['a', 'family:abc123', 'a much longer name with spaces', '']) {
      expect(await uuidv5(DERIVE_NAMESPACE, name)).toBe(appUuidv5(DERIVE_NAMESPACE, name))
    }
  })

  it('produces a well-formed v5 uuid', async () => {
    const id = await uuidv5(CALENDAR_NAMESPACE, 'family:abc')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('toRow', () => {
  it('maps a timed event to the day it starts', async () => {
    const row = await toRow({
      id: 'abc',
      summary: 'Choir',
      updated: '2026-07-29T10:00:00.000Z',
      start: { dateTime: '2026-07-30T18:30:00+01:00' },
      end: { dateTime: '2026-07-30T20:00:00+01:00' }
    }, OPTIONS)

    expect(row).toMatchObject({
      title: 'Choir',
      all_day: false,
      start_date: '2026-07-30',
      end_date: '2026-07-30',
      google_updated_at: '2026-07-29T10:00:00.000Z',
      deleted_at: null
    })
  })

  it('keeps a late-night event on the day it began', async () => {
    // 23:30 BST on Thursday is Thursday's, even though it ends on Friday and is
    // already Friday in UTC.
    const row = await toRow({
      id: 'late',
      summary: 'Film',
      start: { dateTime: '2026-07-30T23:30:00+01:00' },
      end: { dateTime: '2026-07-31T01:00:00+01:00' }
    }, OPTIONS)
    expect(row?.start_date).toBe('2026-07-30')
    expect(row?.end_date).toBe('2026-07-30')
  })

  it('treats a bare date as all-day and keeps the range half-open', async () => {
    const row = await toRow({
      id: 'trip',
      summary: 'Grandparents',
      start: { date: '2026-07-30' },
      end: { date: '2026-08-01' }
    }, OPTIONS)

    expect(row).toMatchObject({ all_day: true, start_date: '2026-07-30', end_date: '2026-08-01' })
  })

  it('gives a one-day all-day event an exclusive end of the next day', async () => {
    const row = await toRow({
      id: 'bins',
      summary: 'Bin day',
      start: { date: '2026-07-30' },
      end: { date: '2026-07-30' }
    }, OPTIONS)
    expect(row?.end_date).toBe('2026-07-31')
  })

  it('drops cancelled events rather than mapping them', async () => {
    expect(await toRow({
      id: 'gone',
      status: 'cancelled',
      start: { dateTime: '2026-07-30T18:30:00Z' }
    }, OPTIONS)).toBeNull()
  })

  it('ignores an event with no id or no start', async () => {
    expect(await toRow({ summary: 'Nameless', start: { dateTime: '2026-07-30T18:30:00Z' } }, OPTIONS))
      .toBeNull()
    expect(await toRow({ id: 'x', summary: 'Timeless' }, OPTIONS)).toBeNull()
  })

  it('names an untitled event rather than showing a blank row', async () => {
    const row = await toRow({
      id: 'busy',
      start: { dateTime: '2026-07-30T18:30:00Z' },
      end: { dateTime: '2026-07-30T19:00:00Z' }
    }, OPTIONS)
    expect(row?.title).toBe('Busy')
  })

  it('is stable: the same event always mints the same id', async () => {
    const event: GoogleEvent = {
      id: 'abc',
      summary: 'Choir',
      start: { dateTime: '2026-07-30T18:30:00Z' }
    }
    const first = await toRow(event, OPTIONS)
    const second = await toRow({ ...event, summary: 'Choir practice' }, OPTIONS)
    expect(first?.id).toBe(second?.id)
  })

  it('keys the id on the calendar too, so two calendars cannot collide', async () => {
    const event: GoogleEvent = { id: 'abc', start: { dateTime: '2026-07-30T18:30:00Z' } }
    const a = await toRow(event, OPTIONS)
    const b = await toRow(event, { ...OPTIONS, calendarId: 'other@gmail.com' })
    expect(a?.id).not.toBe(b?.id)
  })
})

describe('localDate', () => {
  it('uses the household zone rather than UTC', () => {
    // 00:30 BST on the 31st is still the 30th in UTC. The household is in BST.
    expect(localDate(new Date('2026-07-30T23:30:00Z'), 'Europe/London')).toBe('2026-07-31')
  })

  it('handles the clock change without shifting the day', () => {
    // 01:30 UTC on the last Sunday in October, after the change back to GMT.
    expect(localDate(new Date('2026-10-25T01:30:00Z'), 'Europe/London')).toBe('2026-10-25')
  })
})

describe('nextDate', () => {
  it('rolls over months and years', () => {
    expect(nextDate('2026-07-30')).toBe('2026-07-31')
    expect(nextDate('2026-07-31')).toBe('2026-08-01')
    expect(nextDate('2026-12-31')).toBe('2027-01-01')
  })

  it('knows about leap years', () => {
    expect(nextDate('2028-02-28')).toBe('2028-02-29')
  })
})

describe('changedRows', () => {
  const row = (id: string, updated: string | null): CalendarRow => ({
    id,
    household_id: 'h',
    person_id: null,
    calendar_id: 'c',
    google_event_id: id,
    title: 't',
    all_day: false,
    starts_at: '2026-07-30T17:30:00.000Z',
    ends_at: '2026-07-30T19:00:00.000Z',
    start_date: '2026-07-30',
    end_date: '2026-07-30',
    google_updated_at: updated,
    deleted_at: null,
    updated_at: '2026-07-30T16:00:00.000Z'
  })

  it('writes nothing when nothing changed', () => {
    const existing = new Map([['a', { google_updated_at: 'u1', deleted_at: null }]])
    expect(changedRows([row('a', 'u1')], existing)).toHaveLength(0)
  })

  it('writes a row Google has touched since', () => {
    const existing = new Map([['a', { google_updated_at: 'u1', deleted_at: null }]])
    expect(changedRows([row('a', 'u2')], existing)).toHaveLength(1)
  })

  it('writes a row it has never seen', () => {
    expect(changedRows([row('new', 'u1')], new Map())).toHaveLength(1)
  })

  it('revives a row that had been soft-deleted', () => {
    const existing = new Map([['a', { google_updated_at: 'u1', deleted_at: '2026-07-29T00:00:00Z' }]])
    expect(changedRows([row('a', 'u1')], existing)).toHaveLength(1)
  })
})

describe('vanishedIds', () => {
  const fetched = [{ id: 'a' }] as CalendarRow[]

  it('finds rows Google no longer returns', () => {
    const existing = new Map([
      ['a', { google_updated_at: null, deleted_at: null }],
      ['b', { google_updated_at: null, deleted_at: null }]
    ])
    expect(vanishedIds(fetched, existing)).toEqual(['b'])
  })

  it('does not re-delete something already deleted', () => {
    const existing = new Map([['b', { google_updated_at: null, deleted_at: '2026-07-29T00:00:00Z' }]])
    expect(vanishedIds(fetched, existing)).toEqual([])
  })
})

describe('resolvePersonId', () => {
  const people = [{ id: 'p1', name: 'Luke' }, { id: 'p2', name: 'Naomi' }]

  it('matches a name regardless of case or padding', () => {
    expect(resolvePersonId('luke', people)).toBe('p1')
    expect(resolvePersonId('  Naomi ', people)).toBe('p2')
  })

  it('leaves a shared calendar unattributed', () => {
    expect(resolvePersonId(null, people)).toBeNull()
    expect(resolvePersonId(undefined, people)).toBeNull()
  })

  it('returns null rather than guessing when nobody matches', () => {
    expect(resolvePersonId('Sophia', people)).toBeNull()
  })
})

describe('toRows', () => {
  it('maps what it can and silently skips what it cannot', async () => {
    const rows = await toRows([
      { id: 'a', summary: 'Fine', start: { dateTime: '2026-07-30T18:30:00Z' } },
      { id: 'b', status: 'cancelled', start: { dateTime: '2026-07-30T19:30:00Z' } },
      { summary: 'No id' }
    ], OPTIONS)
    expect(rows.map(r => r.google_event_id)).toEqual(['a'])
  })
})

/**
 * The shaping that decides what the settings page says. This is the part of the
 * sync that used to have no consequence: a calendar that threw was a console.error
 * and an otherwise ordinary 200, so a household whose service account had lost
 * access saw a board that looked merely quiet.
 */
describe('syncOutcome', () => {
  const counts = { fetched: 12, written: 3, removed: 1 }

  it('reports a clean run as ok with nothing to say', () => {
    expect(syncOutcome(counts, [])).toEqual({
      outcome: 'ok',
      detail: null,
      fetched: 12,
      written: 3,
      removed: 1,
      calendars_failed: 0
    })
  })

  it('makes a partial run an error, counts included', () => {
    const status = syncOutcome(counts, ['family@group.calendar.google.com: 403 Forbidden'])
    expect(status.outcome).toBe('error')
    expect(status.calendars_failed).toBe(1)
    // The rows that did land are still reported: the run half-worked, and hiding
    // that would make a partial outage look like a total one.
    expect(status.written).toBe(3)
  })

  it('keeps every calendar that failed in the detail', () => {
    const status = syncOutcome(counts, ['a: 403 Forbidden', 'b: 404 Not Found'])
    expect(status.detail).toBe('a: 403 Forbidden; b: 404 Not Found')
    expect(status.calendars_failed).toBe(2)
  })
})
