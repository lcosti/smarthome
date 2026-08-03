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
import { intrinsicBaseUnit, parseQuantity, type BaseUnit } from '../utils/quantity'
import { shoppingName } from '../utils/shopping-name'
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

/**
 * What the quantity on a line implies about how its ingredient is measured.
 *
 * Asks the parser's own unit table rather than keeping a second list here: a
 * hand-maintained subset once let "1 kilogram potatoes" create a counted
 * ingredient that no weight line could ever aggregate with.
 */
function inferBaseUnit(quantity: string | null | undefined): BaseUnit {
  return intrinsicBaseUnit(parseQuantity(quantity)?.unit) ?? 'count'
}

/**
 * What a canonical ingredient is called, given how a recipe wrote it.
 *
 * The same transform the shopping list uses, applied one step earlier. A recipe
 * line is the cook's wording and stays so; the library row behind it is the
 * thing on a shelf, and a row called "ground coriander, plus extra to serve" is
 * a row nothing else will ever resolve to — which is the whole point of having a
 * canonical list.
 */
export function canonicalIngredientName(raw: string): string {
  return shoppingName(raw, { alternatives: 'first' }).trim()
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

  /**
   * As `resolve`, then again on the tidied name.
   *
   * Two passes rather than one because the library holds both kinds of row: the
   * ones minted before names were canonicalised, under whatever the recipe said,
   * and the ones minted since. Asking as-written first means an old row still
   * answers to its own name rather than being passed over for a new one.
   */
  function resolveTidied(name: string): IngredientRow | undefined {
    const direct = resolve(name)
    if (direct) return direct
    const tidied = canonicalIngredientName(name)
    return tidied && tidied !== name.trim() ? resolve(tidied) : undefined
  }

  function suggest(query: string, limit = 6): Suggestion<IngredientRow>[] {
    return suggestIngredients(query, all.value, aliases.value, limit)
  }

  /**
   * The ingredient this name means, creating one if nothing does yet.
   *
   * Called as somebody presses enter on a recipe line, so it has to be silent and
   * it has to be cheap. The base unit is guessed from the quantity beside the name
   * — "400g" makes it a weight — and can be corrected later on /ingredients
   * without touching anything that points here.
   *
   * A new row is filed under the tidied name, and the wording that produced it is
   * recorded as an alias, so the next recipe writing it the long way resolves
   * here instead of minting a second row.
   */
  async function ensureIngredient(name: string, options: {
    quantity?: string | null
    aisleId?: string | null
  } = {}): Promise<IngredientRow | null> {
    const trimmed = name.trim()
    if (!trimmed || !sync.householdId) return null

    const existing = resolveTidied(trimmed)
    if (existing) return existing

    const canonical = canonicalIngredientName(trimmed) || trimmed
    const timestamp = nowIso()
    const created = await sync.commit('ingredients', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      name: canonical,
      base_unit: inferBaseUnit(options.quantity),
      aisle_id: options.aisleId ?? null,
      merged_into: null,
      // Nothing is a staple until somebody says so. A recipe line appearing for
      // the first time is exactly the case where the app knows least.
      staple: false,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })

    if (created && canonical !== trimmed) await recordAlias(created.id, trimmed)
    return created
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

  /**
   * Learn how something is measured from a quantity that arrived after the fact.
   *
   * Needed because the two facts turn up at different moments: the name is typed
   * into the quick-add, where there is deliberately nowhere to put a quantity, and
   * the quantity is set a tap later in the editor. Guessing only at creation left
   * every ingredient as 'count', and 'count' cannot absorb "400g" — so nothing
   * grouped, which is the entire point of the feature.
   *
   * Only ever upgrades away from the 'count' default, and only when the quantity
   * genuinely names a weight or a volume. A unit somebody chose on /ingredients is
   * never overruled.
   */
  async function refineBaseUnit(ingredientId: string, quantity: string | null | undefined) {
    if (!quantity) return
    const current = all.value.get(ingredientId)
    if (!current || current.base_unit !== 'count') return
    const inferred = inferBaseUnit(quantity)
    if (inferred === 'count') return
    await updateIngredient(ingredientId, { base_unit: inferred })
  }

  /**
   * The ingredient id to stamp on something somebody has just typed.
   *
   * The one place the three entry points agree, so that a recipe line, a line
   * edit and an ad-hoc list item all canonicalise the same way.
   *
   * When they picked a suggestion, what they typed becomes an alias — that is how
   * the app learns "tinned tomatoes" without anybody being asked to teach it. When
   * they just pressed enter, `create` decides whether an unknown name is worth a
   * canonical row: yes from a recipe, where it is an ingredient by definition, and
   * no from the shopping list, where "bin bags" is not.
   */
  async function linkFor(typed: string, options: {
    chosen?: IngredientRow | null
    quantity?: string | null
    aisleId?: string | null
    create?: boolean
  } = {}): Promise<string | null> {
    const name = typed.trim()
    if (!name) return null

    if (options.chosen) {
      await recordAlias(options.chosen.id, name)
      await refineBaseUnit(options.chosen.id, options.quantity)
      return options.chosen.id
    }

    if (options.create === false) {
      const found = resolveTidied(name)
      if (found) await refineBaseUnit(found.id, options.quantity)
      return found?.id ?? null
    }

    const ingredient = await ensureIngredient(name, {
      quantity: options.quantity,
      aisleId: options.aisleId
    })
    if (ingredient) await refineBaseUnit(ingredient.id, options.quantity)
    return ingredient?.id ?? null
  }

  async function updateIngredient(
    id: string,
    patch: Partial<Pick<IngredientRow, 'name' | 'base_unit' | 'aisle_id' | 'staple'>>
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
    /**
     * Every ingredient row, merged-away ones included. Grouping needs them: a
     * list item may still name an ingredient that has since been folded into
     * another, and following that pointer is what heals it.
     */
    allRows: all,
    ingredients,
    aliases,
    purchaseUnits,
    ingredientById,
    aliasesFor,
    purchaseUnitsFor,
    resolve,
    resolveTidied,
    suggest,
    ensureIngredient,
    recordAlias,
    linkFor,
    updateIngredient,
    deleteIngredient,
    removeAlias,
    addPurchaseUnit,
    updatePurchaseUnit,
    removePurchaseUnit,
    mergeIngredients
  }
})
