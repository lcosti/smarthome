import { defineStore } from 'pinia'
import {
  db,
  SYNC_TABLE_NAMES,
  WRITABLE_TABLE_NAMES,
  type AisleRow,
  type AttendanceRow,
  type CalendarEventRow,
  type DietaryConstraintRow,
  type IngredientAliasRow,
  type IngredientRow,
  type ItemRow,
  type PantryItemRow,
  type PantryReservationRow,
  type PersonRow,
  type PlanEntryRow,
  type PurchaseUnitRow,
  type RecipeIngredientRow,
  type RecipeRow,
  type RecipeStepRow,
  type RowOf,
  type SyncTable
} from '../utils/db'
import { clearLastSyncedAt, readLastSyncedAt, writeLastSyncedAt } from '../utils/last-synced'
import {
  drainQueue,
  enqueueMutation,
  plainCopy,
  queuedRowIds,
  rowsNeedingRequeue,
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
    pantry_items: ref(new Map<string, PantryItemRow>()),
    recipes: ref(new Map<string, RecipeRow>()),
    recipe_ingredients: ref(new Map<string, RecipeIngredientRow>()),
    recipe_steps: ref(new Map<string, RecipeStepRow>()),
    meal_plan_entries: ref(new Map<string, PlanEntryRow>()),
    pantry_reservations: ref(new Map<string, PantryReservationRow>()),
    shopping_list_items: ref(new Map<string, ItemRow>()),
    calendar_events: ref(new Map<string, CalendarEventRow>())
  }

  /** Rows with a write that has not reached the server yet. */
  const queued = ref(new Set<string>())
  const householdId = ref<string | null>(null)
  const hydrated = ref(false)
  /** What the browser claims. Unreliable behind captive portals and weak signal. */
  const online = ref(true)
  /** What we last observed for ourselves: did a write actually get through? */
  const reachable = ref(true)
  /** When the last full pull completed. What a stale board reports about itself. */
  const lastSyncedAt = ref<string | null>(null)
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
    lastSyncedAt.value = readLastSyncedAt()
    hydrated.value = true
  }

  /**
   * Record that a full pull just landed.
   *
   * Only `pull` calls this, never an inbound realtime row: one row arriving says
   * that row is current, not that everything on screen is.
   */
  function markSynced() {
    const at = nowIso()
    lastSyncedAt.value = at
    writeLastSyncedAt(at)
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
        onDropped: (mutation, error) => {
          // Losing a write is the one failure in this app that costs somebody
          // something, and the toast it raises is deliberately too short to say
          // why. Log the whole thing: which row, and the code the server gave —
          // without it a dropped write is unattributable after the fact.
          console.error(
            'sync dropped a write', mutation.table, mutation.rowId,
            error.code, error.message, mutation.payload
          )
          // Take the row out with the write. Keeping it would leave something
          // that reads exactly like a synced row but exists nowhere else: it is
          // handed out as a foreign key by resolve/linkFor, and every child
          // written against it is rejected in turn, so one lost row quietly
          // becomes a growing batch of them. The server is the authority, so
          // anything real comes back on the next pull.
          rowsOf(mutation.table).delete(mutation.rowId)
          void db.cacheFor(mutation.table).delete(mutation.rowId)
        }
      })
      // Once for the whole drain, not once per row. A batch that fails tends to
      // fail together — five rows queued at the same moment reach the attempt
      // limit on the same pass — and five separate increments mean five separate
      // toasts burying the screen. One bump gives the watcher a delta it can
      // report as a single message.
      if (result.dropped > 0) dropped.value += result.dropped
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

  /**
   * Queue every local row a completed pull did not bring back.
   *
   * Repairs a device that lost writes: the mutation was discarded but the row
   * stayed in the cache, so it survives as something that looks synced and is
   * not. Given the full server picture, the rows it does not mention are ones
   * that never landed, and pushing them again is the only way they ever will.
   *
   * Called only after a pull that fully succeeded — a partial one would read as
   * "the server has nothing" and queue the entire database. Server-owned tables
   * are skipped: their rows are pruned with a real delete, so a missing one means
   * gone rather than never sent.
   */
  async function requeueStranded(serverIds: Record<SyncTable, Set<string>>) {
    let count = 0
    for (const table of WRITABLE_TABLE_NAMES) {
      const stranded = rowsNeedingRequeue(rowsOf(table).values(), serverIds[table], queued.value)
      for (const row of stranded) {
        queued.value.add(row.id)
        await enqueueMutation(db, table, row)
        count++
      }
    }
    if (count > 0) {
      console.warn('sync re-queued rows the server did not have', count)
      void drain()
    }
    return count
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
    lastSyncedAt.value = null
    clearLastSyncedAt()
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
    lastSyncedAt,
    dropped,
    pendingCount,
    offline,
    rowsOf,
    hydrate,
    markSynced,
    registerSync,
    sync,
    drain,
    commit,
    requeueStranded,
    applyServerRow,
    reset
  }
})
