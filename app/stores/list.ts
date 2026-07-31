import { defineStore } from 'pinia'
import type { AggregateContext, ListEntry } from '../utils/aggregate'
import { buildEntries } from '../utils/aggregate'
import type { AisleRow, ItemRow } from '../utils/db'
import { plainCopy } from '../utils/sync'
import { asBaseUnit, useIngredientsStore } from './ingredients'
import { usePeopleStore } from './people'
import { nowIso, useSyncStore } from './sync'

export interface AisleGroup {
  id: string
  name: string
  entries: ListEntry<ItemRow>[]
}

/**
 * The parts of a shopping list item a person can actually decide. Everything
 * else on the row is provenance the app fills in — where it came from, who
 * added it, which ingredient it resolved to — and is not a field to offer.
 */
export interface NewItemFields {
  quantity?: string | null
  aisleId?: string | null
}

function normaliseName(name: string) {
  return name.trim().toLowerCase()
}

export const useListStore = defineStore('list', () => {
  const sync = useSyncStore()
  const ingredients = useIngredientsStore()
  const people = usePeopleStore()

  const items = computed(() => sync.rowsOf('shopping_list_items'))
  const aisles = computed(() => sync.rowsOf('aisles'))

  const sortedAisles = computed(() =>
    [...aisles.value.values()]
      .filter(a => !a.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  )

  const liveItems = computed(() => [...items.value.values()].filter(i => !i.deleted_at))

  const checkedItems = computed(() =>
    liveItems.value
      .filter(i => i.checked)
      .sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''))
  )

  /** What buildEntries needs to add quantities up, in the shapes it reads. */
  const aggregateContext = computed<AggregateContext>(() => ({
    ingredients: new Map(
      [...ingredients.allRows.values()].map(row => [row.id, { ...row, base_unit: asBaseUnit(row.base_unit) }])
    ),
    purchaseUnits: ingredients.purchaseUnits
  }))

  /**
   * Unchecked items grouped in the order the shop is walked, then collapsed into
   * the lines to show. Anything whose aisle is unset or has since been deleted
   * falls into a trailing "Other" group, so no item can ever become invisible.
   *
   * Collapsing happens per aisle, after bucketing, so an ingredient somebody
   * deliberately filed in two places stays in both.
   */
  const groups = computed<AisleGroup[]>(() => {
    const unchecked = liveItems.value.filter(i => !i.checked)
    const byAisle = new Map<string, ItemRow[]>()
    const other: ItemRow[] = []

    for (const item of unchecked) {
      const aisle = item.aisle_id ? aisles.value.get(item.aisle_id) : undefined
      if (!aisle || aisle.deleted_at) {
        other.push(item)
        continue
      }
      const bucket = byAisle.get(aisle.id)
      if (bucket) bucket.push(item)
      else byAisle.set(aisle.id, [item])
    }

    const context = aggregateContext.value
    const result: AisleGroup[] = []

    for (const aisle of sortedAisles.value) {
      const bucket = byAisle.get(aisle.id)
      if (bucket?.length) {
        result.push({ id: aisle.id, name: aisle.name, entries: buildEntries(bucket, context) })
      }
    }
    if (other.length) {
      result.push({ id: 'other', name: 'Other', entries: buildEntries(other, context) })
    }

    return result
  })

  /**
   * The aisle this item was filed under last time. Nobody should have to tell the
   * app that milk lives in Chilled more than once.
   */
  function rememberedAisle(name: string): string | null {
    const key = normaliseName(name)
    let best: ItemRow | undefined
    for (const row of items.value.values()) {
      if (!row.aisle_id || normaliseName(row.name) !== key) continue
      if (!best || row.updated_at > best.updated_at) best = row
    }
    return best?.aisle_id ?? null
  }

  /**
   * The aisle a new item would be filed under if nobody said otherwise: what the
   * household's canonical ingredient says, else wherever this name went last
   * time.
   *
   * Exposed rather than kept private to {@link addItem} so a form can show the
   * guess as an already-selected chip. Filing something invisibly and filing it
   * in front of somebody are different acts — the second one is correctable.
   */
  function suggestedAisle(name: string): string | null {
    return ingredients.resolve(name)?.aisle_id ?? rememberedAisle(name)
  }

  /**
   * Why a derived item is on the list, resolved through the plan entry back to the
   * recipe. Read from local state rather than stored on the item, so it stays
   * right when a recipe is renamed — and it still works offline, because
   * soft-deleted recipes remain cached.
   */
  function sourceLabelFor(item: ItemRow): string | null {
    if (!item.plan_entry_id) return null
    const entry = sync.rowsOf('meal_plan_entries').get(item.plan_entry_id)
    if (!entry) return null
    return sync.rowsOf('recipes').get(entry.recipe_id)?.name ?? null
  }

  /**
   * The recipes behind a grouped line: "Chilli · Pasta bake". Deduplicated,
   * because the same recipe on two nights is one reason, not two.
   */
  function sourceLabelForEntry(entry: ListEntry<ItemRow>): string | null {
    const names = new Set<string>()
    for (const item of entry.items) {
      const label = sourceLabelFor(item)
      if (label) names.add(label)
    }
    return names.size ? [...names].join(' · ') : null
  }

  /**
   * Null means the item was not added. Without a household there is nothing to
   * attach the row to, and callers have to be able to tell — a dropped write that
   * looks like a successful one is the worst thing this app can do.
   *
   * Everything past the name is optional, because the fast path has to stay one
   * field and one press. `aisleId` is deliberately three-valued: omitted takes
   * {@link suggestedAisle}, whereas an explicit `null` is somebody choosing
   * "Other" and must survive a guess that disagrees.
   */
  async function addItem(rawName: string, fields: NewItemFields = {}): Promise<ItemRow | null> {
    const name = rawName.trim()
    if (!name || !sync.householdId) return null
    // Resolved if the household already knows this name, but never created: the
    // canonical list is for things recipes are made of, and "bin bags" is not one.
    // Resolving is still worth it — milk typed onto the list should join the milk
    // the plan already asked for rather than sit beside it.
    const ingredient = ingredients.resolve(name)
    const timestamp = nowIso()
    return sync.commit('shopping_list_items', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      name,
      quantity: fields.quantity?.trim() || null,
      aisle_id: 'aisleId' in fields ? fields.aisleId ?? null : suggestedAisle(name),
      checked: false,
      checked_at: null,
      source: 'adhoc',
      plan_entry_id: null,
      recipe_ingredient_id: null,
      ingredient_id: ingredient?.id ?? null,
      // Who to credit on the wall board. Null from the shared tablet, which is
      // nobody in particular — the board simply omits the line rather than
      // guessing.
      added_by: people.me?.id ?? null,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  async function toggleItem(id: string) {
    const current = items.value.get(id)
    if (!current) return
    const checked = !current.checked
    await sync.commit('shopping_list_items', {
      ...plainCopy(current),
      checked,
      checked_at: checked ? nowIso() : null
    })
  }

  /**
   * Tick a whole line off, however many rows are behind it.
   *
   * One write per row rather than anything cleverer, because each is the same
   * idempotent upsert ticking one item already is, and a group is two or three
   * rows in practice. If the drain halts halfway, another device sees a smaller
   * remaining total, which is coherent, and it settles on the next drain.
   */
  async function toggleEntry(entry: ListEntry<ItemRow>) {
    const checked = !entry.items.every(i => i.checked)
    const at = checked ? nowIso() : null
    for (const item of entry.items) {
      const current = items.value.get(item.id)
      if (!current || current.checked === checked) continue
      await sync.commit('shopping_list_items', { ...plainCopy(current), checked, checked_at: at })
    }
  }

  async function updateItem(id: string, patch: Partial<Pick<ItemRow, 'name' | 'quantity' | 'aisle_id'>>) {
    const current = items.value.get(id)
    if (!current) return
    await sync.commit('shopping_list_items', { ...plainCopy(current), ...patch })
  }

  async function deleteItem(id: string) {
    const current = items.value.get(id)
    if (!current) return
    await sync.commit('shopping_list_items', { ...plainCopy(current), deleted_at: nowIso() })
  }

  async function clearChecked() {
    for (const item of checkedItems.value) {
      await sync.commit('shopping_list_items', { ...plainCopy(item), deleted_at: nowIso() })
    }
  }

  /** Null for the same reason as {@link addItem}. */
  async function addAisle(rawName: string): Promise<AisleRow | null> {
    const name = rawName.trim()
    if (!name || !sync.householdId) return null
    const timestamp = nowIso()
    const highest = sortedAisles.value.reduce((max, a) => Math.max(max, a.sort_order), 0)
    return sync.commit('aisles', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      name,
      sort_order: highest + 1,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  async function renameAisle(id: string, rawName: string) {
    const current = aisles.value.get(id)
    const name = rawName.trim()
    if (!current || !name) return
    await sync.commit('aisles', { ...plainCopy(current), name })
  }

  async function deleteAisle(id: string) {
    const current = aisles.value.get(id)
    if (!current) return
    await sync.commit('aisles', { ...plainCopy(current), deleted_at: nowIso() })
  }

  /** Swap sort_order with the neighbour, so the list matches the actual store. */
  async function moveAisle(id: string, direction: -1 | 1) {
    const ordered = sortedAisles.value
    const index = ordered.findIndex(a => a.id === id)
    const target = ordered[index + direction]
    const current = ordered[index]
    if (!current || !target) return
    await sync.commit('aisles', { ...plainCopy(current), sort_order: target.sort_order })
    await sync.commit('aisles', { ...plainCopy(target), sort_order: current.sort_order })
  }

  return {
    items,
    aisles,
    sortedAisles,
    liveItems,
    checkedItems,
    groups,
    rememberedAisle,
    suggestedAisle,
    sourceLabelFor,
    sourceLabelForEntry,
    addItem,
    toggleItem,
    toggleEntry,
    updateItem,
    deleteItem,
    clearChecked,
    addAisle,
    renameAisle,
    deleteAisle,
    moveAisle
  }
})

export type { AisleRow, ItemRow }
