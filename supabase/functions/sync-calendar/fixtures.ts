/**
 * Stand-in events for local development, so the whole pipeline can be exercised
 * without a Google Cloud project.
 *
 * Generated relative to the moment they are asked for rather than written as
 * fixed dates: a fixture calendar full of last spring is outside every window
 * the function queries, and would test nothing but the empty case.
 *
 * The second run drops the last event, which is what makes the soft-delete path
 * reachable locally — call the function twice and watch one row acquire a
 * deleted_at.
 */

import type { GoogleEvent } from '../_shared/calendar-events.ts'

function iso(base: Date, dayOffset: number, hours: number, minutes = 0): string {
  const date = new Date(base)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

function dateOnly(base: Date, dayOffset: number): string {
  const date = new Date(base)
  date.setDate(date.getDate() + dayOffset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function mockEvents(now = new Date(), run = 1): GoogleEvent[] {
  const updated = now.toISOString()
  const events: GoogleEvent[] = [
    {
      id: 'mock-health-visitor',
      summary: 'Health visitor',
      updated,
      start: { dateTime: iso(now, 0, 12, 30) },
      end: { dateTime: iso(now, 0, 13, 15) }
    },
    {
      id: 'mock-nursery-pickup',
      summary: 'Nursery pickup',
      updated,
      start: { dateTime: iso(now, 0, 15, 15) },
      end: { dateTime: iso(now, 0, 15, 45) }
    },
    {
      id: 'mock-choir',
      summary: 'Choir',
      updated,
      start: { dateTime: iso(now, 0, 18, 30) },
      end: { dateTime: iso(now, 0, 20, 0) }
    },
    {
      id: 'mock-all-day',
      summary: 'Bin day',
      updated,
      start: { date: dateOnly(now, 0) },
      end: { date: dateOnly(now, 1) }
    },
    {
      id: 'mock-school-run',
      summary: 'School run',
      updated,
      start: { dateTime: iso(now, 1, 8, 15) },
      end: { dateTime: iso(now, 1, 9, 0) }
    }
  ]

  // Vanishes on the second run, so the soft-delete branch is reachable.
  if (run === 1) {
    events.push({
      id: 'mock-cancelled-later',
      summary: 'Plans that fall through',
      updated,
      start: { dateTime: iso(now, 0, 21, 0) },
      end: { dateTime: iso(now, 0, 22, 0) }
    })
  }

  return events
}
