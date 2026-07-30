import { defineStore } from 'pinia'
import { db, type AisleRow, type ItemRow, type SyncTable, type SyncedRow } from '../utils/db'
import {
  cacheTableFor,
  drainQueue,
  enqueueMutation,
  plainCopy,
  queuedRowIds,
  shouldApplyServerRow,
  type UpsertFn
} from '../utils/sync'

export interface AisleGroup {
  id: string
  name: string
  items: ItemRow[]
}

function nowIso() {
  return new Date().toISOString()
}

function normaliseName(name: string) {
  return name.trim().toLowerCase()
}

export const useListStore = defineStore('list', () => {
  const items = ref(new Map<string, ItemRow>())
  const aisles = ref(new Map<string, AisleRow>())
  /** Rows with a write that has not reached the server yet. */
  const queued = ref(new Set<string>())
  const householdId = ref<string | null>(null)
  const hydrated = ref(false)
  /** What the browser claims. Unreliable behind captive portals and weak signal. */
  const online = ref(true)
  /** What we last observed for ourselves: did a write actually get through? */
  const reachable = ref(true)
  const dropped = ref(0)
  let draining = false

  // Supplied by useSync once a Supabase client exists, so that the store can push
  // its own writes and ask for a refresh without knowing anything about Supabase.
  let upsert: UpsertFn | null = null
  let connect: (() => Promise<void>) | null = null

  const pendingCount = computed(() => queued.value.size)
  const offline = computed(() => !online.value || !reachable.value)

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

  function applyLocal(table: SyncTable, row: SyncedRow) {
    if (table === 'aisles') aisles.value.set(row.id, row as AisleRow)
    else items.value.set(row.id, row as ItemRow)
  }

  /** Load everything from IndexedDB. The app is fully usable once this resolves. */
  async function hydrate() {
    const [cachedItems, cachedAisles, pending] = await Promise.all([
      db.items.toArray(),
      db.aisles.toArray(),
      queuedRowIds(db)
    ])
    items.value = new Map(cachedItems.map(r => [r.id, r]))
    aisles.value = new Map(cachedAisles.map(r => [r.id, r]))
    queued.value = pending
    hydrated.value = true
  }

  function registerSync(fns: { upsert: UpsertFn | null, connect: (() => Promise<void>) | null }) {
    upsert = fns.upsert
    connect = fns.connect
  }

  /** Ask the sync layer to push and pull now, e.g. after joining a household. */
  async function sync() {
    await connect?.()
  }

  async function drain() {
    if (!upsert || draining) return
    draining = true
    try {
      const result = await drainQueue(db, upsert, {
        onRowSettled: id => queued.value.delete(id),
        onDropped: () => dropped.value++
      })
      if (result.halted) reachable.value = false
      else if (result.synced > 0 || result.dropped > 0) reachable.value = true
    } finally {
      draining = false
    }
  }

  /**
   * The single write path: apply optimistically, persist, queue, then try to push.
   * Three separate plain copies so that nothing reactive reaches IndexedDB and
   * later edits to local state cannot mutate an already-queued payload.
   */
  async function commit(table: SyncTable, row: SyncedRow) {
    const next = { ...plainCopy(row), updated_at: nowIso() }
    applyLocal(table, plainCopy(next))
    queued.value.add(next.id)
    await enqueueMutation(db, table, next)
    void drain()
    return next
  }

  function applyServerRow(table: SyncTable, row: SyncedRow) {
    const local = table === 'aisles' ? aisles.value.get(row.id) : items.value.get(row.id)
    if (!shouldApplyServerRow(row, local, queued.value)) return
    applyLocal(table, plainCopy(row))
    void cacheTableFor(db, table).put(plainCopy(row) as never)
  }

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

  async function addItem(rawName: string) {
    const name = rawName.trim()
    if (!name || !householdId.value) return
    const timestamp = nowIso()
    return commit('shopping_list_items', {
      id: crypto.randomUUID(),
      household_id: householdId.value,
      name,
      quantity: null,
      aisle_id: rememberedAisle(name),
      checked: false,
      checked_at: null,
      source: 'adhoc',
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  async function toggleItem(id: string) {
    const current = items.value.get(id)
    if (!current) return
    const checked = !current.checked
    await commit('shopping_list_items', {
      ...plainCopy(current),
      checked,
      checked_at: checked ? nowIso() : null
    })
  }

  async function updateItem(id: string, patch: Partial<Pick<ItemRow, 'name' | 'quantity' | 'aisle_id'>>) {
    const current = items.value.get(id)
    if (!current) return
    await commit('shopping_list_items', { ...plainCopy(current), ...patch })
  }

  async function deleteItem(id: string) {
    const current = items.value.get(id)
    if (!current) return
    await commit('shopping_list_items', { ...plainCopy(current), deleted_at: nowIso() })
  }

  async function clearChecked() {
    for (const item of checkedItems.value) {
      await commit('shopping_list_items', { ...plainCopy(item), deleted_at: nowIso() })
    }
  }

  async function addAisle(rawName: string) {
    const name = rawName.trim()
    if (!name || !householdId.value) return
    const timestamp = nowIso()
    const highest = sortedAisles.value.reduce((max, a) => Math.max(max, a.sort_order), 0)
    return commit('aisles', {
      id: crypto.randomUUID(),
      household_id: householdId.value,
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
    await commit('aisles', { ...plainCopy(current), name })
  }

  async function deleteAisle(id: string) {
    const current = aisles.value.get(id)
    if (!current) return
    await commit('aisles', { ...plainCopy(current), deleted_at: nowIso() })
  }

  /** Swap sort_order with the neighbour, so the list matches the actual store. */
  async function moveAisle(id: string, direction: -1 | 1) {
    const ordered = sortedAisles.value
    const index = ordered.findIndex(a => a.id === id)
    const target = ordered[index + direction]
    const current = ordered[index]
    if (!current || !target) return
    await commit('aisles', { ...plainCopy(current), sort_order: target.sort_order })
    await commit('aisles', { ...plainCopy(target), sort_order: current.sort_order })
  }

  /** Wipe local state, e.g. when a different person signs in on a shared device. */
  async function reset() {
    items.value = new Map()
    aisles.value = new Map()
    queued.value = new Set()
    householdId.value = null
    dropped.value = 0
    await db.transaction('rw', [db.items, db.aisles, db.mutations], async () => {
      await db.items.clear()
      await db.aisles.clear()
      await db.mutations.clear()
    })
  }

  return {
    items,
    aisles,
    queued,
    householdId,
    hydrated,
    online,
    reachable,
    dropped,
    pendingCount,
    offline,
    sortedAisles,
    liveItems,
    checkedItems,
    groups,
    hydrate,
    registerSync,
    sync,
    drain,
    applyServerRow,
    addItem,
    toggleItem,
    updateItem,
    deleteItem,
    clearChecked,
    addAisle,
    renameAisle,
    deleteAisle,
    moveAisle,
    reset
  }
})
