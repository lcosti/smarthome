/**
 * What is already in the house, and what the plan has spoken for.
 *
 * The problem this solves is small and constant: a recipe wants one onion, onions
 * come in threes, and two of them are now stock the shopping list should stop
 * asking for. Recording that is easy. Spending it correctly is not, because
 * deriving a week is a button people press repeatedly — every time Thursday
 * changes — and a naive "subtract what the plan needs" would spend the same two
 * onions on every press.
 *
 * So stock is never decremented at derive time. Deriving writes reservations
 * instead, one per (plan entry, ingredient), keyed by uuidv5 so pressing the
 * button again rewrites the same row rather than taking more. A reservation says
 * "spoken for", which is enough for the list to stop asking and for the recipe
 * library to know the onions are not really free. Only once its night has passed
 * does a reservation settle: on_hand comes down once, settled_at is stamped, and
 * the row is frozen so it can never come down again.
 *
 * That ordering buys the behaviour people expect for free. Change your mind about
 * Thursday and the reservation is released, so the onions come back. Cook it, and
 * the following day they are gone. Nobody has to tell the app either thing.
 *
 * Everything here is pure and knows nothing about Pinia, Dexie or the database.
 */

import type { PantryItemRow, PantryReservationRow, PlanEntryRow, RecipeIngredientRow, RecipeRow } from './db'
import { leftoverPlan, servingsHint } from './derive'
import type { BaseUnit, PurchaseUnit } from './quantity'
import { parseQuantity, toBaseAmount } from './quantity'
import { PANTRY_NAMESPACE, PANTRY_RESERVATION_NAMESPACE, uuidv5 } from './uuid5'

/** The one row holding how much of an ingredient this household has. */
export function pantryItemId(householdId: string, ingredientId: string): string {
  return uuidv5(PANTRY_NAMESPACE, `${householdId}:${ingredientId}`)
}

/** The one row holding what a night has spoken for of an ingredient. */
export function pantryReservationId(planEntryId: string, ingredientId: string): string {
  return uuidv5(PANTRY_RESERVATION_NAMESPACE, `${planEntryId}:${ingredientId}`)
}

/**
 * What a recipe line needs, in base units, or null when it cannot be known.
 *
 * The single quantity-to-number path for the whole feature, so that the number
 * the list subtracts, the number a night reserves and the number the library
 * calls "covered" are always the same number. A line reading "a splash" returns
 * null here and is then treated as unmeasurable everywhere, rather than counting
 * as zero somewhere and quietly making a recipe look cookable.
 */
export function lineNeedBase(
  quantity: string | null,
  baseUnit: BaseUnit,
  purchaseUnits: PurchaseUnit[] = []
): number | null {
  const parsed = parseQuantity(quantity)
  if (!parsed) return null
  const amount = toBaseAmount(parsed, baseUnit, purchaseUnits)
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null
  return amount
}

export interface ReserveInput {
  householdId: string
  /** Inclusive date range, 'YYYY-MM-DD'. Date keys compare correctly as strings. */
  start: string
  end: string
  entries: PlanEntryRow[]
  recipes: Map<string, RecipeRow>
  ingredients: RecipeIngredientRow[]
  /** Every reservation this household holds, settled and soft-deleted ones included. */
  reservations: PantryReservationRow[]
  /** The canonical ingredient a recipe line means, or null. Injected exactly as derive does it. */
  resolveIngredientId: (line: RecipeIngredientRow) => string | null
  baseUnitOf: (ingredientId: string) => BaseUnit
  purchaseUnitsOf: (ingredientId: string) => PurchaseUnit[]
  now: string
}

export interface ReserveResult {
  /** Rows to write: new reservations and changed amounts. */
  upserts: PantryReservationRow[]
  /** Reservations the plan no longer calls for, soft-deleted. */
  releases: PantryReservationRow[]
}

