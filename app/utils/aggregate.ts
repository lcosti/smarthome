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
  /**
   * The house always has this, so the list rolls it up rather than asking for
   * it. Optional and absent means false: an ingredient nobody has flagged
   * behaves exactly as it did before staples existed.
   */
  staple?: boolean
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
  /**
   * Base units of each ingredient already in the house, by ingredient id.
   *
   * Optional, and absent means absent: a household that has never recorded any
   * stock gets exactly the list it got before the pantry existed.
   */
  pantry?: Map<string, number>
}

/** What a line needs, what the cupboard covers, and what is therefore left to buy. */
export interface PantryCoverage {
  need: number
  have: number
  toBuy: number
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
  /**
   * What the pantry covers of this line, or null when it covers nothing — because
   * there is no stock, or because the quantity is prose no arithmetic can touch.
   * `toBuy === 0` is the line that is already in the house.
   */
  pantry: PantryCoverage | null
}

/** The parts of a row {@link splitStaples} reads, beyond {@link ItemLike}. */
export interface StapleCandidate extends ItemLike {
  source: string
}

/** The staples one aisle assumes are in the house, and the rows behind them. */
export interface StapleGroup<T extends ItemLike = ItemLike> {
  /** What to glance at, canonical names, deduped and oldest-first. */
  names: string[]
  /** Still ordinary rows. Tickable, for the week the cupboard turns out empty. */
  items: T[]
}

function byCreated(a: { created_at: string }, b: { created_at: string }) {
  return a.created_at.localeCompare(b.created_at)
}

/**
 * Separate the rows the week assumes from the rows it asks you to buy.
 *
 * Nothing is dropped and nothing is rewritten — the rows are the same rows, and
 * every rule `derive` depends on still holds over them. All that happens here is
 * that a staple's rows are handed back in their own pile, for the card to draw
 * as one "check the cupboard" line rather than a line each.
 *
 * Only plan-derived rows are eligible. Somebody who typed "olive oil" into the
 * box at the top of the list meant it — they are out — and an ad-hoc item
 * disappearing into a roll-up is the app overruling a person. That is also the
 * escape hatch: however the flag is set, typing the thing always works.
 *
 * A row that resolves to no canonical ingredient is never a staple. Nothing
 * knows enough about it to say, and guessing from the name is how "salted
 * caramel" ends up in the cupboard pile.
 */
