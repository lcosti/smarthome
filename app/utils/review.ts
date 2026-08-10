/**
 * The week's shopping, read over before any of it is committed.
 *
 * The phone plans a week one night at a time and finishes on a list of every
 * ingredient those nights ask for, so that the things already in the cupboard
 * can be dropped in one pass rather than found again in an aisle. That means two
 * things nothing else in the app needed: seeing what a derive *would* write
 * before it writes it, and remembering what somebody said no to.
 *
 * Both fall out of rules `derive` already has, which is why there is no storage
 * here and no new table. Unticking a line is the row existing soft-deleted, and
 * "an item deleted while its night is still planned was deleted by a person, so
 * it is not resurrected" is what makes that stick — through the next derive,
 * through filling the week, through the other phone.
 *
 * Pure, like everything it builds on.
 */

import type { AggregateContext, ListEntry } from './aggregate'
import { buildEntries, splitStaples } from './aggregate'
import type { ItemRow } from './db'
import type { DeriveResult } from './derive'

/** One of the week's rows, and what the list already thinks of it. */
export interface ReviewRow {
  /** The row as the plan would have it — what gets written if it is kept. */
  row: ItemRow
  /** What is on the list now, or null when the plan has not put it there yet. */
  current: ItemRow | null
  /** Taken off by a person, on this device or another. Starts unticked. */
  excluded: boolean
  /** In the trolley. Shown, but not a decision anybody is being offered again. */
  frozen: boolean
}

/**
 * Everything this week's nights ask for, whatever state it is in.
 *
 * `wanted` is already scoped to the range that was derived, so rows belonging to
 * another week never appear here even though the caller hands over every
 * plan-sourced item on the list.
 */
export function weekReviewRows(result: DeriveResult, planItems: ItemRow[]): ReviewRow[] {
  const current = new Map(planItems.map(item => [item.id, item]))
  const rows: ReviewRow[] = []

  for (const [id, row] of result.wanted) {
    const existing = current.get(id) ?? null
    rows.push({
      row,
      current: existing,
      excluded: !!existing?.deleted_at,
      // Deleted wins: a row somebody ticked and then took off the list is off it.
      frozen: !!existing?.checked && !existing.deleted_at
    })
  }

  return rows
}

/** One line to tick or not, standing for one or more rows. */
export interface ReviewLine {
  /** Stable across a change of grouping, because the toggle state is keyed by row. */
  key: string
  name: string
  quantityLabel: string | null
  items: ItemRow[]
  /** The cupboard already has all of it. A fact, not a decision — starts unticked. */
  covered: boolean
}

export interface ReviewSection {
  id: string
  name: string
  lines: ReviewLine[]
}

/** The parts of an aisle this reads. */
export interface AisleLike {
  id: string
  name: string
}

/**
 * The week by aisle — the canonical read, and the one the counts come from.
 *
 * Bucketed by aisle before anything is added up, exactly as the shopping list
 * does it, so an ingredient somebody deliberately filed in two places stays in
 * both. Staples come out first and are never offered as choices: an ingredient
 * the house always has is not a decision, and fifteen of them would bury the
 * four things this week actually turns on.
 *
 * `covered` is worked out here and nowhere else. Grouping by meal instead must
 * not change how many things the cupboard is said to have, and it would if each
 * night's rows were totalled against the same jar of stock.
 */
export function reviewByAisle(
  rows: ItemRow[],
  context: AggregateContext,
  aisles: AisleLike[]
): { sections: ReviewSection[], staples: ItemRow[], covered: Set<string> } {
  const buckets = new Map<string, ItemRow[]>()
  const known = new Map(aisles.map(aisle => [aisle.id, aisle.name]))

  for (const row of rows) {
    // Anything whose aisle is unset or has since been deleted falls into a
    // trailing "Other", so no row can become invisible.
    const key = row.aisle_id && known.has(row.aisle_id) ? row.aisle_id : 'other'
    const bucket = buckets.get(key)
    if (bucket) bucket.push(row)
    else buckets.set(key, [row])
  }

  const sections: ReviewSection[] = []
  const staples: ItemRow[] = []
  const covered = new Set<string>()

  const build = (id: string, name: string) => {
    const bucket = buckets.get(id)
    if (!bucket?.length) return
    const split = splitStaples(bucket, context)
    staples.push(...(split.staples?.items ?? []))
    const lines = buildEntries(split.rest, context).map(toLine)
    for (const line of lines) {
      if (line.covered) for (const item of line.items) covered.add(item.id)
    }
    if (lines.length) sections.push({ id, name, lines })
  }

  for (const aisle of aisles) build(aisle.id, aisle.name)
  build('other', 'Other')

  return { sections, staples, covered }
}

