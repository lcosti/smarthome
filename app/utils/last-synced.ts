/**
 * When this device last completed a full pull.
 *
 * In localStorage rather than IndexedDB, for the same reason identity.ts is: it
 * is one scalar, and the wall board wants it on the first paint rather than one
 * tick later. A board that renders "Offline" and then, half a second afterwards,
 * fills in "last synced 15:58" has flickered on a wall for no reason.
 *
 * This is deliberately not `reachable`. Reachable is a live boolean about right
 * now; this is a timestamp about the last time the data on screen was known to be
 * true, which is the only honest thing a stale board can say about itself.
 */

const KEY = 'shoplist.lastSyncedAt'

export function readLastSyncedAt(): string | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(KEY)
  // Anything unparseable is treated as never synced. Claiming a bad timestamp is
  // worse than admitting to none.
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null
}

export function writeLastSyncedAt(iso: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, iso)
}

export function clearLastSyncedAt(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(KEY)
}
