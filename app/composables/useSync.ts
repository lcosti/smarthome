import type { RealtimeChannel } from '@supabase/supabase-js'
import { useListStore } from '../stores/list'
import type { AisleRow, ItemRow } from '../utils/db'
import { clearIdentity, readIdentity, writeIdentity } from '../utils/identity'
import type { UpsertFn } from '../utils/sync'

const DRAIN_INTERVAL_MS = 30_000

/**
 * Wires the offline store to Supabase. Called exactly once, from app.vue.
 *
 * Everything network-facing lives here so that the store and the mutation queue
 * stay testable without a Supabase client.
 */
export function useSync() {
  const store = useListStore()
  const supabase = useSupabaseClient()
  const session = useSupabaseSession()
  const user = useSupabaseUser()
  const toast = useToast()

  let channel: RealtimeChannel | null = null
  let connecting = false

  const upsert: UpsertFn = async (table, payload) => {
    const { error } = table === 'aisles'
      ? await supabase.from('aisles').upsert(payload as AisleRow)
      : await supabase.from('shopping_list_items').upsert(payload as ItemRow)
    return { error }
  }

  function subscribe() {
    if (channel) return
    channel = supabase
      .channel('household-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_list_items' },
        ({ new: row }) => {
          if (row && 'id' in row) store.applyServerRow('shopping_list_items', row as ItemRow)
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'aisles' },
        ({ new: row }) => {
          if (row && 'id' in row) store.applyServerRow('aisles', row as AisleRow)
        }
      )
      .subscribe()
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
    const [itemResult, aisleResult] = await Promise.all([
      supabase.from('shopping_list_items').select('*').eq('household_id', householdId),
      supabase.from('aisles').select('*').eq('household_id', householdId)
    ])
    if (itemResult.error || aisleResult.error) {
      store.reachable = false
      return
    }
    for (const row of aisleResult.data) store.applyServerRow('aisles', row)
    for (const row of itemResult.data) store.applyServerRow('shopping_list_items', row)
    store.reachable = true
  }

  async function resolveHousehold(userId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('people')
      .select('household_id')
      .eq('auth_user_id', userId)
      .maybeSingle()
    if (error) {
      store.reachable = false
      return null
    }
    return data?.household_id ?? null
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
        const householdId = await resolveHousehold(userId)
        if (!householdId) {
          if (store.reachable) await navigateTo('/welcome')
          return
        }
        store.householdId = householdId
        writeIdentity({ householdId, userId })
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
