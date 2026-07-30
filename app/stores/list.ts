import { defineStore } from 'pinia'
import type { AisleRow, ItemRow } from '../utils/db'
import { plainCopy } from '../utils/sync'
import { nowIso, useSyncStore } from './sync'

export interface AisleGroup {
  id: string
  name: string
  items: ItemRow[]
}

function normaliseName(name: string) {
  return name.trim().toLowerCase()
}

export const useListStore = defineStore('list', () => {
  const sync = useSyncStore()

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

  /**
   * Unchecked items grouped in the order the shop is walked. Anything whose aisle
   * is unset or has since been deleted falls into a trailing "Other" group, so no
   * item can ever become invisible.
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

    const byCreated = (a: ItemRow, b: ItemRow) => a.created_at.localeCompare(b.created_at)
    const result: AisleGroup[] = []

    for (const aisle of sortedAisles.value) {
      const bucket = byAisle.get(aisle.id)
      if (bucket?.length) result.push({ id: aisle.id, name: aisle.name, items: bucket.sort(byCreated) })
    }
    if (other.length) result.push({ id: 'other', name: 'Other', items: other.sort(byCreated) })

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
   * Null means the item was not added. Without a household there is nothing to
   * attach the row to, and callers have to be able to tell — a dropped write that
   * looks like a successful one is the worst thing this app can do.
   */
  async function addItem(rawName: string): Promise<ItemRow | null> {
    const name = rawName.trim()
    if (!name || !sync.householdId) return null
    const timestamp = nowIso()
    return sync.commit('shopping_list_items', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      name,
      quantity: null,
      aisle_id: rememberedAisle(name),
      checked: false,
      checked_at: null,
      source: 'adhoc',
      plan_entry_id: null,
      recipe_ingredient_id: null,
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
    sourceLabelFor,
    addItem,
    toggleItem,
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