/**
 * Work out what the planned nights in a range have spoken for.
 *
 * Shaped deliberately like {@link derive}: build what the plan wants, reconcile
 * it against what exists, and treat anything left over as new. The rules that
 * matter:
 *
 *   - A settled reservation is frozen. Its night has been and gone and its stock
 *     has already come off; rewriting it would either double-spend or resurrect
 *     onions that were eaten.
 *   - A night dropped from the plan releases what it held, so changing your mind
 *     gives the stock back.
 *   - A line whose quantity does not parse reserves nothing. Guessing would put a
 *     confident wrong number against real food.
 *   - Nights outside the range are left completely alone, so deriving one week
 *     never disturbs another.
 *
 * Several lines of one recipe can name the same ingredient — a marinade and a
 * garnish both wanting lemon — and they are summed into the single row that pair
 * gets, because the id is keyed on the pair and not on the line.
 */
export function derivePantryReservations(input: ReserveInput): ReserveResult {
  const {
    householdId, start, end, entries, recipes, ingredients, reservations,
    resolveIngredientId, baseUnitOf, purchaseUnitsOf, now
  } = input

  const linesByRecipe = new Map<string, RecipeIngredientRow[]>()
  for (const line of ingredients) {
    if (line.deleted_at) continue
    const bucket = linesByRecipe.get(line.recipe_id)
    if (bucket) bucket.push(line)
    else linesByRecipe.set(line.recipe_id, [line])
  }

  const entryById = new Map(entries.map(e => [e.id, e]))
  const { extra: extraServings, deferred } = leftoverPlan(entries)

  // 1. What the planned nights in range need, per (entry, ingredient).
  const wanted = new Map<string, { entry: PlanEntryRow, ingredientId: string, amount: number }>()
  for (const entry of entries) {
    if (entry.deleted_at || entry.date < start || entry.date > end) continue
    // Leftovers come off the shelf on the night they are cooked, not the night
    // they are eaten again — one reservation, dated to the cooking.
    if (deferred.has(entry.id)) continue
    // Nothing comes off the shelf for a night nobody is cooking on.
    const recipe = entry.recipe_id ? recipes.get(entry.recipe_id) : null
    if (!recipe || recipe.deleted_at) continue

    for (const line of linesByRecipe.get(recipe.id) ?? []) {
      const ingredientId = resolveIngredientId(line)
      if (!ingredientId) continue
      // Scaled through the same annotation the list shows, so a night cooked for
      // six reserves what a night cooked for six actually eats.
      const quantity = servingsHint(
        line.quantity,
        entry.servings + (extraServings.get(entry.id) ?? 0),
        recipe.base_servings
      )
      const amount = lineNeedBase(quantity, baseUnitOf(ingredientId), purchaseUnitsOf(ingredientId))
      if (amount === null) continue

      const id = pantryReservationId(entry.id, ingredientId)
      const existing = wanted.get(id)
      if (existing) existing.amount += amount
      else wanted.set(id, { entry, ingredientId, amount })
    }
  }

  const upserts: PantryReservationRow[] = []
  const releases: PantryReservationRow[] = []

  // 2. Reconcile what is already reserved.
  for (const row of reservations) {
    // Settled is final, in both directions: never rewritten, never released.
    if (row.settled_at) {
      wanted.delete(row.id)
      continue
    }

    const hit = wanted.get(row.id)
    wanted.delete(row.id)

    if (hit) {
      if (row.deleted_at || row.amount !== hit.amount || row.date !== hit.entry.date) {
        upserts.push({
          ...row,
          amount: hit.amount,
          date: hit.entry.date,
          deleted_at: null,
          updated_at: now
        })
      }
      continue
    }

    if (row.deleted_at) continue
    // Not wanted here. If its night falls outside this range it belongs to another
    // week and is none of our business — the same rule derive draws for items.
    const entry = entryById.get(row.plan_entry_id)
    if (entry && !entry.deleted_at && (entry.date < start || entry.date > end)) continue
    releases.push({ ...row, deleted_at: now, updated_at: now })
  }

  // 3. Anything still wanted is new.
  for (const [id, { entry, ingredientId, amount }] of wanted) {
    upserts.push({
      id,
      household_id: householdId,
      plan_entry_id: entry.id,
      ingredient_id: ingredientId,
      amount,
      date: entry.date,
      settled_at: null,
      deleted_at: null,
      created_at: now,
      updated_at: now
    })
  }

  return { upserts, releases }
}

