import { readIdentity } from '../utils/identity'

/**
 * Hand-rolled because the Supabase module's own redirect middleware is disabled.
 *
 * The gate is "has this device ever been set up", not "is the access token valid
 * right now" — a token lasts an hour, and the app has to open in a supermarket
 * with no signal. Reads are served from IndexedDB and writes queue locally, so a
 * stale session costs nothing until it is time to sync.
 */
export default defineNuxtRouteMiddleware((to) => {
  const session = useSupabaseSession()
  const known = !!session.value || !!readIdentity()

  if (!known) {
    return to.path === '/login' ? undefined : navigateTo('/login')
  }
  if (to.path === '/login') {
    return navigateTo('/')
  }
})
