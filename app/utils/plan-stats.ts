/**
 * The numbers a week can be summed up in, and the night to plan next.
 *
 * Pure and typed against only what it reads, because three surfaces now ask the
 * same questions of a week — the aside on a wide screen, the progress bar under
 * the phone's day flow, and the summary at the top of the review — and a week
 * that is "5 of 7" in one place and "4 of 7" in another is a week nobody trusts.
 */

/**
 * The parts of a planned night these read.
 *
 * `entries` is the night's dinner and nothing else — `PlannedNight` keeps
 * breakfast and lunch in a separate field for exactly this reason. Everything
 * below is deliberately blind to the other two slots: "3 of 7" counts nights,
 * the longest cook is the night that will ambush you, and the button that walks
 * the week walks dinners. A breakfast is not a night with a hole in it.
 */
export interface NightLike {
  date: string
  entries: {
    leftover: boolean
    recipe: { name: string, prep_minutes: number | null, cook_minutes: number | null } | null
  }[]
}

/** A day's three slots, for the one function here that does count all of them. */
export interface DayLike {
  meals: Record<string, { entry: { id: string } } | null>
}

/**
 * Every plan entry on a stretch of days, whichever slot it is in.
 *
 * The one question that is about meals rather than nights: what this week still
 * owes at the shop. Breakfast and lunch derive onto the list like anything else,
 * so a count taken from the dinners alone would send somebody out short.
 */
export function entryIdsIn(days: DayLike[]): Set<string> {
  const ids = new Set<string>()
  for (const day of days) {
    for (const planned of Object.values(day.meals)) {
      if (planned) ids.add(planned.entry.id)
    }
  }
  return ids
}

/**
 * Nights this week is not being asked about — today, nobody is eating on them.
 *
 * Injected rather than read, because who is home lives in a store and this file
 * is pure by design. Passing the predicate keeps the arithmetic here and the
 * roster where it belongs.
 */
export type SkipPredicate = (date: string) => boolean

export interface WeekStats {
  plannedCount: number
  emptyCount: number
  /**
   * How many nights the week is actually asking about — seven, less the ones
   * nobody is eating on. The denominator of "3 of 7", so that a week half of
   * which is away does not read as half unplanned forever.
   */
  total: number
  /** Minutes at the stove across the week. Reheating is not cooking, so it is free. */
  totalMinutes: number
  /** The night that will ambush you, or null when nothing takes any time. */
  longest: { date: string, minutes: number, name: string | null } | null
}

/** Cooking minutes for one night. A leftovers night is reheating, and costs nothing. */
function effortOf(night: NightLike): { date: string, minutes: number, name: string | null } | null {
  const planned = night.entries[0]
  if (!planned || planned.leftover) return null
  const minutes = (planned.recipe?.prep_minutes ?? 0) + (planned.recipe?.cook_minutes ?? 0)
  return minutes > 0 ? { date: night.date, minutes, name: planned.recipe?.name ?? null } : null
}

/**
 * A week in four numbers.
 *
 * "Planned" is any night with an entry on it, which deliberately includes a
 * night somebody said they were not cooking on: a takeaway is a decision, and a
 * week with a takeaway on Friday is not a week with a hole in it.
 *
 * A skipped night leaves the count altogether rather than counting as planned:
 * it is neither cooked nor a hole, and a fraction that included it would say the
 * week was unfinished when there is nothing left to decide. Its cooking still
 * counts, because a dish planned onto such a night is still a dish somebody is
 * standing at a stove for.
 */
export function weekStats(nights: NightLike[], skip?: SkipPredicate): WeekStats {
  let plannedCount = 0
  let total = 0
  let totalMinutes = 0
  let longest: WeekStats['longest'] = null

  for (const night of nights) {
    const counts = !skip?.(night.date) || night.entries.length > 0
    if (counts) {
      total++
      if (night.entries.length) plannedCount++
    }

    const effort = effortOf(night)
    if (!effort) continue
    totalMinutes += effort.minutes
    if (!longest || effort.minutes > longest.minutes) longest = effort
  }

  return { plannedCount, emptyCount: total - plannedCount, total, totalMinutes, longest }
}

/** "2h 10m", "45m" — hours only once there are any. */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/**
 * The next night still worth a decision, for the button that walks the week.
 *
 * Nights that have gone are never offered — planning Monday's dinner on Friday
 * is asking for a decision nobody can act on — and a night somebody skipped is
 * dealt with, so it is passed over exactly as a planned one is. A night nobody
 * is eating on goes the same way: walking somebody onto a Wednesday the whole
 * house is away for is asking a question with no answer.
 *
 * Looks forward from `after` first and then wraps to the start of the week, so
 * pressing "next" from a night in the middle finishes the week rather than
 * stopping at Sunday with Tuesday still empty. Null means there is nothing left
 * to plan, which is what turns the button into "Review week".
 */
export function nextUnplannedDate(
  nights: NightLike[],
  today: string,
  after?: string | null,
  skip?: SkipPredicate
): string | null {
  const open = nights.filter(night =>
    !night.entries.length && night.date >= today && !skip?.(night.date)
  )
  if (!open.length) return null
  if (!after) return open[0]!.date
  return (open.find(night => night.date > after) ?? open[0]!).date
}
