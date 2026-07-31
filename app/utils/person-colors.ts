/**
 * One colour per person, for the wall dashboard.
 *
 * The whole palette is a function of a single hue angle. Lightness and chroma are
 * fixed across everybody, so no person is louder than another and the four
 * avatars read as one system rather than four decisions — which is the point:
 * these colours are an identity code, not decoration. Adding a fifth household
 * member is one more entry in HUES.
 *
 * Everything stays in oklch. Converting to hex would flatten the relationship the
 * palette is built on: at fixed L and C, rotating hue is the only thing that
 * changes, and equal steps of hue are equal steps of perceived difference. The
 * same rotation in sRGB hex is not evenly spaced at all.
 */

/**
 * The rotation, in the order people are assigned it.
 *
 * The first four are the ones the design was drawn with — coral, blue, green,
 * violet — chosen to be distinguishable across a room and, deliberately, not to
 * collide with the amber the board reserves for attention and staleness.
 */
export const HUES = [25, 232, 148, 305, 88, 265, 190, 340] as const

/** Somebody the palette can be assigned to. Ordering fields only. */
export interface HueSubject {
  id: string
  created_at: string
}

/**
 * Which hue a person gets: their position in the household, oldest row first.
 *
 * Ordered by `created_at` rather than by the people store's display order, which
 * sorts adults before babies by derived life stage. That order is right for a
 * page and wrong for this: the baby turning one would re-sort the roster and
 * every avatar on the wall would silently change colour overnight. Joining order
 * never changes.
 *
 * Falls back to the end of the rotation for anybody not in the list, so a person
 * who has just been added — and is not yet in the array the caller passed — still
 * renders with a colour rather than with undefined.
 */
export function personHue(personId: string, people: readonly HueSubject[]): number {
  const ordered = [...people].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  )
  const index = ordered.findIndex(person => person.id === personId)
  return HUES[(index === -1 ? ordered.length : index) % HUES.length]!
}

/** An avatar's three colours: the ring around it, its fill, and the initial. */
export interface AvatarColors {
  ring: string
  tint: string
  ink: string
  nameInk: string
}

/**
 * Colours for a roster avatar.
 *
 * Somebody who is out loses their hue entirely rather than getting a dimmer
 * version of it. A washed-out coral still reads as "Naomi's colour, but odd";
 * neutral grey reads as "not tonight", which is the actual meaning. The struck
 * name and reduced opacity are applied by the component, not here.
 */
export function personColors(hue: number, options: { absent?: boolean } = {}): AvatarColors {
  if (options.absent) {
    return {
      ring: 'oklch(0.36 0.012 62)',
      tint: 'oklch(0.22 0.008 62)',
      ink: 'oklch(0.52 0.012 75)',
      nameInk: 'oklch(0.52 0.012 75)'
    }
  }
  return {
    ring: `oklch(0.72 0.13 ${hue})`,
    tint: `oklch(0.32 0.06 ${hue})`,
    ink: `oklch(0.88 0.10 ${hue})`,
    nameInk: 'oklch(0.92 0.008 75)'
  }
}

/** A tinted chip: the cook pill, and the "added by" toast on the shopping card. */
export interface ChipColors {
  bg: string
  border: string
  tint: string
  ink: string
  ring: string
  text: string
}

/**
 * Colours for a chip carrying a person's hue.
 *
 * Quieter than {@link personColors} on purpose — a chip is a whole filled shape
 * rather than a small circle, so the same chroma at the same lightness would
 * shout. The avatar inside it keeps the stronger values.
 */
export function chipColors(hue: number): ChipColors {
  return {
    bg: `oklch(0.23 0.03 ${hue})`,
    border: `oklch(0.40 0.06 ${hue})`,
    tint: `oklch(0.34 0.06 ${hue})`,
    ink: `oklch(0.86 0.09 ${hue})`,
    ring: `oklch(0.76 0.13 ${hue})`,
    text: `oklch(0.90 0.02 ${hue})`
  }
}

/** The letter on the avatar. Uppercase, and never empty for a named person. */
export function initialOf(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?'
}