function toLine(entry: ListEntry<ItemRow>): ReviewLine {
  return {
    key: entry.key,
    name: entry.name,
    quantityLabel: entry.quantityLabel,
    items: entry.items,
    covered: entry.pantry !== null && entry.pantry.toBuy === 0
  }
}

/** What a row's night is called, and where it falls in the week. */
export interface MealOf {
  (item: ItemRow): { id: string, name: string, order: string } | null
}

/**
 * The same rows filed under the night that asked for them.
 *
 * One line per row rather than per ingredient, because a line standing for two
 * recipes' tomatoes cannot live under one of them — and under a meal the useful
 * text is what its own recipe wrote, not a total.
 *
 * Staples and cupboard coverage are the aisle read's answers, passed in: this is
 * a different arrangement of the same list, not a second opinion about it.
 */
export function reviewByMeal(
  rows: ItemRow[],
  mealOf: MealOf,
  options: { covered: Set<string>, staples: Set<string> }
): ReviewSection[] {
  const buckets = new Map<string, { name: string, order: string, items: ItemRow[] }>()

  for (const row of rows) {
    if (options.staples.has(row.id)) continue
    const meal = mealOf(row)
    const id = meal?.id ?? 'other'
    const bucket = buckets.get(id)
    if (bucket) bucket.items.push(row)
    else buckets.set(id, { name: meal?.name ?? 'Other', order: meal?.order ?? '￿', items: [row] })
  }

  return [...buckets.entries()]
    .sort((a, b) => a[1].order.localeCompare(b[1].order) || a[1].name.localeCompare(b[1].name))
    .map(([id, bucket]) => ({
      id,
      name: bucket.name,
      lines: bucket.items
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(item => ({
          key: item.id,
          name: item.name,
          quantityLabel: item.quantity,
          items: [item],
          covered: options.covered.has(item.id)
        }))
    }))
}

/** Whether the plan's version of a row says anything the list does not. */
function differs(next: ItemRow, current: ItemRow): boolean {
  return next.name !== current.name
    || next.quantity !== current.quantity
    || next.aisle_id !== current.aisle_id
    || next.ingredient_id !== current.ingredient_id
}

/**
 * The rows to write once somebody has said which of the week they want.
 *
 * Everything a plain derive would do, with one thing added: a row whose line was
 * unticked is written soft-deleted instead of live. That is not a special case
 * downstream — it is exactly the shape a person deleting an item off the list
 * leaves behind, so every later derive already knows to leave it alone.
 *
 * Rows in the trolley are never touched, ticked or unticked. Somebody is holding
 * the thing; the week is not entitled to an opinion about it.
 */
export function applyReviewSelection(
  result: DeriveResult,
  planItems: ItemRow[],
  excluded: Set<string>,
  now: string
): ItemRow[] {
  const current = new Map(planItems.map(item => [item.id, item]))
  const writes: ItemRow[] = []

  for (const [id, row] of result.wanted) {
    const existing = current.get(id) ?? null
    if (existing?.checked && !existing.deleted_at) continue

    const off = excluded.has(id)
    const wasOff = !!existing?.deleted_at

    if (existing && off === wasOff) {
      // No change of mind. A line that is still on the list is still refreshed
      // from the recipe; one that is off it is left where it was put.
      if (!off && differs(row, existing)) writes.push(row)
      continue
    }

    writes.push({ ...row, deleted_at: off ? now : null })
  }

  // Nights that have gone take their rows with them, exactly as a derive does —
  // clearing a week and reviewing it is how its ingredients come back off.
  writes.push(...result.removes)

  return writes
}
