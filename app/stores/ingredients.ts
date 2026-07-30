import { defineStore } from 'pinia'
import type { IngredientAliasRow, IngredientRow, PurchaseUnitRow } from '../utils/db'
import {
  aliasId,
  chaseMerge,
  normaliseIngredientName,
  resolveIngredient,
  suggestIngredients,
  type Suggestion
} from '../utils/ingredients'
import { parseQuantity, type BaseUnit } from '../utils/quantity'
import { plainCopy } from '../utils/sync'
import { nowIso, useSyncStore } from './sync'

/**
 * Postgres has a check constraint on this column, but a check constraint does not
 * become a TypeScript union, so the generated type is plain `string`. Narrow at
 * the boundary rather than casting: a row written by a future build with a fourth
 * unit should be counted rather than crash a shopping list.
 */
export function asBaseUnit(value: string): BaseUnit {
  return value === 'g' || value === 'ml' ? value : 'count'
}

/** What the quantity on a line implies about how its ingredient is measured. */
function inferBaseUnit(quantity: string | null | undefined): BaseUnit {
  const parsed = parseQuantity(quantity)
  if (!parsed?.unit) return 'count'
  if (parsed.unit === 'g' || parsed.unit.startsWith('kg') || parsed.unit.startsWith('gram')) return 'g'
  if (['ml', 'l', 'cl'].includes(parsed.unit) || parsed.unit.startsWith('litre') || parsed.unit.startsWith('liter')) {
    return 'ml'
  }
  return 'count'
}

