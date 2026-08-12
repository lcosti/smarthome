/**
 * Whether this device can open the app with no signal.
 *
 * Every other part of being offline is ours and is testable: the list is read
 * out of IndexedDB, writes queue there, and the queue drains when the network
 * comes back. This one part is not ours. The shell itself — the HTML and the
 * bundle — has to come from the service worker's precache, and if the worker
 * never installed then a cold open with no signal never reaches a line of this
 * app. The browser serves its own offline page instead, which looks like the
 * app being broken and is really the app not being there.
 *
 * That state is invisible from inside a working app: online, a device with no
 * worker behaves exactly like a device with one, for months. So it is worth
 * asking out loud, on the settings screen, where somebody standing in the
 * kitchen can read the answer and fix it before the shop rather than in it.
 */
export function useOfflineReady() {
  const supported = import.meta.client && 'serviceWorker' in navigator && 'caches' in window

  const worker = ref(false)
  const shell = ref(false)
  const busy = ref(false)

  /** Both halves have to be true. A worker with an empty cache serves nothing. */
  const ready = computed(() => worker.value && shell.value)

  async function check() {
    if (!supported) return
    const registration = await navigator.serviceWorker.getRegistration('/')
    worker.value = !!registration?.active
    // ignoreSearch, because workbox stores each precached URL under a revision
    // query parameter — the entry for the shell is '/?__WB_REVISION__=…', and a
    // plain match for '/' misses it and reports a cached app as uncached.
    shell.value = !!await caches.match('/', { ignoreSearch: true })
  }

  /**
   * Install it now, on a connection somebody has chosen to be on.
   *
   * The head script already asks for this on every load, so this button is for
   * the device that has been failing to install quietly — a first visit that
   * was closed too early, or a worker that went away with the site data. It
   * needs the network, which is the one thing a phone reading this screen can
   * be assumed to have: nothing else on the settings screen loads without it.
   */
  async function setUp() {
    if (!supported || busy.value) return
    busy.value = true
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      await registration.update().catch(() => {})
      // Registering resolves as soon as the worker is installing; the precache
      // it exists for lands some seconds later. Poll rather than promise on it,
      // because "ready" here means the shell is in the cache, not that a worker
      // object exists.
      for (let attempt = 0; attempt < 40 && !ready.value; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500))
        await check()
      }
    } catch {
      // Nothing to say that the unchanged reading does not already say.
    } finally {
      busy.value = false
      await check()
    }
  }

  onMounted(check)

  return { supported, worker, shell, ready, busy, check, setUp }
}
