import { usePeopleStore } from '../stores/people'
import { useSyncStore } from '../stores/sync'
import { occursOn, timeOf } from '../utils/board'
import { personHue } from '../utils/person-colors'

/**
 * What else a night is already spoken for by.
 *
 * The calendar is the reason a night gets moved. Somebody is at football at
 * seven, somebody is away from Thursday, and both facts decide what is worth
 * cooking long before the recipe library gets a say — so the screen where the
 * week is decided should carry them, rather than making somebody check two
 * screens against each other. The wall board's week strip has said this for a
 * while; this is the same fact on the page that can act on it.
 *
 * Read-only, like the rows themselves: `calendar_events` is written by the
 * sync-calendar Edge Function and pulled here, and nothing on a client ever
 * commits one.
 */
export interface PlanEvent {
  id: string
  title: string
  /** 'HH:MM' for a timed event, null for one that owns the whole day. */
  time: string | null
  /** Whose it is, as a hue — null for the household's own. */
  hue: number | null
}

/**
 * When the evening starts, for the purpose of "does this get in the way of
 * dinner". Mid-afternoon: a three o'clock appointment is already eating into
 * the time somebody would otherwise be cooking in.
 */
const EVENING_FROM = '15:00'

/** All-day, then this evening, then the rest of the day. */
export function rankOf(event: PlanEvent): number {
  if (!event.time) return 0
  return event.time >= EVENING_FROM ? 1 : 2
}

export function usePlanEvents(dates: Ref<string[]>) {
  const sync = useSyncStore()
  const people = usePeopleStore()

  return computed(() => {
    const byDate = new Map<string, PlanEvent[]>()
    if (!dates.value.length) return byDate

    const first = dates.value[0]!
    const last = dates.value[dates.value.length - 1]!

    const rows = [...sync.rowsOf('calendar_events').values()].filter(
      row => !row.deleted_at && row.start_date <= last && row.end_date >= first
    )

    for (const date of dates.value) {
      const onThisDay = rows
        .filter(row => occursOn(row, date))
        .map(row => ({
          id: row.id,
          title: row.title,
          // An all-day event has a `starts_at` like anything else and it means
          // nothing — midnight in whichever timezone the calendar was written
          // in. Showing it as "00:00" is worse than showing no time at all.
          time: row.all_day ? null : timeOf(new Date(row.starts_at)),
          hue: row.person_id ? personHue(row.person_id, people.people) : null
        }))

      // Ordered by what a dinner has to work around, not by the clock.
      //
      // A card has room for two of these, and strict chronological order spends
      // both on the morning: "bin day, 07:00" above "football, 18:30" is the one
      // that does not matter above the one that decides whether there is time to
      // cook. So the day's own shape comes first — somebody away all week — then
      // the evening, then everything else. Nothing is hidden by this; what does
      // not fit is still counted on the card.
      onThisDay.sort((a, b) => rankOf(a) - rankOf(b) || (a.time ?? '').localeCompare(b.time ?? ''))
      if (onThisDay.length) byDate.set(date, onThisDay)
    }

    return byDate
  })
}
