import { defineStore } from 'pinia'
import {
  db,
  SYNC_TABLE_NAMES,
  type AisleRow,
  type AttendanceRow,
  type DietaryConstraintRow,
  type IngredientAliasRow,
  type IngredientRow,
  type ItemRow,
  type PersonRow,
  type PlanEntryRow,
  type PurchaseUnitRow,
  type RecipeIngredientRow,
  type RecipeRow,
  type RowOf,
  type SyncTable
} from '../utils/db'
import {
  drainQueue,
  enqueueMutation,
  plainCopy,
  queuedRowIds,
  shouldApplyServerRow,
  type UpsertFn
} from '../utils/sync'

export function nowIso() {
  return new Date().toISOString()
}

/**
 * The offline layer, shared by every domain store.
 *
 * The mutation queue in IndexedDB is a single global FIFO across all tables, so
 * the state that tracks it has to be single too. If two stores each drained it,
 * each would only learn about the rows its own call happened to settle, and the
 * other's would stay marked pending forever. Hence: one queued set, one drain,
 * one connectivity state, here — and domain stores that hold nothing but their
 * own reads and writes.
 */
export const useSyncStore = defineStore('sync', () => {
  const maps = {
    people: ref(new Map<string, PersonRow>()),
    dietary_constraints: ref(new Map<string, DietaryConstraintRow>()),
    attendance: ref(new Map<string, AttendanceRow>()),
    aisles: ref(new Map<string, AisleRow>()),
    ingredients: ref(new Map<string, IngredientRow>()),
    ingredient_aliases: ref(new Map<string, IngredientAliasRow>()),
    ingredient_purchase_units: ref(new Map<string, PurchaseUnitRow>()),
    recipes: ref(new Map<string, RecipeRow>()),
    recipe_ingredients: ref(new Map<string, RecipeIngredientRow>()),
    meal_plan_entries: ref(new Map<string, PlanEntryRow>()),
    shopping_list_items: ref(new Map<string, ItemRow>())
  }

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

  function rowsOf<T extends SyncTable>(table: T): Map<string, RowOf[T]> {
    return maps[table].value as Map<string, RowOf[T]>
  }

  /** Load everything from IndexedDB. The app is fully usable once this resolves. */
  async function hydrate() {
    const [pending, ...cached] = await Promise.all([
      queuedRowIds(db),
      ...SYNC_TABLE_NAMES.map(table => db.cacheFor(table).toArray())
    ])
    SYNC_TABLE_NAMES.forEach((table, i) => {
      maps[table].value = new Map(cached[i]!.map(row => [row.id, row])) as never
    })
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
  async function commit<T extends SyncTable>(table: T, row: RowOf[T]): Promise<RowOf[T]> {
    const next = { ...plainCopy(row), updated_at: nowIso() }
    rowsOf(table).set(next.id, plainCopy(next))
    queued.value.add(next.id)
    await enqueueMutation(db, table, next)
    void drain()
    return next
  }

  function applyServerRow<T extends SyncTable>(table: T, row: RowOf[T]) {
    const local = rowsOf(table).get(row.id)
    if (!shouldApplyServerRow(row, local, queued.value)) return
    rowsOf(table).set(row.id, plainCopy(row))
    void db.cacheFor(table).put(plainCopy(row))
  }

  /** Wipe local state, e.g. when a different person signs in on a shared device. */
  async function reset() {
    for (const table of SYNC_TABLE_NAMES) maps[table].value = new Map() as never
    queued.value = new Set()
    householdId.value = null
    dropped.value = 0
    const caches = SYNC_TABLE_NAMES.map(table => db.cacheFor(table))
    await db.transaction('rw', [...caches, db.mutations], async () => {
      await Promise.all([...caches.map(cache => cache.clear()), db.mutations.clear()])
    })
  }

  return {
    maps,
    queued,
    householdId,
    hydrated,
    online,
    reachable,
    dropped,
    pendingCount,
    offline,
    rowsOf,
    hydrate,
    registerSync,
    sync,
    drain,
    commit,
    applyServerRow,
    reset
  }
})