export const useIngredientsStore = defineStore('ingredients', () => {
  const sync = useSyncStore()

  const all = computed(() => sync.rowsOf('ingredients'))
  const allAliases = computed(() => sync.rowsOf('ingredient_aliases'))
  const allUnits = computed(() => sync.rowsOf('ingredient_purchase_units'))

  /** Alphabetical, merged-away rows excluded. */
  const ingredients = computed(() =>
    [...all.value.values()]
      .filter(i => !i.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  const aliases = computed(() => [...allAliases.value.values()].filter(a => !a.deleted_at))
  const purchaseUnits = computed(() => [...allUnits.value.values()].filter(u => !u.deleted_at))

  function ingredientById(id: string | null): IngredientRow | undefined {
    return chaseMerge(id, all.value) ?? undefined
  }

  function aliasesFor(ingredientId: string): IngredientAliasRow[] {
    return aliases.value
      .filter(a => a.ingredient_id === ingredientId)
      .sort((a, b) => a.alias.localeCompare(b.alias))
  }

  function purchaseUnitsFor(ingredientId: string): PurchaseUnitRow[] {
    return purchaseUnits.value
      .filter(u => u.ingredient_id === ingredientId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  }

  /** The ingredient a name already means, or undefined. Never creates anything. */
  function resolve(name: string): IngredientRow | undefined {
    return resolveIngredient(name, all.value, aliases.value) ?? undefined
  }

  function suggest(query: string, limit = 6): Suggestion[] {
    return suggestIngredients(query, all.value, aliases.value, limit)
  }

  /**
   * The ingredient this name means, creating one if nothing does yet.
   *
   * Called as somebody presses enter on a recipe line, so it has to be silent and
   * it has to be cheap. The base unit is guessed from the quantity beside the name
   * — "400g" makes it a weight — and can be corrected later on /ingredients
   * without touching anything that points here.
   */
  async function ensureIngredient(name: string, options: {
    quantity?: string | null
    aisleId?: string | null
  } = {}): Promise<IngredientRow | null> {
    const trimmed = name.trim()
    if (!trimmed || !sync.householdId) return null

    const existing = resolve(trimmed)
    if (existing) return existing

    const timestamp = nowIso()
    return sync.commit('ingredients', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      name: trimmed,
      base_unit: inferBaseUnit(options.quantity),
      aisle_id: options.aisleId ?? null,
      merged_into: null,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  /**
   * Teach the app a synonym, so that next time the typing resolves on its own.
   *
   * The id is derived from the alias itself, so two people recording it mint one
   * row rather than two. Recording an ingredient's own name is pointless and
   * recording something that already resolves elsewhere would be a quiet
   * hijacking, so both are declined.
   */
  async function recordAlias(ingredientId: string, alias: string): Promise<IngredientAliasRow | null> {
    const text = alias.trim()
    if (!text || !sync.householdId) return null

    const target = ingredientById(ingredientId)
    if (!target) return null
    if (normaliseIngredientName(target.name) === normaliseIngredientName(text)) return null

    const owner = resolve(text)
    if (owner && owner.id !== target.id) return null

    const id = aliasId(sync.householdId, target.id, text)
    const existing = allAliases.value.get(id)
    if (existing && !existing.deleted_at) return existing

    const timestamp = nowIso()
    return sync.commit('ingredient_aliases', {
      id,
      household_id: sync.householdId,
      ingredient_id: target.id,
      alias: text,
      deleted_at: null,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    })
  }

  async function updateIngredient(
    id: string,
    patch: Partial<Pick<IngredientRow, 'name' | 'base_unit' | 'aisle_id'>>
  ) {
    const current = all.value.get(id)
    if (!current) return
    return sync.commit('ingredients', { ...plainCopy(current), ...patch })
  }

  async function deleteIngredient(id: string) {
    const current = all.value.get(id)
    if (!current) return
    return sync.commit('ingredients', { ...plainCopy(current), deleted_at: nowIso() })
  }

  async function removeAlias(id: string) {
    const current = allAliases.value.get(id)
    if (!current) return
    return sync.commit('ingredient_aliases', { ...plainCopy(current), deleted_at: nowIso() })
  }

  async function addPurchaseUnit(ingredientId: string, input: { name: string, amount: number }) {
    const name = input.name.trim()
    if (!name || !sync.householdId || !(input.amount > 0)) return null
    const timestamp = nowIso()
    return sync.commit('ingredient_purchase_units', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      ingredient_id: ingredientId,
      name,
      amount: input.amount,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  async function updatePurchaseUnit(
    id: string,
    patch: Partial<Pick<PurchaseUnitRow, 'name' | 'amount'>>
  ) {
    const current = allUnits.value.get(id)
    if (!current) return
    return sync.commit('ingredient_purchase_units', { ...plainCopy(current), ...patch })
  }

  async function removePurchaseUnit(id: string) {
    const current = allUnits.value.get(id)
    if (!current) return
    return sync.commit('ingredient_purchase_units', { ...plainCopy(current), deleted_at: nowIso() })
  }

  /**
   * Fold one ingredient into another: "these were the same thing all along."
   *
   * Deliberately cheap. The loser keeps a pointer to the winner and everything
   * that referenced it is left alone — readers follow the pointer instead, which
   * is what makes this safe to do while somebody else's phone is offline holding
   * rows that still name the loser. Their rows converge as soon as they pull, with
   * no write from them and no backfill from us.
   *
   * Recipe lines are the exception, because they are what the next derive reads,
   * and pointing them at the winner now means the stamping stays right without
   * anyone having to open the recipe.
   */
  async function mergeIngredients(loserId: string, winnerId: string) {
    if (loserId === winnerId) return
    const loser = all.value.get(loserId)
    const winner = chaseMerge(winnerId, all.value)
    if (!loser || !winner || loser.id === winner.id) return

    const losersName = loser.name
    const losersAliases = aliasesFor(loser.id)

    for (const unit of purchaseUnitsFor(loser.id)) {
      await sync.commit('ingredient_purchase_units', {
        ...plainCopy(unit),
        ingredient_id: winner.id
      })
    }

    for (const line of sync.rowsOf('recipe_ingredients').values()) {
      if (line.deleted_at || line.ingredient_id !== loser.id) continue
      await sync.commit('recipe_ingredients', { ...plainCopy(line), ingredient_id: winner.id })
    }

    // Anything the winner has not been told yet, it can learn from the loser.
    if (!winner.aisle_id && loser.aisle_id) {
      await sync.commit('ingredients', { ...plainCopy(winner), aisle_id: loser.aisle_id })
    }

    // Retire the loser before touching aliases, and in this order for a reason:
    // recordAlias refuses to record text that already resolves to a different
    // ingredient, and while the loser is still live its own name resolves to
    // itself. Merging first makes that name resolve through the pointer to the
    // winner, so recording it is no longer a hijacking.
    await sync.commit('ingredients', {
      ...plainCopy(loser),
      merged_into: winner.id,
      deleted_at: nowIso()
    })

    // The loser's name is how somebody may well go looking for it again.
    await recordAlias(winner.id, losersName)

    for (const alias of losersAliases) {
      await recordAlias(winner.id, alias.alias)
      await removeAlias(alias.id)
    }
  }

  return {
    ingredients,
    aliases,
    purchaseUnits,
    ingredientById,
    aliasesFor,
    purchaseUnitsFor,
    resolve,
    suggest,
    ensureIngredient,
    recordAlias,
    updateIngredient,
    deleteIngredient,
    removeAlias,
    addPurchaseUnit,
    updatePurchaseUnit,
    removePurchaseUnit,
    mergeIngredients
  }
})
