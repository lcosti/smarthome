import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AppDatabase,
  SYNC_TABLE_NAMES,
  WRITABLE_TABLE_NAMES,
  type IngredientAliasRow,
  type IngredientRow,
  type ItemRow,
  type PlanEntryRow,
  type PurchaseUnitRow,
  type RecipeIngredientRow,
  type RecipeRow,
  type SyncTable,
  type SyncedRow
} from '../app/utils/db'
import {
  MAX_SYNC_ATTEMPTS,
  drainQueue,
  enqueueMutation,
  isPermanentSyncError,
  queuedRowIds,
  rowsNeedingRequeue,
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
    plan_entry_id: null,
    recipe_ingredient_id: null,
    deleted_at: null,
    created_at: stamp,
    updated_at: stamp,
    ...overrides
  }
}

const STAMP = '2026-07-30T10:00:00.000Z'

function recipe(overrides: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: 'c0000000-0000-0000-0000-000000000001',
    household_id: HOUSEHOLD,
    name: 'Chilli',
    source_url: null,
    base_servings: 2,
    prep_minutes: null,
    cook_minutes: null,
    method: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function line(overrides: Partial<RecipeIngredientRow> = {}): RecipeIngredientRow {
  return {
    id: 'd0000000-0000-0000-0000-000000000001',
    household_id: HOUSEHOLD,
    recipe_id: 'c0000000-0000-0000-0000-000000000001',
    name: 'Chopped tomatoes',
    quantity: '2 tins',
    aisle_id: null,
    ingredient_id: null,
    sort_order: 1,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function ingredient(overrides: Partial<IngredientRow> = {}): IngredientRow {
  return {
    id: 'f0000000-0000-0000-0000-000000000001',
    household_id: HOUSEHOLD,
    name: 'Chopped tomatoes',
    base_unit: 'g',
    aisle_id: null,
    merged_into: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function ingredientAlias(overrides: Partial<IngredientAliasRow> = {}): IngredientAliasRow {
  return {
    id: 'a1000000-0000-0000-0000-000000000001',
    household_id: HOUSEHOLD,
    ingredient_id: 'f0000000-0000-0000-0000-000000000001',
    alias: 'tinned tomatoes',
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function purchaseUnit(overrides: Partial<PurchaseUnitRow> = {}): PurchaseUnitRow {
  return {
    id: 'a2000000-0000-0000-0000-000000000001',
    household_id: HOUSEHOLD,
    ingredient_id: 'f0000000-0000-0000-0000-000000000001',
    name: 'tin',
    amount: 400,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function planEntry(overrides: Partial<PlanEntryRow> = {}): PlanEntryRow {
  return {
    id: 'e0000000-0000-0000-0000-000000000001',
    household_id: HOUSEHOLD,
    date: '2026-08-04',
    meal: 'dinner',
    recipe_id: 'c0000000-0000-0000-0000-000000000001',
    servings: 2,
    note: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
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
    // 42501 stays permanent on purpose. A retryable error halts the whole queue,
    // so a row that genuinely fails its RLS check would sit at the head of it
    // blocking every write behind it forever. 23503 is permanent for the same
    // reason: a foreign key pointing at nothing is that row's own fault.
    expect(isPermanentSyncError(rlsError)).toBe(true)
    expect(isPermanentSyncError({ code: '23503' })).toBe(true)
  })

  // PGRST204 used to be asserted permanent here, as an incidental example of
  // "coded, therefore permanent". It is the opposite: a bundle deployed ahead of
  // its migrations writes a column the database has not got yet, and dropping the
  // write costs a recipe over a database that is merely behind. Applying the
  // migration cures it, so it waits.
  it('treats a schema the database has not caught up to as retryable', () => {
    expect(isPermanentSyncError({ code: 'PGRST204', message: 'Could not find the \'kcal\' column' })).toBe(false)
    expect(isPermanentSyncError({ code: 'PGRST205' })).toBe(false)
    expect(isPermanentSyncError({ code: '42703' })).toBe(false)
    expect(isPermanentSyncError({ code: '42P01' })).toBe(false)
  })

  // An expired token fails identically every time right up until it refreshes,
  // which is the one code-bearing failure a retry actually cures.
  it('treats an expired or invalid token as retryable', () => {
    expect(isPermanentSyncError({ code: 'PGRST301', message: 'JWT expired' })).toBe(false)
    expect(isPermanentSyncError({ code: 'PGRST302' })).toBe(false)
  })
})

describe('rowsNeedingRequeue', () => {
  const local = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })]

  it('returns the rows the server does not have', () => {
    const missing = rowsNeedingRequeue(local, new Set(['a']), new Set())
    expect(missing.map(r => r.id)).toEqual(['b', 'c'])
  })

  it('leaves rows the server already has alone', () => {
    expect(rowsNeedingRequeue(local, new Set(['a', 'b', 'c']), new Set())).toEqual([])
  })

  // Already queued means it is on its way; queueing it twice would push the same
  // row again behind itself.
  it('skips rows with a write already waiting', () => {
    const missing = rowsNeedingRequeue(local, new Set(), new Set(['a', 'b']))
    expect(missing.map(r => r.id)).toEqual(['c'])
  })

  /**
   * Re-queueing reads "the server does not have it" as "it never landed", which
   * only holds where deletes are soft. calendar_events is the exception: the
   * sync-calendar function prunes old events with a real delete, so a device
   * still holding one must not offer to re-create it.
   */
  it('excludes server-owned tables from the writable set', () => {
    expect(WRITABLE_TABLE_NAMES).not.toContain('calendar_events')
    expect(WRITABLE_TABLE_NAMES).toContain('shopping_list_items')
    expect(WRITABLE_TABLE_NAMES).toHaveLength(SYNC_TABLE_NAMES.length - 1)
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

  /**
   * The bug this guards against: a phone opened after its token expired pushed
   * with the anon key, which is granted nothing, and every row came back 42501.
   * Coded, so permanent, so a whole boot's worth of writes was discarded after
   * five passes. Both halves of the fix are asserted here — the composable now
   * reports a missing session code-less, and an expired token is retryable — and
   * either one alone is enough to keep the queue.
   */
  it('keeps the queue when the session is missing or expired rather than discarding it', async () => {
    for (const failure of [{ message: 'no session' }, { code: 'PGRST301', message: 'JWT expired' }]) {
      const server = fakeServer()
      server.fail(failure)
      const onDropped = vi.fn()
      await enqueueMutation(db, 'shopping_list_items', item({ id: 'unauthenticated' }))

      // Well past MAX_SYNC_ATTEMPTS: no amount of retrying may consume the write.
      for (let pass = 0; pass < MAX_SYNC_ATTEMPTS + 2; pass++) {
        const result = await drainQueue(db, server.upsert, { onDropped })
        expect(result).toEqual({ synced: 0, dropped: 0, halted: true })
      }

      expect(onDropped).not.toHaveBeenCalled()
      expect(await db.mutations.count()).toBe(1)

      // And it lands once the session is back.
      server.fail(null)
      expect(await drainQueue(db, server.upsert)).toEqual({ synced: 1, dropped: 0, halted: false })
      expect(server.rows.has('unauthenticated')).toBe(true)
      await db.mutations.clear()
    }
  })

  /**
   * The bug this guards against, from the day it happened: the local database was
   * six migrations behind the bundle, so every recipe upsert came back PGRST204
   * naming a nutrition column that did not exist there yet. Coded, so permanent,
   * so an imported recipe was deleted about two minutes later — the mutation
   * dropped and the local row with it — and its ingredients followed on 23503 for
   * a parent that never landed.
   *
   * Both halves are asserted: nothing is dropped however long the drift lasts, and
   * the halt keeps the drain from ever reaching the children whose foreign key is
   * only failing as a symptom.
   */
  it('keeps a recipe and its ingredients when the database is behind the bundle', async () => {
    const server = fakeServer()
    const driftError = { code: 'PGRST204', message: 'Could not find the \'kcal\' column of \'recipes\' in the schema cache' }
    server.fail(driftError)
    const onDropped = vi.fn()

    await enqueueMutation(db, 'recipes', recipe({ id: 'risotto', name: 'Mushroom risotto' }))
    await enqueueMutation(db, 'recipe_ingredients', line({ id: 'rice', recipe_id: 'risotto' }))

    // Well past MAX_SYNC_ATTEMPTS: a database that is behind never consumes a write.
    for (let pass = 0; pass < MAX_SYNC_ATTEMPTS + 2; pass++) {
      expect(await drainQueue(db, server.upsert, { onDropped }))
        .toEqual({ synced: 0, dropped: 0, halted: true })
    }

    expect(onDropped).not.toHaveBeenCalled()
    expect(await db.mutations.count()).toBe(2)
    // The ingredient was never attempted, so its FK failure never accrued attempts.
    expect(server.calls.every(c => c.id === 'risotto')).toBe(true)

    // And the whole recipe lands once the migration has been applied.
    server.fail(null)
    expect(await drainQueue(db, server.upsert)).toEqual({ synced: 2, dropped: 0, halted: false })
    expect((server.rows.get('risotto') as RecipeRow).name).toBe('Mushroom risotto')
    expect(server.rows.has('rice')).toBe(true)
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

describe('the synced table registry', () => {
  it('routes every table to its own cache store', async () => {
    await db.cacheFor('aisles').put({
      id: 'a-1', household_id: HOUSEHOLD, name: 'Chilled', sort_order: 1,
      deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('ingredients').put(ingredient({ id: 'n-1' }))
    await db.cacheFor('ingredient_aliases').put(ingredientAlias({ id: 'x-1' }))
    await db.cacheFor('ingredient_purchase_units').put(purchaseUnit({ id: 'u-1' }))
    await db.cacheFor('recipes').put(recipe({ id: 'r-1' }))
    await db.cacheFor('recipe_ingredients').put(line({ id: 'l-1' }))
    await db.cacheFor('recipe_steps').put({
      id: 's-1', household_id: HOUSEHOLD, recipe_id: 'r-1', body: 'Brown the mince.',
      sort_order: 1, deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('meal_plan_entries').put(planEntry({ id: 'p-1' }))
    await db.cacheFor('shopping_list_items').put(item({ id: 'i-1' }))
    await db.cacheFor('people').put({
      id: 'per-1', household_id: HOUSEHOLD, name: 'Tom', date_of_birth: '2023-02-01',
      auth_user_id: null, deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('dietary_constraints').put({
      id: 'c-1', household_id: HOUSEHOLD, person_id: 'per-1', kind: 'allergy',
      tag: 'peanuts', deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('attendance').put({
      id: 'att-1', household_id: HOUSEHOLD, person_id: 'per-1', date: '2026-08-04',
      meal: 'dinner', present: false, deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('pantry_items').put({
      id: 'pan-1', household_id: HOUSEHOLD, ingredient_id: 'n-1', on_hand: 2,
      deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('pantry_reservations').put({
      id: 'res-1', household_id: HOUSEHOLD, plan_entry_id: 'p-1', ingredient_id: 'n-1',
      amount: 1, date: '2026-08-04', settled_at: null,
      deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('chores').put({
      id: 'cho-1', household_id: HOUSEHOLD, name: 'Bins out', person_id: 'per-1',
      weekdays: [4], due_date: null, at_time: '19:00',
      deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('chore_completions').put({
      id: 'cdone-1', household_id: HOUSEHOLD, chore_id: 'cho-1', date: '2026-08-04',
      done: true, deleted_at: null, created_at: STAMP, updated_at: STAMP
    })
    await db.cacheFor('calendar_events').put({
      id: 'cal-1', household_id: HOUSEHOLD, person_id: 'per-1',
      calendar_id: 'family@group.calendar.google.com', google_event_id: 'g-1',
      title: 'Choir', all_day: false,
      starts_at: '2026-07-30T17:30:00.000Z', ends_at: '2026-07-30T19:00:00.000Z',
      start_date: '2026-07-30', end_date: '2026-07-30', google_updated_at: null,
      deleted_at: null, created_at: STAMP, updated_at: STAMP
    })

    // Each row lands in exactly one store, and nothing collides.
    for (const table of SYNC_TABLE_NAMES) {
      expect(await db.cacheFor(table).count()).toBe(1)
    }
    expect((await db.cacheFor('recipes').get('r-1'))?.name).toBe('Chilli')
  })

  it('keeps shopping list items in the store they have always lived in', async () => {
    // The remote table is shopping_list_items; the Dexie store is `items`, from
    // before the registry existed. Renaming it would mean migrating every device.
    await db.cacheFor('shopping_list_items').put(item({ id: 'i-1' }))
    expect(await db.items.get('i-1')).toBeTruthy()
  })

  it('round-trips a row of every type through the queue', async () => {
    const server = fakeServer()
    await enqueueMutation(db, 'ingredients', ingredient({ id: 'n-1' }))
    await enqueueMutation(db, 'ingredient_aliases', ingredientAlias({ id: 'x-1' }))
    await enqueueMutation(db, 'ingredient_purchase_units', purchaseUnit({ id: 'u-1' }))
    await enqueueMutation(db, 'recipes', recipe({ id: 'r-1' }))
    await enqueueMutation(db, 'recipe_ingredients', line({ id: 'l-1' }))
    await enqueueMutation(db, 'meal_plan_entries', planEntry({ id: 'p-1' }))
    await enqueueMutation(db, 'shopping_list_items', item({ id: 'i-1' }))

    const result = await drainQueue(db, server.upsert)

    expect(result.synced).toBe(7)
    expect(server.calls.map(c => c.table)).toEqual([
      'ingredients', 'ingredient_aliases', 'ingredient_purchase_units',
      'recipes', 'recipe_ingredients', 'meal_plan_entries', 'shopping_list_items'
    ])
  })

  it('drains parents before the rows that reference them', async () => {
    // A recipe must exist before its ingredient lines, and a plan entry before
    // the items derived from it, or the server rejects the child on a foreign
    // key. The queue is global and strictly FIFO, so writing them in that order
    // on the device is what guarantees it.
    const server = fakeServer()
    await enqueueMutation(db, 'ingredients', ingredient({ id: 'n-1' }))
    await enqueueMutation(db, 'recipes', recipe({ id: 'r-1' }))
    await enqueueMutation(db, 'recipe_ingredients', line({
      id: 'l-1', recipe_id: 'r-1', ingredient_id: 'n-1'
    }))
    await enqueueMutation(db, 'meal_plan_entries', planEntry({ id: 'p-1', recipe_id: 'r-1' }))
    await enqueueMutation(db, 'shopping_list_items', item({
      id: 'i-1', source: 'plan', plan_entry_id: 'p-1', recipe_ingredient_id: 'l-1', ingredient_id: 'n-1'
    }))

    await drainQueue(db, server.upsert)

    const order = server.calls.map(c => c.id)
    expect(order.indexOf('r-1')).toBeLessThan(order.indexOf('l-1'))
    expect(order.indexOf('r-1')).toBeLessThan(order.indexOf('p-1'))
    expect(order.indexOf('p-1')).toBeLessThan(order.indexOf('i-1'))
    // An ingredient has to exist before anything can point at it.
    expect(order.indexOf('n-1')).toBeLessThan(order.indexOf('l-1'))
    expect(order.indexOf('n-1')).toBeLessThan(order.indexOf('i-1'))
  })

  it('settles rows independently across tables', async () => {
    const server = fakeServer()
    const settled: string[] = []
    await enqueueMutation(db, 'recipes', recipe({ id: 'r-1' }))
    await enqueueMutation(db, 'shopping_list_items', item({ id: 'i-1' }))

    await drainQueue(db, server.upsert, { onRowSettled: id => settled.push(id) })

    expect(settled.sort()).toEqual(['i-1', 'r-1'])
    expect(await db.mutations.count()).toBe(0)
  })
})

describe('the Dexie upgrades', () => {
  it('keeps cached rows and queued mutations from before Phase 2', async () => {
    const name = `upgrade-${++dbCount}`

    // A device running the Phase 1 build: three stores, some list data, and a
    // write that never made it to the server.
    const v1 = new Dexie(name)
    v1.version(1).stores({ items: 'id', aisles: 'id', mutations: '++seq, rowId' })
    await v1.open()
    await v1.table('items').put(item({ id: 'i-1', name: 'Milk' }))
    await v1.table('mutations').add({
      table: 'shopping_list_items', rowId: 'i-1', payload: item({ id: 'i-1' }), ts: 1, attempts: 0
    })
    v1.close()

    // The same device after the Phase 2 build lands.
    const v2 = new AppDatabase(name)
    await v2.open()

    expect((await v2.items.get('i-1'))?.name).toBe('Milk')
    expect(await v2.mutations.count()).toBe(1)
    // And the new stores exist, empty, ready to be filled by the first pull.
    expect(await v2.recipes.count()).toBe(0)
    expect(await v2.meal_plan_entries.count()).toBe(0)

    await v2.delete()
  })

  it('keeps a Phase 2 device intact when the ingredient stores arrive', async () => {
    const name = `upgrade-${++dbCount}`

    // A device running the Phase 2 build: a recipe library, a planned night, a
    // list, and a write still waiting to go out.
    const v2 = new Dexie(name)
    v2.version(1).stores({ items: 'id', aisles: 'id', mutations: '++seq, rowId' })
    v2.version(2).stores({ recipes: 'id', recipe_ingredients: 'id', meal_plan_entries: 'id' })
    await v2.open()
    await v2.table('items').put(item({ id: 'i-1', name: 'Milk' }))
    await v2.table('recipes').put(recipe({ id: 'r-1' }))
    await v2.table('recipe_ingredients').put(line({ id: 'l-1' }))
    await v2.table('meal_plan_entries').put(planEntry({ id: 'p-1' }))
    await v2.table('mutations').add({
      table: 'recipes', rowId: 'r-1', payload: recipe({ id: 'r-1' }), ts: 1, attempts: 0
    })
    v2.close()

    // The same device after the Phase 3 build lands.
    const v3 = new AppDatabase(name)
    await v3.open()

    expect((await v3.items.get('i-1'))?.name).toBe('Milk')
    expect((await v3.recipes.get('r-1'))?.name).toBe('Chilli')
    expect(await v3.recipe_ingredients.count()).toBe(1)
    expect(await v3.meal_plan_entries.count()).toBe(1)
    expect(await v3.mutations.count()).toBe(1)
    // The new stores exist, empty, waiting for the first pull. Nothing was
    // reshaped, so the rows above keep their null ingredient_id until something
    // touches them.
    expect(await v3.ingredients.count()).toBe(0)
    expect(await v3.ingredient_aliases.count()).toBe(0)
    expect(await v3.ingredient_purchase_units.count()).toBe(0)
    expect((await v3.recipe_ingredients.get('l-1'))?.ingredient_id).toBeNull()

    await v3.delete()
  })
})
