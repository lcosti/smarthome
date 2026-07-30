import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, type ItemRow, type SyncTable, type SyncedRow } from '../app/utils/db'
import {
  MAX_SYNC_ATTEMPTS,
  drainQueue,
  enqueueMutation,
  isPermanentSyncError,
  queuedRowIds,
  shouldApplyServerRow,
  type SyncError,
  type UpsertFn
} from '../app/utils/sync'

const HOUSEHOLD = '11111111-1111-1111-1111-111111111111'

function item(overrides: Partial<ItemRow> = {}): ItemRow {
  const stamp = '2026-07-30T10:00:00.000Z'
  return {
    id: 'b0000000-0000-0000-0000-000000000001',
    household_id: HOUSEHOLD,
    name: 'Milk',
    quantity: null,
    aisle_id: null,
    checked: false,
    checked_at: null,
    source: 'adhoc',
    deleted_at: null,
    created_at: stamp,
    updated_at: stamp,
    ...overrides
  }
}

/** A network failure as postgrest-js reports it: a message, but no code. */
const networkError: SyncError = { code: '', message: 'TypeError: Failed to fetch' }
/** An RLS denial: a Postgres SQLSTATE, and it will fail identically forever. */
const rlsError: SyncError = { code: '42501', message: 'new row violates row-level security policy' }

let db: AppDatabase
let dbCount = 0

beforeEach(() => {
  db = new AppDatabase(`test-${++dbCount}`)
})

afterEach(async () => {
  await db.delete()
})

/** A stand-in server that upserts whole rows, exactly as Postgres would. */
function fakeServer() {
  const rows = new Map<string, SyncedRow>()
  const calls: Array<{ table: SyncTable, id: string }> = []
  let failWith: SyncError | null = null

  const upsert: UpsertFn = async (table, payload) => {
    calls.push({ table, id: payload.id })
    if (failWith) return { error: failWith }
    rows.set(payload.id, { ...payload })
    return { error: null }
  }

  return {
    upsert,
    rows,
    calls,
    fail: (error: SyncError | null) => {
      failWith = error
    }
  }
}

describe('shouldApplyServerRow', () => {
  const empty = new Set<string>()

  it('applies a row we have never seen', () => {
    expect(shouldApplyServerRow(item(), undefined, empty)).toBe(true)
  })

  it('refuses any server row for which we hold an unsynced write', () => {
    const row = item()
    expect(shouldApplyServerRow(row, item(), new Set([row.id]))).toBe(false)
  })

  it('refuses a server row older than local state', () => {
    const server = item({ updated_at: '2026-07-30T10:00:00.000Z' })
    const local = item({ updated_at: '2026-07-30T10:00:05.000Z' })
    expect(shouldApplyServerRow(server, local, empty)).toBe(false)
  })

  it('applies a server row newer than local state', () => {
    const server = item({ updated_at: '2026-07-30T10:00:05.000Z' })
    const local = item({ updated_at: '2026-07-30T10:00:00.000Z' })
    expect(shouldApplyServerRow(server, local, empty)).toBe(true)
  })

  it('applies the echo of our own write, which carries an identical timestamp', () => {
    const stamp = '2026-07-30T10:00:00.000Z'
    expect(shouldApplyServerRow(item({ updated_at: stamp }), item({ updated_at: stamp }), empty)).toBe(true)
  })

  // Postgres returns a +00:00 offset and up to microsecond precision; the client
  // writes a Z and milliseconds. The same instant, but lexically the server value
  // sorts BELOW the local one ('+' < '.', and '4' < 'Z'), so a string comparison
  // would call every echo of our own writes stale. Both forms below are what the
  // local stack actually returns.
  it.each([
    ['2026-07-30T10:00:00.123Z', '2026-07-30T10:00:00.123456+00:00'],
    ['2026-07-30T10:05:00.000Z', '2026-07-30T10:05:00+00:00']
  ])('treats the Postgres echo of %s as the same instant', (local, server) => {
    expect(shouldApplyServerRow(item({ updated_at: server }), item({ updated_at: local }), empty)).toBe(true)
  })
})

describe('isPermanentSyncError', () => {
  it('treats a codeless transport failure as retryable', () => {
    expect(isPermanentSyncError(networkError)).toBe(false)
    expect(isPermanentSyncError({ message: 'network down' })).toBe(false)
    expect(isPermanentSyncError(null)).toBe(false)
  })

  it('treats a coded PostgREST rejection as permanent', () => {
    expect(isPermanentSyncError(rlsError)).toBe(true)
    expect(isPermanentSyncError({ code: 'PGRST204' })).toBe(true)
    expect(isPermanentSyncError({ code: '23503' })).toBe(true)
  })
})

describe('enqueueMutation', () => {
  it('caches the row and queues it in one step', async () => {
    const row = item()
    await enqueueMutation(db, 'shopping_list_items', row)

    expect(await db.items.get(row.id)).toMatchObject({ name: 'Milk' })
    expect(await db.mutations.count()).toBe(1)
    expect(await queuedRowIds(db)).toEqual(new Set([row.id]))
  })

  it('stores a snapshot that later local edits cannot alter', async () => {
    const row = item({ name: 'Milk' })
    await enqueueMutation(db, 'shopping_list_items', row)
    row.name = 'Oat milk'

    const [queued] = await db.mutations.toArray()
    expect(queued!.payload.name).toBe('Milk')
  })
})

