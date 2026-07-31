/**
 * RFC 4122 version 5 UUIDs, for the Edge Function side of the fence.
 *
 * The app has its own copy at app/utils/uuid5.ts. This is not laziness: a
 * deployed function is bundled from supabase/functions, so it cannot reach into
 * app/ at deploy time, and a relative import across that boundary would work
 * locally and fail in production.
 *
 * Where the app hand-rolls SHA-1 to keep id minting synchronous inside a
 * derivation loop, this one uses crypto.subtle — a sync loop is not a
 * constraint here, and twenty lines of platform crypto beats ninety of our own.
 * tests/calendar-map.test.ts asserts the two agree, because the day they
 * disagree every calendar row is minted twice.
 */

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)
  ].join('-')
}

export async function uuidv5(namespace: string, name: string): Promise<string> {
  const nameBytes = new TextEncoder().encode(name)
  const input = new Uint8Array(16 + nameBytes.length)
  input.set(uuidToBytes(namespace))
  input.set(nameBytes, 16)

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
  const bytes = digest.slice(0, 16)
  // Version 5 in the high nibble of byte 6, RFC 4122 variant in the top bits of byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return bytesToUuid(bytes)
}

/**
 * The namespace for calendar events, keyed on (calendar id, Google event id).
 *
 * Fixed forever. Changing it would re-mint every row on the next sync, and the
 * board would show each of today's events twice until the old ones aged out.
 */
export const CALENDAR_NAMESPACE = '2a7c9e50-6b13-4d8a-91f4-5c0e8b3a7d61'
