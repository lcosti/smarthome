const KEY = 'shoplist.identity'

export interface LocalIdentity {
  householdId: string
  userId: string
}

/**
 * Which household this device belongs to, in localStorage rather than IndexedDB so
 * that route middleware can read it synchronously.
 *
 * This — not the presence of a live session — is what gates the UI. An access
 * token expires after an hour, so a phone opened in a supermarket after a long
 * gap may have no valid session until it can reach the network. The list still has
 * to open, and writes still have to queue. Auth is needed to sync, not to shop.
 */
export function readIdentity(): LocalIdentity | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LocalIdentity>
    if (!parsed.householdId || !parsed.userId) return null
    return { householdId: parsed.householdId, userId: parsed.userId }
  } catch {
    return null
  }
}

export function writeIdentity(identity: LocalIdentity): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(identity))
}

export function clearIdentity(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(KEY)
}