describe('drainQueue', () => {
  it('pushes queued writes in the order they were made and empties the queue', async () => {
    const server = fakeServer()
    const settled: string[] = []

    for (const name of ['Milk', 'Bread', 'Eggs']) {
      await enqueueMutation(db, 'shopping_list_items', item({ id: `id-${name}`, name }))
    }

    const result = await drainQueue(db, server.upsert, { onRowSettled: id => settled.push(id) })

    expect(result).toEqual({ synced: 3, dropped: 0, halted: false })
    expect(await db.mutations.count()).toBe(0)
    expect(server.calls.map(c => c.id)).toEqual(['id-Milk', 'id-Bread', 'id-Eggs'])
    expect(settled).toEqual(['id-Milk', 'id-Bread', 'id-Eggs'])
  })

  // The acceptance test from CLAUDE.md, in miniature.
  it('keeps the whole queue when the server is unreachable, then drains it on reconnect', async () => {
    const server = fakeServer()
    server.fail(networkError)

    for (let i = 0; i < 5; i++) {
      await enqueueMutation(db, 'shopping_list_items', item({ id: `id-${i}`, name: `Item ${i}`, checked: true }))
    }

    const offline = await drainQueue(db, server.upsert)
    expect(offline).toEqual({ synced: 0, dropped: 0, halted: true })
    expect(await db.mutations.count()).toBe(5)
    // Stopped at the first failure rather than hammering every queued write.
    expect(server.calls).toHaveLength(1)

    server.fail(null)
    const online = await drainQueue(db, server.upsert)

    expect(online).toEqual({ synced: 5, dropped: 0, halted: false })
    expect(await db.mutations.count()).toBe(0)
    expect(server.rows.size).toBe(5)
    expect([...server.rows.values()].every(r => (r as ItemRow).checked)).toBe(true)
  })

  it('keeps a row pending until its last queued write has landed', async () => {
    const server = fakeServer()
    const settled: string[] = []
    const row = item({ id: 'row-1' })

    await enqueueMutation(db, 'shopping_list_items', row)
    await enqueueMutation(db, 'shopping_list_items', { ...row, checked: true, updated_at: '2026-07-30T10:00:01.000Z' })
    await enqueueMutation(db, 'shopping_list_items', { ...row, quantity: '2', updated_at: '2026-07-30T10:00:02.000Z' })

    // Only the first write gets through before the connection drops.
    let calls = 0
    const flaky: UpsertFn = async (table, payload) => {
      calls++
      return calls > 1 ? { error: networkError } : server.upsert(table, payload)
    }

    await drainQueue(db, flaky, { onRowSettled: id => settled.push(id) })

    expect(await db.mutations.count()).toBe(2)
    expect(settled).toEqual([])
    expect(await queuedRowIds(db)).toEqual(new Set(['row-1']))

    await drainQueue(db, server.upsert, { onRowSettled: id => settled.push(id) })

    expect(settled).toEqual(['row-1'])
    expect((server.rows.get('row-1') as ItemRow).quantity).toBe('2')
  })

  it('abandons a rejected write after MAX_SYNC_ATTEMPTS rather than retrying forever', async () => {
    const server = fakeServer()
    server.fail(rlsError)
    const onDropped = vi.fn()

    await enqueueMutation(db, 'shopping_list_items', item({ id: 'doomed' }))

    for (let attempt = 1; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
      const result = await drainQueue(db, server.upsert, { onDropped })
      expect(result).toEqual({ synced: 0, dropped: 0, halted: false })
      expect(await db.mutations.count()).toBe(1)
      expect(onDropped).not.toHaveBeenCalled()
    }

    const final = await drainQueue(db, server.upsert, { onDropped })
    expect(final).toEqual({ synced: 0, dropped: 1, halted: false })
    expect(await db.mutations.count()).toBe(0)
    expect(onDropped).toHaveBeenCalledOnce()
  })

  it('does not let a rejected write hold up the writes behind it', async () => {
    const server = fakeServer()

    await enqueueMutation(db, 'shopping_list_items', item({ id: 'doomed' }))
    await enqueueMutation(db, 'shopping_list_items', item({ id: 'fine', name: 'Bread' }))

    const selective: UpsertFn = async (table, payload) =>
      payload.id === 'doomed' ? { error: rlsError } : server.upsert(table, payload)

    const result = await drainQueue(db, selective)

    expect(result.synced).toBe(1)
    expect(result.halted).toBe(false)
    expect(server.rows.has('fine')).toBe(true)
    // The bad write is still queued, counting attempts; the good one is gone.
    expect(await db.mutations.count()).toBe(1)
  })

  it('is idempotent: replaying a drained write leaves the server unchanged', async () => {
    const server = fakeServer()
    const row = item({ id: 'row-1', quantity: '2 pints' })

    await enqueueMutation(db, 'shopping_list_items', row)
    await drainQueue(db, server.upsert)
    const afterFirst = { ...server.rows.get('row-1')! }

    // Same mutation queued and drained a second time, as a retry would do.
    await enqueueMutation(db, 'shopping_list_items', row)
    await drainQueue(db, server.upsert)

    expect(server.rows.get('row-1')).toEqual(afterFirst)
  })

  it('never lands a blend of two devices’ edits, whichever order they arrive in', async () => {
    const base = item({ id: 'row-1' })
    const fromPhone = { ...base, checked: true, checked_at: '2026-07-30T10:00:01.000Z', updated_at: '2026-07-30T10:00:01.000Z' }
    const fromTablet = { ...base, quantity: '3', updated_at: '2026-07-30T10:00:02.000Z' }

    for (const order of [[fromPhone, fromTablet], [fromTablet, fromPhone]]) {
      const server = fakeServer()
      const scratch = new AppDatabase(`order-${++dbCount}`)
      for (const payload of order) await enqueueMutation(scratch, 'shopping_list_items', payload)
      await drainQueue(scratch, server.upsert)

      // The end state is exactly one of the two whole rows — never checked AND
      // quantity 3, which no device ever asked for.
      expect(order[order.length - 1]).toEqual(server.rows.get('row-1'))
      await scratch.delete()
    }
  })
})
