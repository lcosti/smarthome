import type { PlanEntryRow } from './db'
import type { Meal } from './meal'

/**
 * Moving a dish to another slot.
 *
 * Pure, and separate from the store for the same reason `derive` is: what a drop
 * costs is a set of rules about dates and leftovers, and rules are worth testing
 * without Pinia, Dexie or a pointer.
 *
 * A slot, not a night: a dish moves to any day and any meal, because what a
 * household actually does with last night's plan is decide the chilli would do
 * for Wednesday's lunch instead. So the row's `meal` is rewritten along with its
 * date. That is the whole of why this used to be day-only — nothing about the
 * schema said a dinner had to stay one.
 *
 * Two rules, and the second is the one that bites. Dropping Tuesday's dinner on
 * Friday's lunch moves it, and if that lunch was taken the two change places
 * rather than one of them being lost — a drag is a rearrangement, never a
 * delete. And a leftovers night is a claim about time: it eats what was cooked
 * one or two days before it. Drag either end of that pair far enough apart and
 * the claim stops being true, so the link is cut and the night goes back to
 * cooking for itself, which is exactly what its own copy of the recipe is for.
 * The gap is still counted in days, so a dinner dragged onto its own source's
 * day — lunch eating what lunch cooked — cuts the link too. That is the safe
 * answer rather than a special case: the night keeps the recipe and buys for it.
 */

/**
 * How far back a night may reach for leftovers, in days.
 *
 * Two, which is the honest limit for a fridge and also the point past which
 * "leftovers of the roast" stops meaning anything to anybody looking at a plan.
 */
export const LEFTOVER_MAX_AGE_DAYS = 2

/** Whole days from one calendar date to another. Dates, so no timezone in it. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const start = Date.UTC(fy!, fm! - 1, fd!)
  const end = Date.UTC(ty!, tm! - 1, td!)
  return Math.round((end - start) / 86_400_000)
}

/** Whether a night that many days after its source is still eating it. */
export function isLeftoverGap(days: number): boolean {
  return days >= 1 && days <= LEFTOVER_MAX_AGE_DAYS
}

/**
 * What dropping a dish on a slot changes.
 *
 * Returns the rows to commit and nothing else — the caller owns every write, and
 * an empty array means the drop was a no-op (onto the slot it is already in, or
 * onto a dish that is not there).
 */
export function planMove(
  entries: PlanEntryRow[],
  entryId: string,
  toDate: string,
  toMeal: Meal,
  now: string
): PlanEntryRow[] {
  const live = entries.filter(entry => !entry.deleted_at)
  const moved = live.find(entry => entry.id === entryId)
  if (!moved || (moved.date === toDate && moved.meal === toMeal)) return []

  const fromDate = moved.date
  const fromMeal = moved.meal
  const changed = new Map<string, PlanEntryRow>()

  changed.set(moved.id, { ...moved, date: toDate, meal: toMeal, updated_at: now })
  // Whatever was in the target slot goes back the other way — into the slot this
  // one came from, meal and all. Two slots change places; nothing is displaced
  // onto a third and nothing is dropped.
  for (const entry of live) {
    if (entry.id === moved.id || entry.date !== toDate || entry.meal !== toMeal) continue
    changed.set(entry.id, { ...entry, date: fromDate, meal: fromMeal, updated_at: now })
  }

  // The week as it will be, so a leftovers link is judged against where both of
  // its nights have ended up rather than where either one started.
  const after = new Map(live.map(entry => [entry.id, changed.get(entry.id) ?? entry]))

  for (const entry of after.values()) {
    if (!entry.leftover_of_entry_id) continue
    // Only links this drop actually moved an end of. A pair that was already
    // further apart than a fridge allows — planned before the rule existed, or
    // edited on another device — is left exactly as it is: a drag rearranges
    // the nights it touches and must not quietly rewrite a night nobody
    // dragged, least of all one whose shopping would change with it.
    if (!changed.has(entry.id) && !changed.has(entry.leftover_of_entry_id)) continue
    const source = after.get(entry.leftover_of_entry_id)
    // A link this device cannot see the other end of is left exactly as it is.
    // It may be a row that has not synced yet, and cutting it here would turn a
    // gap in this device's knowledge into a permanent edit everybody gets.
    if (!source) continue
    if (isLeftoverGap(daysBetween(source.date, entry.date))) continue
    changed.set(entry.id, { ...entry, leftover_of_entry_id: null, updated_at: now })
  }

  return [...changed.values()]
}
