import { defineStore } from 'pinia'
import type { AggregateContext, ListEntry } from '../utils/aggregate'
import { buildEntries } from '../utils/aggregate'
import { guessAisleId } from '../utils/aisles'
import type { AisleRow, ItemRow } from '../utils/db'
import { lineNeedBase } from '../utils/pantry'
import { plainCopy } from '../utils/sync'
import { asBaseUnit, useIngredientsStore } from './ingredients'
import { usePantryStore } from './pantry'
import { usePeopleStore } from './people'
import { nowIso, useSyncStore } from './sync'

export interface AisleGroup {
  id: string
  name: string
  entries: ListEntry<ItemRow>[]
}

/**
 * One aisle as the list page draws it: what is left to get, what has already
 * gone in the trolley, and how far through it that is.
 *
 * The counts are over rows rather than aggregated lines, because "3 of 19" has
 * to mean the same number the rest of the app says. A line that collapsed two
 * rows is still two things somebody has to pick up.
 */
export interface AisleSection extends AisleGroup {
  /** Ticked rows in this aisle, newest first. Never aggregated — see `entries`. */
  checked: ItemRow[]
  done: number
  total: number
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
  const pantry = usePantryStore()
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
    purchaseUnits: ingredients.purchaseUnits,
    // What is in the house, minus what the nights ahead have already claimed. An
    // empty map — the usual case until somebody records some stock — leaves every
    // line reading exactly as it did before the pantry existed.
    pantry: pantry.available
  }))

  /**
   * The list as aisle cards, in the order the shop is walked. Anything whose
   * aisle is unset or has since been deleted falls into a trailing "Other"
   * section, so no item can ever become invisible.
   *
   * Unchecked rows are collapsed into lines per aisle, after bucketing, so an
   * ingredient somebody deliberately filed in two places stays in both. Checked
   * rows are not collapsed: once something is in the trolley the question is no
   * longer "how much of this do I need", and un-ticking one row of a merged line
   * would have to guess which row it was.
   *
   * An aisle stays here once everything in it is ticked. Cleared aisles used to
   * vanish, which read as "you have not been down there yet" — the opposite of
   * what had happened.
   */
  const sections = computed<AisleSection[]>(() => {
    const unchecked = new Map<string, ItemRow[]>()
    const checked = new Map<string, ItemRow[]>()

    for (const item of liveItems.value) {
      const aisle = item.aisle_id ? aisles.value.get(item.aisle_id) : undefined
      const key = !aisle || aisle.deleted_at ? 'other' : aisle.id
      const into = item.checked ? checked : unchecked
      const bucket = into.get(key)
      if (bucket) bucket.push(item)
      else into.set(key, [item])
    }

    const context = aggregateContext.value

    const build = (id: string, name: string): AisleSection | null => {
      const todo = unchecked.get(id) ?? []
      const done = (checked.get(id) ?? []).sort((a, b) =>
        (b.checked_at ?? '').localeCompare(a.checked_at ?? '')
      )
      if (!todo.length && !done.length) return null
      return {
        id,
        name,
        entries: buildEntries(todo, context),
        checked: done,
        done: done.length,
        total: todo.length + done.length
      }
    }

    const result: AisleSection[] = []
    for (const aisle of sortedAisles.value) {
      const section = build(aisle.id, aisle.name)
      if (section) result.push(section)
    }
    const other = build('other', 'Other')
    if (other) result.push(other)

    return result
  })

  /**
   * The aisles with something still to get. What the board's compact list wants,
   * and what the page wanted before ticked rows stayed in place.
   */
  const groups = computed<AisleGroup[]>(() =>
    sections.value.filter(section => section.entries.length)
  )

  /** How far through the shop this is, over rows rather than collapsed lines. */
  const progress = computed(() => {
    const total = liveItems.value.length
    const done = liveItems.value.filter(i => i.checked).length
    return { done, total, fraction: total ? done / total : 0 }
  })

  /**
   * Base units of each ingredient the list is currently asking for.
   *
   * The raw demand, before the cupboard has had its say — what the recipes want,
   * not what is left to buy. Used to show somebody putting a shop away what the
   * list expected of a line, so a mis-parsed "1kg" stands out beside it.
   */
  const neededByIngredient = computed(() => {
    const totals = new Map<string, number>()
    const context = aggregateContext.value
    for (const item of liveItems.value) {
      if (item.checked || !item.ingredient_id) continue
      const ingredient = context.ingredients.get(item.ingredient_id)
      if (!ingredient) continue
      const amount = lineNeedBase(
        item.quantity,
        ingredient.base_unit,
        ingredients.purchaseUnitsFor(ingredient.id)
      )
      if (amount === null) continue
      totals.set(ingredient.id, (totals.get(ingredient.id) ?? 0) + amount)
    }
    return totals
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
    // In order of how much this household actually knows: its own canonical
    // ingredient, then where this name went last time, and only then a guess
    // from the built-in list. Anything learned beats anything assumed, so filing
    // something by hand once is permanent.
    return ingredients.resolve(name)?.aisle_id
      ?? rememberedAisle(name)
      ?? guessAisleId(name, aisles.value.values())
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
    if (!entry?.recipe_id) return null
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
    sections,
    groups,
    progress,
    neededByIngredient,
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