export function splitStaples<T extends StapleCandidate>(
  items: T[],
  context: AggregateContext
): { rest: T[], staples: StapleGroup<T> | null } {
  const rest: T[] = []
  const found: { item: T, ingredient: IngredientWithUnit }[] = []

  for (const item of items) {
    const ingredient = item.source === 'plan'
      ? chaseMerge(item.ingredient_id, context.ingredients)
      : null
    if (!ingredient?.staple) rest.push(item)
    else found.push({ item, ingredient })
  }

  if (!found.length) return { rest, staples: null }

  // Oldest first, as everywhere else on the list, so a name does not jump about
  // in the line because a second recipe started wanting it.
  found.sort((a, b) => byCreated(a.item, b.item))
  const names = new Map<string, string>()
  for (const { ingredient } of found) {
    if (!names.has(ingredient.id)) names.set(ingredient.id, ingredient.name)
  }

  return {
    rest,
    staples: { names: [...names.values()], items: found.map(f => f.item) }
  }
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
 * mean the list quietly asked for less than the recipes do. It is kept aside
 * verbatim instead, so the number stays true to the rows it came from and the
 * words are still there to read.
 */
function measure(
  items: ItemLike[],
  ingredient: IngredientWithUnit,
  context: AggregateContext
): { total: number, counted: number, tails: string[] } {
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

  return { total, counted, tails }
}

/** A base amount as "800g", followed by "2 tins" when that says something extra. */
function amountParts(
  amount: number,
  ingredient: IngredientWithUnit,
  context: AggregateContext
): string[] {
  const parts = [formatBaseAmount(amount, ingredient.base_unit)]
  const unit = displayUnit(ingredient.id, context)
  // Only worth saying when it is not simply repeating the number above.
  if (unit && ingredient.base_unit !== 'count') {
    const purchase = formatPurchase(amount, unit)
    if (purchase) parts.push(purchase)
  }
  return parts
}

/**
 * How much of a measured total the cupboard covers.
 *
 * Computed against the line's whole demand, which is the reason this can be as
 * simple as one subtraction: every row wanting an ingredient has already
 * collapsed into one line, so there is no allocating to do between them. The one
 * known cost is an ingredient somebody has deliberately filed in two aisles —
 * bucketing happens before this, so each bucket sees the whole of the stock and
 * subtracts it twice. Rare, visible, and better than dragging the two lines back
 * together against what a person explicitly asked for.
 */
function coverageOf(
  total: number,
  counted: number,
  ingredient: IngredientWithUnit,
  context: AggregateContext
): PantryCoverage | null {
  if (counted < 1 || !(total > 0)) return null
  const onHand = context.pantry?.get(ingredient.id) ?? 0
  if (!(onHand > 0)) return null
  const have = Math.min(total, onHand)
  return { need: total, have, toBuy: total - have }
}

/**
 * What to show where the quantity goes, once the cupboard has had its say.
 *
 * The number is always what to put in the trolley, because that is the question
 * being asked while standing in an aisle. Where it came from is said in words
 * beside it, so a line that shrank never looks like a line that was wrong.
 */
function labelFor(
  measured: { total: number, counted: number, tails: string[] },
  coverage: PantryCoverage | null,
  ingredient: IngredientWithUnit,
  context: AggregateContext
): string | null {
  const { total, counted, tails } = measured
  const parts: string[] = []

  if (counted > 0) {
    if (!coverage) {
      parts.push(...amountParts(total, ingredient, context))
    } else if (coverage.toBuy > 0) {
      parts.push(...amountParts(coverage.toBuy, ingredient, context))
      parts.push(`${formatBaseAmount(coverage.have, ingredient.base_unit)} in the pantry`)
    } else {
      // Nothing to buy. The recipe's own amount is still the useful number — it is
      // what to take out of the cupboard.
      parts.push(...amountParts(total, ingredient, context))
      parts.push('from the pantry')
    }
  }

  const label = parts.join(' · ')
  if (label && tails.length) return `${label} + ${tails.join(', ')}`
  if (label) return label
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
  /**
   * One row on its own. Its quantity stays verbatim, as before Phase 3 — rewriting
   * "2 tins" as "800g · 2 tins" would be noise at the shelf — unless the cupboard
   * has something to say about it, which is a fact worth the rewrite.
   */
  const single = (item: T, ingredient: IngredientWithUnit | null): ListEntry<T> => {
    // Only worth any arithmetic when there is stock of this to subtract. Without
    // a pantry this is the function it has always been.
    const stocked = ingredient && (context.pantry?.get(ingredient.id) ?? 0) > 0
    const measured = stocked && ingredient ? measure([item], ingredient, context) : null
    const coverage = measured && ingredient
      ? coverageOf(measured.total, measured.counted, ingredient, context)
      : null

    return {
      key: item.id,
      name: item.name,
      quantityLabel: coverage && measured && ingredient
        ? labelFor(measured, coverage, ingredient, context)
        : item.quantity?.trim() || null,
      items: [item],
      // Null even when the ingredient is known: this field means "this line is a
      // group", and one row is not one, however well the app knows what it is.
      ingredient: null,
      pantry: coverage
    }
  }

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

  const entries: ListEntry<T>[] = loners.map(item => single(item, null))

  for (const { ingredient, items: grouped } of buckets.values()) {
    // One row is still one row: showing it under its canonical name would rename
    // what the recipe said for no benefit.
    if (grouped.length < 2) {
      entries.push(single(grouped[0]!, ingredient))
      continue
    }
    const ordered = [...grouped].sort(byCreated)
    const measured = measure(ordered, ingredient, context)
    const coverage = coverageOf(measured.total, measured.counted, ingredient, context)
    entries.push({
      key: `ingredient:${ingredient.id}`,
      name: ingredient.name,
      quantityLabel: labelFor(measured, coverage, ingredient, context),
      items: ordered,
      ingredient,
      pantry: coverage
    })
  }

  // Oldest first, by the earliest row each line stands for, so a line does not
  // jump up the aisle because a second recipe started needing it.
  return entries.sort((a, b) =>
    byCreated(a.items[0]!, b.items[0]!) || a.key.localeCompare(b.key))
}
