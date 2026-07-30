import { useSyncStore } from '../stores/sync'
import { clearIdentity } from '../utils/identity'

/**
 * Sign out and leave nothing behind. Separate from useSync so that the settings
 * page can call it without setting up a second set of listeners and channels.
 */
export function useSignOut() {
  const store = useSyncStore()
  const supabase = useSupabaseClient()

  return async function signOut() {
    await supabase.auth.signOut()
    clearIdentity()
    await store.reset()
    await navigateTo('/login')
  }
}
