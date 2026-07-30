import type { RealtimeChannel } from '@supabase/supabase-js'
import { useSyncStore } from '../stores/sync'
import { SYNC_TABLE_NAMES, type SyncedRow } from '../utils/db'
import { clearIdentity, readIdentity, writeIdentity } from '../utils/identity'
import type { UpsertFn } from '../utils/sync'

const DRAIN_INTERVAL_MS = 30_000

/** Answered the question / could not ask. Never collapse the two. */
type HouseholdLookup = { ok: true, householdId: string | null } | { ok: false }

/**
 * Wires the offline store to Supabase. Called exactly once, from app.vue.
 *
 * Everything network-facing lives here so that the store and the mutation queue
 * stay testable without a Supabase client.
 */
export function useSync() {
  const store = useSyncStore()
  const supabase = useSupabaseClient()
  const session = useSupabaseSession()
  const user = useSupabaseUser()
  const toast = useToast()

  let channel: RealtimeChannel | null = null
  let connecting = false

  const upsert: UpsertFn = async (table, payload) => {
    const { error } = await supabase.from(table).upsert(payload as never)
    return { error }
  }

  function subscribe() {
    if (channel) return
    // One channel, one subscription per synced table. No household filter: RLS
    // does that server-side, so a member only ever receives their own rows.
    let next = supabase.channel('household-sync')
    for (const table of SYNC_TABLE_NAMES) {
      next = next.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        ({ new: row }) => {
          if (row && 'id' in row) store.applyServerRow(table, row as never)
        }
      )
    }
    // A live socket is proof the server is there, and it arrives without a request.
    // Only the positive signal is taken: realtime can be blocked on a network where
    // plain HTTP still works, and pull is the authority on that.
    channel = next.subscribe((status) => {
      if (status === 'SUBSCRIBED') store.reachable = true
    })
  }

  async function unsubscribe() {
    if (!channel) return
    await supabase.removeChannel(channel)
    channel = null
  }

  /**
   * Pull every row for the household, soft-deleted ones included — a deletion made
   * on another device is only visible as a row with `deleted_at` set.
   */
  async function pull(householdId: string) {
    const results = await Promise.all(
      SYNC_TABLE_NAMES.map(table => supabase.from(table).select('*').eq('household_id', householdId))
    )
    if (results.some(result => result.error)) {
      store.reachable = false
      return
    }
    // Applied in registry order, so a recipe is in local state before the plan
    // entry and derived items that point at it.
    SYNC_TABLE_NAMES.forEach((table, i) => {
      for (const row of results[i]!.data ?? []) store.applyServerRow(table, row as SyncedRow as never)
    })
    store.reachable = true
  }

  /**
   * Doubles as the reachability probe. It is the one request that runs before a
   * household is known, so a device that has none — and therefore never reaches
   * `drain` or `pull` — still has a way to discover that the server is back.
   *
   * "No household" and "could not ask" must stay distinguishable: the first is a
   * setup problem the user can fix at /welcome, the second is weather.
   */
  async function resolveHousehold(userId: string): Promise<HouseholdLookup> {
    const { data, error } = await supabase
      .from('people')
      .select('household_id')
      .eq('auth_user_id', userId)
      .maybeSingle()
    if (error) {
      store.reachable = false
      return { ok: false }
    }
    store.reachable = true
    return { ok: true, householdId: data?.household_id ?? null }
  }

  /**
   * Bring the device up to date. Safe to call repeatedly: the household is resolved
   * once, the realtime channel is created once, and push/pull are idempotent.
   *
   * Order matters — subscribe before pulling so an event landing mid-pull is not
   * missed, and push before pulling so a snapshot taken before our writes arrived
   * cannot overwrite them.
   *
   * Only a session is required, not the decoded JWT claims. After a cold start
   * with no network the claims cannot be verified, and if this waited for them the
   * queue would never drain once signal came back.
   */
  async function connect() {
    if (connecting || !session.value) return
    connecting = true
    try {
      const userId = user.value?.sub
      const cached = readIdentity()

      // A different person signing in on a shared device must not inherit the
      // previous household's cached list.
      if (cached && userId && cached.userId !== userId) {
        await unsubscribe()
        await store.reset()
        clearIdentity()
      } else if (cached) {
        store.householdId = cached.householdId
      }

      if (!store.householdId) {
        // Which household this user belongs to is the one thing that genuinely
        // needs their id, so this step alone waits for the claims.
        if (!userId) return
        const lookup = await resolveHousehold(userId)
        // Could not ask: leave the user where they are and let the tick retry.
        if (!lookup.ok) return
        // Asked, and there is genuinely no household for this account. Send them
        // to setup — this has to happen whatever the connection is doing, or a
        // device with no household sits on a dead list with no way forward.
        if (!lookup.householdId) {
          await navigateTo('/welcome')
          return
        }
        store.householdId = lookup.householdId
        writeIdentity({ householdId: lookup.householdId, userId })
      }

      subscribe()
      await store.drain()
      await pull(store.householdId)
    } finally {
      connecting = false
    }
  }

  async function boot() {
    // Local state first: the list opens with no network, session valid or not.
    await store.hydrate()
    const cached = readIdentity()
    if (cached) store.householdId = cached.householdId
    await connect()
  }

  if (import.meta.client) {
    const onOnline = () => {
      store.online = true
      void connect()
    }
    const onOffline = () => {
      store.online = false
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void connect()
    }
    const tick = () => {
      if (store.pendingCount > 0 || !store.reachable) void connect()
    }

    store.online = navigator.onLine
    store.registerSync({ upsert, connect })

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(tick, DRAIN_INTERVAL_MS)

    onScopeDispose(() => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
      store.registerSync({ upsert: null, connect: null })
      void unsubscribe()
    })

    // A magic-link sign-in resolves the session first and the JWT claims a moment
    // later, so wait for both before touching the network.
    watch(
      () => [session.value?.access_token, user.value?.sub] as const,
      ([token, userId]) => {
        if (token && userId) void connect()
      }
    )

    watch(
      () => store.dropped,
      (count, previous) => {
        if (count <= (previous ?? 0)) return
        toast.add({
          title: 'Something could not be saved',
          description: 'A change was rejected by the server and has been discarded.',
          color: 'warning',
          icon: 'i-lucide-cloud-alert'
        })
      }
    )

    void boot()
  }
}
