/**
 * Nights that are planned as not being cooked.
 *
 * A takeaway is a decision, not a gap. Recording it as an empty night meant the
 * generator kept offering to fill Friday, the aside counted it as unplanned, and
 * the board said nothing was on. A skipped night is an entry like any other —
 * it simply has no recipe on it — and this is the small vocabulary it speaks.
 *
 * Four reasons, not free text: what somebody wants on a Tuesday is one tap, and
 * four buttons cover every version of "we're not cooking" this house has. The
 * token is what is stored; the label is what is read, and changing the wording
 * later changes it everywhere without touching a row.
 *
 * The icons are chosen at runtime from stored tokens, so the icon scanner cannot
 * see them — they are listed in nuxt.config's client bundle by hand, or a night
 * on a tablet with no signal shows a blank where its reason should be.
 */
export interface SkipReason {
  value: string
  label: string
  icon: string
}

export const SKIP_REASONS: SkipReason[] = [
  { value: 'takeaway', label: 'Takeaway', icon: 'i-lucide-bike' },
  { value: 'out', label: 'Eating out', icon: 'i-lucide-utensils-crossed' },
  { value: 'someone_else', label: 'Someone else cooking', icon: 'i-lucide-users' },
  { value: 'other', label: 'Something else', icon: 'i-lucide-circle-slash' }
]

const BY_VALUE = new Map(SKIP_REASONS.map(reason => [reason.value, reason]))

/**
 * What a skipped night calls itself.
 *
 * An unrecognised token — a reason added by a newer client, or one retired since
 * — falls back to the plain statement rather than showing a raw token or an
 * empty space. The night is still legible; only the flourish is lost.
 */
export const NOT_COOKING = 'Not cooking'

export function skipLabel(reason: string | null | undefined): string {
  return (reason ? BY_VALUE.get(reason)?.label : null) ?? NOT_COOKING
}

export function skipIcon(reason: string | null | undefined): string {
  return (reason ? BY_VALUE.get(reason)?.icon : null) ?? 'i-lucide-circle-slash'
}
