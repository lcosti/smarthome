/**
 * RFC 4122 version 5 UUIDs: a name hashed into a namespace, so the same inputs
 * always produce the same id.
 *
 * Derived shopping list items are keyed this way, on (plan entry, recipe
 * ingredient). Two phones deriving the same week while both offline mint
 * identical ids and their upserts converge onto one row, instead of producing
 * two copies of every ingredient the moment they reconnect.
 *
 * Hand-rolled rather than pulled from npm because it is forty lines, and
 * `crypto.subtle.digest` is async-only — awaiting it would make every id in the
 * derivation loop a promise.
 */

/** SHA-1 of a byte array. Deprecated for signatures; fine as the hash RFC 4122 specifies. */
function sha1(bytes: number[]): number[] {
  const ml = bytes.length * 8
  const message = [...bytes, 0x80]
  while (message.length % 64 !== 56) message.push(0)
  // Length as a 64-bit big-endian suffix. Names here are short, so the high word
  // is always zero.
  message.push(0, 0, 0, 0, (ml >>> 24) & 0xff, (ml >>> 16) & 0xff, (ml >>> 8) & 0xff, ml & 0xff)

  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const rotl = (n: number, s: number) => ((n << s) | (n >>> (32 - s))) >>> 0

  for (let i = 0; i < message.length; i += 64) {
    const w = new Array<number>(80)
    for (let j = 0; j < 16; j++) {
      const o = i + j * 4
      w[j] = ((message[o]! << 24) | (message[o + 1]! << 16) | (message[o + 2]! << 8) | message[o + 3]!) >>> 0
    }
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3]! ^ w[j - 8]! ^ w[j - 14]! ^ w[j - 16]!, 1)

    let [a, b, c, d, e] = [h0, h1, h2, h3, h4]
    for (let j = 0; j < 80; j++) {
      let f: number
      let k: number
      if (j < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (j < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }

      const t = (rotl(a, 5) + (f >>> 0) + e + k + w[j]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = t
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return [h0, h1, h2, h3, h4].flatMap(h => [(h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff])
}

/** The 16 bytes of a canonical UUID string, hyphens ignored. */
function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '')
  const bytes: number[] = []
  for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))
  return bytes
}

function bytesToUuid(bytes: number[]): string {
  const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)
  ].join('-')
}

export function uuidv5(namespace: string, name: string): string {
  const bytes = sha1([...uuidToBytes(namespace), ...new TextEncoder().encode(name)]).slice(0, 16)
  // Version 5 in the high nibble of byte 6, RFC 4122 variant in the top bits of byte 8.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return bytesToUuid(bytes)
}

/**
 * The namespace for derived shopping list items. Minted once for this app and
 * fixed forever: changing it would orphan every item already on a list.
 */
export const DERIVE_NAMESPACE = '6f9b1d84-3c2e-4a17-9b5f-0d8e7a41c6b2'

/**
 * The namespace for ingredient aliases, keyed on (household, ingredient, alias).
 *
 * Same trick as derived items, for the same reason: two people who both teach the
 * app that "tinned tomatoes" means chopped tomatoes mint the same row rather than
 * two, and converge through the ordinary last-write-wins path. Fixed forever.
 */
export const ALIAS_NAMESPACE = 'b3d2c5a1-7e48-4f26-8a09-1c6b4e5d3f70'

/**
 * The namespace for attendance, keyed on (household, person, date, meal).
 *
 * One cell of the roster is one row, whoever taps it. Two phones marking the same
 * child out on the same Tuesday must land on that row rather than two, because
 * "present" is read as the absence of a false — and two rows disagreeing would
 * make the answer depend on which one a device happened to see. Fixed forever.
 */
export const ATTENDANCE_NAMESPACE = 'd41c8f26-5a93-4e07-b8d1-2f7a6c904e35'

/**
 * The namespace for dietary constraints, keyed on (household, person, kind, tag).
 *
 * Both parents recording the peanut allergy is the expected case, not the odd
 * one. Fixed forever.
 */
export const CONSTRAINT_NAMESPACE = '9e5b3a74-1c62-4d8f-a057-3b8e1d47c026'

/**
 * The namespace for recipe adaptations, keyed on (household, recipe, audience).
 *
 * There is one weaning version of a recipe, not one per author: both parents
 * writing it up while offline must land on the same row and converge through
 * last-write-wins, exactly as constraints do. Fixed forever.
 */
export const ADAPTATION_NAMESPACE = '4c7d2e95-6a18-4b3f-9c40-8e5a1d72b609'

/**
 * The namespace for pantry stock, keyed on (household, ingredient).
 *
 * There is one answer to "how many onions are in the house", so there has to be
 * one row holding it. Two people unpacking the same shop offline would otherwise
 * create two, and the app would read whichever it saw rather than the truth.
 * Fixed forever.
 */
export const PANTRY_NAMESPACE = 'a5f30e62-8b14-4c79-9d2a-6e0b3f81c47d'

/**
 * The namespace for pantry reservations, keyed on (plan entry, ingredient).
 *
 * This is what makes deriving a week safe to repeat. The same night wanting the
 * same ingredient always mints the same id, so pressing the button again rewrites
 * one row instead of spending the stock a second time. Fixed forever.
 */
export const PANTRY_RESERVATION_NAMESPACE = '2f8c6b91-4d07-45ea-83b6-7c1a9e05d234'

/**
 * The namespace for chore completions, keyed on (household, chore, date).
 *
 * A chore's occurrences are never stored, only derived, so the tick is the one
 * row a day produces — and whoever takes the bins out is whoever happens to be
 * nearest the board. Two people ticking the same Tuesday must land on that row
 * rather than two, for the same reason attendance must. Fixed forever.
 */
export const CHORE_COMPLETION_NAMESPACE = '7c4e0a58-9b31-4d6f-a2c7-5e83b0d19f46'
