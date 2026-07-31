import { defineStore } from 'pinia'
import type { PantryItemRow } from '../utils/db'
import { pantryAvailable, pantryItemId, settleDuePantry } from '../utils/pantry'
import { formatBaseAmount, formatPurchase, type BaseUnit } from '../utils/quantity'
import { plainCopy } from '../utils/sync'
import { isoDate } from '../utils/week'
import { asBaseUnit, useIngredientsStore } from './ingredients'
import { nowIso, useSyncStore } from './sync'

/** A stocked ingredient, ready to render: the row plus what it is measured in. */
export interface PantryEntry {
  row: PantryItemRow
  ingredientId: string
  name: string
  baseUnit: BaseUnit
  onHand: number
  /** What is left after the nights already planned have taken their share. */
  available: number
  /** "800g · 2 tins", or just "2" for something counted. */
  label: string
}

export const usePantryStore = defineStore('pantry', () => {
  const sync = useSyncStore()
  const ingredients = useIngredientsStore()

  const all = computed(() => sync.rowsOf('pantry_items'))
  const allReservations = computed(() => sync.rowsOf('pantry_reservations'))

  const rows = computed(() => [...all.value.values()].filter(r => !r.deleted_at))
  const reservations = computed(() => [...allReservations.value.values()])

  /**
   * The ingredient a row is really about, following any merge.
   *
   * Two people recording onions before anybody tidied the library leaves stock on
   * both rows. Chasing the pointer at read time adds them up, and heals it with
   * no backfill and no write — exactly as the shopping list does for its own rows.
   */
  function canonical<T extends { ingredient_id: string }>(row: T): T {
    const id = ingredients.ingredientById(row.ingredient_id)?.id
    return id && id !== row.ingredient_id ? { ...row, ingredient_id: id } : row
  }

  /**
   * How much of each ingredient is genuinely free right now.
   *
   * What the shopping list and the recipe library both read, so that neither
   * offers the household onions that Thursday has already claimed.
   */
  const available = computed(() => pantryAvailable(
    rows.value.map(canonical),
    reservations.value.map(canonical),
    isoDate(new Date())
  ))

  /**
   * Stock as a page can show it: alphabetical, and only what is actually there.
   *
   * A row that has been run down to zero stays in the database — its id is derived
   * from the ingredient, so keeping it costs nothing and means the next deposit
   * lands back on the same row — but an empty shelf is not worth a line.
   */
  const stocked = computed<PantryEntry[]>(() =>
    rows.value
      .map((row) => {
        const ingredient = ingredients.ingredientById(row.ingredient_id)
        if (!ingredient) return null
        const baseUnit = asBaseUnit(ingredient.base_unit)
        const onHand = Number(row.on_hand)
        if (!Number.isFinite(onHand) || onHand <= 0) return null

        const parts = [formatBaseAmount(onHand, baseUnit)]
        const unit = ingredients.purchaseUnitsFor(ingredient.id)[0]
        if (unit && baseUnit !== 'count') {
          const purchase = formatPurchase(onHand, unit)
          if (purchase) parts.push(purchase)
        }

        return {
          row,
          ingredientId: ingredient.id,
          name: ingredient.name,
          baseUnit,
          onHand,
          available: available.value.get(ingredient.id) ?? 0,
          label: parts.join(' · ')
        } satisfies PantryEntry
      })
      .filter((entry): entry is PantryEntry => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  function onHandOf(ingredientId: string): number {
    if (!sync.householdId) return 0
    const row = all.value.get(pantryItemId(sync.householdId, ingredientId))
    if (!row || row.deleted_at) return 0
    const amount = Number(row.on_hand)
    return Number.isFinite(amount) ? amount : 0
  }

  /**
   * Say how much of something is in the house.
   *
   * A whole number every time, never a delta — which is what keeps the queue safe
   * to replay. "It is now four" landing twice is still four; "add two" landing
   * twice is two onions that do not exist.
   *
   * Null when there is no household to write against, for the same reason
   * {@link useListStore.addItem} returns null: a dropped write that looks like a
   * successful one is the worst thing this app can do.
   */
  async function setStock(ingredientId: string, baseAmount: number): Promise<PantryItemRow | null> {
    if (!sync.householdId || !Number.isFinite(baseAmount)) return null
    const id = pantryItemId(sync.householdId, ingredientId)
    const existing = all.value.get(id)
    const timestamp = nowIso()
    const onHand = Math.max(0, baseAmount)

    if (existing) {
      return sync.commit('pantry_items', {
        ...plainCopy(existing),
        on_hand: onHand,
        // Stock arriving on a row somebody had emptied and deleted brings it back,
        // rather than stranding the number on a row nothing reads.
        deleted_at: null
      })
    }

    return sync.commit('pantry_items', {
      id,
      household_id: sync.householdId,
      ingredient_id: ingredientId,
      on_hand: onHand,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  /** Read, add, write the whole number. The steppers on the pantry page. */
  async function adjust(ingredientId: string, deltaBase: number) {
    return setStock(ingredientId, onHandOf(ingredientId) + deltaBase)
  }

  /**
   * Put a shop away: several ingredients' worth of stock in one go.
   *
   * One write per ingredient rather than anything cleverer, because each is the
   * same idempotent upsert a single adjustment already is, and a shop is a few
   * dozen lines at most.
   */
  async function deposit(entries: { ingredientId: string, baseAmount: number }[]) {
    let saved = 0
    for (const entry of entries) {
      if (!(entry.baseAmount > 0)) continue
      const result = await adjust(entry.ingredientId, entry.baseAmount)
      if (result) saved++
    }
    return saved
  }

  /**
   * Take what has been eaten off the shelf.
   *
   * Called on hydration and before each derive. Safe to call as often as it likes
   * — a settled reservation is skipped forever after — so nothing here needs to
   * know whether another device got there first.
   */
  async function settleDue() {
    if (!sync.householdId) return 0

    const byIngredient = new Map<string, PantryItemRow>()
    for (const row of rows.value) byIngredient.set(row.ingredient_id, row)

    const { pantryUpdates, settled } = settleDuePantry({
      today: isoDate(new Date()),
      reservations: reservations.value,
      pantryByIngredient: byIngredient,
      now: nowIso()
    })

    for (const row of pantryUpdates) await sync.commit('pantry_items', row)
    for (const row of settled) await sync.commit('pantry_reservations', row)
    return settled.length
  }

  return {
    rows,
    reservations,
    available,
    stocked,
    onHandOf,
    setStock,
    adjust,
    deposit,
    settleDue
  }
})
