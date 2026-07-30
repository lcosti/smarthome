import type { AppDatabase, Mutation, SyncTable, SyncedRow } from './db'

/** The shape of a PostgrestError, narrowed to what the drain loop needs. */
export interface SyncError {
  code?: string | null
  message?: string
}

export type UpsertFn = (table: SyncTable, payload: SyncedRow) => Promise<{ error: SyncError | null }>

export interface DrainHooks {
  /** Called once a row has no queued mutations left, i.e. it is fully synced. */
  onRowSettled?: (rowId: string) => void
  /** Called when a mutation is abandoned after MAX_SYNC_ATTEMPTS rejections. */
  onDropped?: (mutation: Mutation, error: SyncError) => void
}

export interface DrainResult {
  synced: number
  dropped: number
  /** True when the drain stopped early because the server was unreachable. */
  halted: boolean
}

export const MAX_SYNC_ATTEMPTS = 5

/**
 * A fresh plain copy. Rows are flat records of primitives, so a spread is a full
 * copy — and it strips the Vue reactive proxy, which IndexedDB cannot store.
 */
export function plainCopy<T extends object>(row: T): T {
  return { ...row }
}

/**
 * PostgREST rejections carry a code (a Postgres SQLSTATE, or a PGRST* code) and
 * will fail again identically no matter how often they are retried. A transport
 * failure carries no code, so it is treated as retryable — an unrecognised
 * failure must never cost someone their write.
 */
export function isPermanentSyncError(error: SyncError | null): boolean {
  return typeof error?.code === 'string' && error.code.length > 0
}

/**
 * Whether a row arriving from the server should overwrite local state. Applies to
 * every inbound path alike: the initial snapshot, realtime events, and the echoes
 * of our own upserts.
 *
 * Timestamps are parsed rather than string-compared, because Postgres returns
 * microsecond precision with a `+00:00` offset while the client writes
 * millisecond precision with a `Z` — lexically incomparable, same instant.
 */
export function shouldApplyServerRow(
  server: { id: string, updated_at: string },
  local: { updated_at: string } | undefined,
  queuedRowIds: ReadonlySet<string>
): boolean {
  // An edit that has not reached the server yet outranks anything the server says.
  if (queuedRowIds.has(server.id)) return false
  if (!local) return true
  return Date.parse(server.updated_at) >= Date.parse(local.updated_at)
}

/** Write a row to the local cache and queue it for the server, atomically. */
export async function enqueueMutation(db: AppDatabase, table: SyncTable, row: SyncedRow): Promise<void> {
  const cache = db.cacheFor(table)
  await db.transaction('rw', [cache, db.mutations], async () => {
    await cache.put(plainCopy(row) as never)
    await db.mutations.add({
      table,
      rowId: row.id,
      payload: plainCopy(row),
      ts: Date.now(),
      attempts: 0
    })
  })
}

/** Ids of every row with an unsynced write, used to guard against stale echoes. */
export async function queuedRowIds(db: AppDatabase): Promise<Set<string>> {
  const ids = new Set<string>()
  await db.mutations.each(m => ids.add(m.rowId))
  return ids
}

/**
 * Push queued writes to the server in the order they were made.
 *
 * On an unreachable server the queue is left completely intact and the drain
 * stops; the caller's triggers (reconnect, app focus, interval) are the retry
 * policy. A rejected write is counted and skipped rather than halting the queue,
 * so one bad row can never hold up the milk behind it.
 */
export async function drainQueue(db: AppDatabase, upsert: UpsertFn, hooks: DrainHooks = {}): Promise<DrainResult> {
  const result: DrainResult = { synced: 0, dropped: 0, halted: false }
  const queue = await db.mutations.orderBy('seq').toArray()

  for (const mutation of queue) {
    const { error } = await upsert(mutation.table, mutation.payload)

    if (!error) {
      await db.mutations.delete(mutation.seq!)
      result.synced++
      await settleRow(db, mutation.rowId, hooks)
      continue
    }

    if (!isPermanentSyncError(error)) {
      result.halted = true
      break
    }

    const attempts = mutation.attempts + 1
    if (attempts >= MAX_SYNC_ATTEMPTS) {
      await db.mutations.delete(mutation.seq!)
      result.dropped++
      hooks.onDropped?.(mutation, error)
      await settleRow(db, mutation.rowId, hooks)
    } else {
      await db.mutations.update(mutation.seq!, { attempts })
    }
  }

  return result
}

/**
 * A row stops being pending only once nothing else is queued against it —
 * otherwise a later queued edit would be exposed to being clobbered by the echo
 * of the earlier one.
 */
async function settleRow(db: AppDatabase, rowId: string, hooks: DrainHooks): Promise<void> {
  const remaining = await db.mutations.where('rowId').equals(rowId).count()
  if (remaining === 0) hooks.onRowSettled?.(rowId)
}