export interface SettleInput {
  /** 'YYYY-MM-DD'. Reservations for nights strictly before this have been eaten. */
  today: string
  reservations: PantryReservationRow[]
  /** Current stock, keyed by ingredient. */
  pantryByIngredient: Map<string, PantryItemRow>
  now: string
}

export interface SettleResult {
  pantryUpdates: PantryItemRow[]
  settled: PantryReservationRow[]
}

/**
 * Take what has been eaten off the shelf.
 *
 * Runs whenever the app opens and before every derive, and is safe to run as
 * often as it likes: a settled row is skipped forever after, so the arithmetic
 * happens exactly once per reservation no matter how many devices do it or how
 * many times.
 *
 * Two phones settling the same night while both offline compute the same result
 * from the same inputs and write the same number, so last-write-wins converges on
 * the truth rather than on whoever went last. A manual adjustment racing a
 * settlement can lose by an onion. That is the tolerance decision 5 already made,
 * and the correction is a person typing the real number on the pantry page.
 *
 * Stock is clamped at zero. Going negative would be the app insisting the
 * household owes it food.
 */
export function settleDuePantry(input: SettleInput): SettleResult {
  const { today, reservations, pantryByIngredient, now } = input

  const due = reservations
    .filter(r => !r.settled_at && !r.deleted_at && r.date < today)
    // Oldest night first, so the clamp spends what there was in the order it was
    // actually eaten rather than in map order.
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  if (!due.length) return { pantryUpdates: [], settled: [] }

  const running = new Map<string, number>()
  const touched = new Map<string, PantryItemRow>()
  const settled: PantryReservationRow[] = []

  for (const row of due) {
    settled.push({ ...row, settled_at: now, updated_at: now })

    const stock = pantryByIngredient.get(row.ingredient_id)
    // Nothing on the shelf to take it off. The reservation is still settled — it
    // has been eaten either way — it just had nothing to spend.
    if (!stock || stock.deleted_at) continue

    const before = running.get(row.ingredient_id) ?? Number(stock.on_hand)
    const after = Math.max(0, before - row.amount)
    running.set(row.ingredient_id, after)
    if (after !== Number(stock.on_hand)) {
      touched.set(row.ingredient_id, { ...stock, on_hand: after, updated_at: now })
    }
  }

  return { pantryUpdates: [...touched.values()], settled }
}

/**
 * How much of each ingredient is genuinely free, by ingredient id.
 *
 * On the shelf, minus what nights still to come have already spoken for. This is
 * the number to ask "could I cook this tonight without shopping" with — the
 * unqualified on_hand would say yes to a recipe whose onions are already
 * committed to tomorrow.
 *
 * Only ingredients with something left appear, so an empty map is the honest
 * answer for a household that has never recorded any stock.
 *
 * Rows are added up rather than overwriting each other, because a caller that has
 * chased merges can legitimately hand two rows that now mean the same ingredient.
 */
export function pantryAvailable(
  pantryRows: PantryItemRow[],
  reservations: PantryReservationRow[],
  today: string
): Map<string, number> {
  const available = new Map<string, number>()
  for (const row of pantryRows) {
    if (row.deleted_at) continue
    const amount = Number(row.on_hand)
    if (!Number.isFinite(amount) || amount <= 0) continue
    available.set(row.ingredient_id, (available.get(row.ingredient_id) ?? 0) + amount)
  }

  for (const row of reservations) {
    // Settled reservations have already come off on_hand; counting them here
    // would charge the household for the same night twice.
    if (row.settled_at || row.deleted_at || row.date < today) continue
    const current = available.get(row.ingredient_id)
    if (current === undefined) continue
    const left = current - Number(row.amount)
    if (left > 0) available.set(row.ingredient_id, left)
    else available.delete(row.ingredient_id)
  }

  return available
}
