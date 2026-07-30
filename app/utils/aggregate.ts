/**
 * Collapsing the shopping list into lines somebody can act on.
 *
 * Two recipes in the same week both wanting tomatoes put two rows on the list.
 * This turns them into one line reading "800g · 2 tins" without touching the rows
 * themselves — the grouping is computed here, at render time, and never stored.
 *
 * That is the central decision of Phase 3 and it is worth knowing why. The rows
 * stay one per (plan entry, recipe line) because that row is the unit
 * last-write-wins already reconciles correctly, and every rule derive depends on is
 * expressed in terms of it: a checked item is frozen, a deleted one is not
 * resurrected, an unchecked one is refreshed. Storing a combined "800g of
 * tomatoes" row instead would make the unit of conflict the whole week's
 * arithmetic. Two phones deriving offline would then converge on whichever
 * computed last rather than on the truth, and a third recipe adding tomatoes after
 * the line was already ticked could never surface, because a checked row is frozen
 * — a silent under-buy with no way back. Grouping at render time has none of that:
 * the checked row leaves the group, and the new demand appears on its own as the
 * only amount still to buy.
 *
 * Pure, and typed against only the fields it reads.
 */

import type { IngredientLike } from './ingredients'
import { chaseMerge } from './ingredients'
import type { BaseUnit, PurchaseUnit } from './quantity'
import { formatBaseAmount, formatPurchase, parseQuantity, toBaseAmount } from './quantity'

/** The parts of a shopping list item this reads. */
export interface ItemLike {
  id: string
  name: string
  quantity: string | null
  ingredient_id: string | null
  created_at: string
}

/** The parts of an ingredient this needs beyond resolution. */
export interface IngredientWithUnit extends IngredientLike {
  base_unit: BaseUnit
}

/** The parts of a purchase unit row this reads. */
export interface PurchaseUnitLike extends PurchaseUnit {
  ingredient_id: string
  deleted_at: string | null
  created_at: string
}

export interface AggregateContext {
  ingredients: Map<string, IngredientWithUnit>
  purchaseUnits: PurchaseUnitLike[]
}

/**
 * One line on the list, standing for one or more rows.
 *
 * Generic in the row type so that callers get their own rows back — the whole
 * ItemRow, not just the handful of fields this file reads.
 */
export interface ListEntry<T extends ItemLike = ItemLike> {
  /** Stable across renders: the ingredient when grouped, otherwise the row id. */
  key: string
  name: string
  /** What to show where the quantity goes, or null for none. */
  quantityLabel: string | null
  /** The rows this line stands for, oldest first. Never empty. */
  items: T[]
  /** Set only when this line is a group of rows sharing an ingredient. */
  ingredient: IngredientWithUnit | null
}

function byCreated(a: { created_at: string }, b: { created_at: string }) {
  return a.created_at.localeCompare(b.created_at)
}

/** The purchase unit to describe a total in: the first one somebody set up. */
function displayUnit(ingredientId: string, context: AggregateContext): PurchaseUnitLike | null {
  const units = context.purchaseUnits
    .filter(u => !u.deleted_at && u.ingredient_id === ingredientId && u.amount > 0)
    .sort(byCreated)
  return units[0] ?? null
}

function unitsFor(ingredientId: string, context: AggregateContext): PurchaseUnitLike[] {
  return context.purchaseUnits.filter(u => !u.deleted_at && u.ingredient_id === ingredientId)
}

/**
 * Add up what can be added up, and keep the rest as written.
 *
 * A line reading "a splash of passata" cannot join a total, but dropping it would
 * mean the list quietly asked for less than the recipes do. It is appended
 * verbatim instead, so the number stays true to the rows it came from and the
 * words are still there to read.
 */
function groupLabel(
  items: ItemLike[],
  ingredient: IngredientWithUnit,
  context: AggregateContext
): string | null {
  const units = unitsFor(ingredient.id, context)
  let total = 0
  let counted = 0
  const tails: string[] = []

  for (const item of items) {
    if (!item.quantity?.trim()) continue
    const parsed = parseQuantity(item.quantity)
    const amount = parsed && toBaseAmount(parsed, ingredient.base_unit, units)
    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
      tails.push(item.quantity.trim())
      continue
    }
    total += amount
    counted++
  }

  const parts: string[] = []
  if (counted > 0) {
    parts.push(formatBaseAmount(total, ingredient.base_unit))
    const unit = displayUnit(ingredient.id, context)
    // Only worth saying when it is not simply repeating the number above.
    if (unit && ingredient.base_unit !== 'count') {
      const purchase = formatPurchase(total, unit)
      if (purchase) parts.push(purchase)
    }
  }

  const measured = parts.join(' · ')
  if (measured && tails.length) return `${measured} + ${tails.join(', ')}`
  if (measured) return measured
  return tails.length ? tails.join(', ') : null
}

/**
 * Turn the rows of one aisle into the lines to show for it.
 *
 * Called per aisle bucket rather than over the whole list, so an ingredient that
 * somebody deliberately filed in two different aisles stays in both places instead
 * of being dragged into one. Rows that resolve to no ingredient — every ad-hoc
 * "bin bags", and any recipe line not yet canonicalised — pass straight through
 * unchanged, which is what keeps this invisible until it has something to offer.
 *
 * The caller passes the rows it wants shown: live and unchecked. Which is why
 * ticked rows need no special case here — a checked row is simply not in the list,
 * so the group covers only what is still to buy, and a total never counts
 * something already in the trolley.
 */
export function buildEntries<T extends ItemLike>(items: T[], context: AggregateContext): ListEntry<T>[] {
  const single = (item: T): ListEntry<T> => ({
    key: item.id,
    name: item.name,
    // Verbatim, as before Phase 3. One row needs no arithmetic, and rewriting
    // "2 tins" as "800g · 2 tins" would be noise at the shelf.
    quantityLabel: item.quantity?.trim() || null,
    items: [item],
    ingredient: null
  })

  const buckets = new Map<string, { ingredient: IngredientWithUnit, items: T[] }>()
  const loners: T[] = []

  for (const item of items) {
    const ingredient = chaseMerge(item.ingredient_id, context.ingredients)
    if (!ingredient) {
      loners.push(item)
      continue
    }
    const bucket = buckets.get(ingredient.id)
    if (bucket) bucket.items.push(item)
    else buckets.set(ingredient.id, { ingredient, items: [item] })
  }

  const entries: ListEntry<T>[] = loners.map(single)

  for (const { ingredient, items: grouped } of buckets.values()) {
    // One row is still one row: showing it under its canonical name would rename
    // what the recipe said for no benefit.
    if (grouped.length < 2) {
      entries.push(single(grouped[0]!))
      continue
    }
    const ordered = [...grouped].sort(byCreated)
    entries.push({
      key: `ingredient:${ingredient.id}`,
      name: ingredient.name,
      quantityLabel: groupLabel(ordered, ingredient, context),
      items: ordered,
      ingredient
    })
  }

  // Oldest first, by the earliest row each line stands for, so a line does not
  // jump up the aisle because a second recipe started needing it.
  return entries.sort((a, b) =>
    byCreated(a.items[0]!, b.items[0]!) || a.key.localeCompare(b.key))
}
