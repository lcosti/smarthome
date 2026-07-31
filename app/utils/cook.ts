/**
 * Reading a recipe step aloud to yourself, one at a time.
 *
 * Cook mode shows a single step at wall size with a timer under it, but a step
 * is one column of free text and nothing else — the schema deliberately refused
 * a title/body split, and adding duration and tip columns would mean every
 * recipe already in the library had empty ones.
 *
 * So both come out of the prose. A step written the way people write steps
 * already says how long it takes ("soak for 20 mins") and already puts the
 * aside in its own paragraph. Reading that is a guess, which is why it fails
 * quietly: no duration found means no timer, not a timer set to zero.
 *
 * Pure functions over strings, so the parsing is tested rather than eyeballed
 * on a wall.
 */

export interface CookStepContent {
  /** The instruction itself — what goes on screen at 46px. */
  main: string
  /** Everything after the first blank line, or null. */
  tip: string | null
}

/**
 * The first paragraph is the step; the rest is the aside.
 *
 * Recipe prose separates "do this" from "and by the way" with a blank line
 * often enough to be worth reading, and when it doesn't the whole body is the
 * step, which is the old behaviour.
 */
export function splitStepBody(body: string): CookStepContent {
  const paragraphs = body
    .split(/\r?\n\s*\r?\n/)
    .map(part => part.trim())
    .filter(Boolean)

  return {
    main: paragraphs[0] ?? '',
    tip: paragraphs.length > 1 ? paragraphs.slice(1).join('\n\n') : null
  }
}

export interface CookTimerSpec {
  seconds: number
  /** "20 min", "1 hr 30 min", "90 sec" — what the button offers to start. */
  label: string
  /**
   * "Soak", "Roast" — what the timer is for, or null when the prose does not
   * say plainly enough. A running timer pinned to the top bar needs a name,
   * because "17:17" on its own is a number with nothing attached to it.
   */
  name: string | null
}

const UNIT = 'hours?|hrs?|minutes?|mins?|seconds?|secs?'

/**
 * Ranges first, so "10-12 mins" is one match and not the number 10.
 *
 * Alternation is tried left to right at each position, so listing the range
 * ahead of the plain form gives it priority where both could start.
 */
const DURATION = new RegExp(
  [
    `\\d+\\s*(?:-|–|—|\\s+to\\s+)\\s*(?<rangeHigh>\\d+)\\s*(?<rangeUnit>${UNIT})\\b`,
    `(?<plain>\\d+)(?<plainHalf>\\s*½|\\s+1\\/2)?\\s*(?<plainUnit>${UNIT})\\b`,
    `½\\s*(?<loneUnit>${UNIT})\\b`
  ].join('|'),
  'i'
)

/**
 * Cooking verbs, as a closed list.
 *
 * Naming the timer means finding the verb the duration belongs to, and the
 * obvious rule — the word before "for" — gets "chicken" out of "brown the
 * chicken for 8 mins". Recipe prose is not general English: it is a few dozen
 * verbs used over and over, so they are simply listed. Anything outside the
 * list leaves the timer unnamed, which is the honest outcome and how it read
 * before there were names at all.
 */
const VERBS = [
  'soak', 'simmer', 'boil', 'bake', 'roast', 'fry', 'sauté', 'saute', 'cook', 'rest',
  'chill', 'marinate', 'steam', 'grill', 'brown', 'reduce', 'prove', 'proof', 'knead',
  'infuse', 'steep', 'poach', 'sear', 'toast', 'blanch', 'braise', 'sweat', 'warm',
  'cool', 'stand', 'set', 'freeze', 'refrigerate', 'defrost', 'rise'
]

/**
 * No "-ing". A step is an instruction, so the verb being timed is an imperative
 * — "Soak for 20 mins". A participle is almost always describing an ingredient
 * instead, and "soak the porcini in boiling water" would otherwise name the
 * timer Boil, after the thing you poured rather than the thing you are waiting
 * for.
 */
const VERB = new RegExp(`\\b(${VERBS.join('|')})(?:s|ed)?\\b`, 'gi')

/**
 * The last cooking verb before the duration, title-cased.
 *
 * Last, not first: a step often does something else before the thing it wants
 * timed — "pour over 1 litre boiling water. Soak for 20 mins" is a pour and
 * then a soak, and it is the soak you are counting.
 */
function nameBefore(text: string, index: number): string | null {
  let verb: string | undefined
  for (const match of text.slice(0, index).matchAll(VERB)) verb = match[1]
  if (!verb) return null
  return verb[0]!.toUpperCase() + verb.slice(1).toLowerCase()
}

const PER_UNIT = { hour: 3600, minute: 60, second: 1 } as const

type UnitKind = keyof typeof PER_UNIT

function unitKind(word: string): UnitKind {
  const first = word[0]!.toLowerCase()
  if (first === 'h') return 'hour'
  if (first === 's') return 'second'
  return 'minute'
}

function labelOf(seconds: number, kind: UnitKind): string {
  // A step that says "90 seconds" should offer 90 sec, not 2 min. The unit the
  // recipe chose is the one the cook is counting in.
  if (kind === 'second') return `${seconds} sec`
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.round((seconds % 3600) / 60)
    return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`
  }
  return `${Math.round(seconds / 60)} min`
}

/**
 * The first duration mentioned in a step, if there is one.
 *
 * First, not longest: recipe prose leads with the action you are about to take
 * and mentions other times in passing ("simmer 10 mins — the whole dish is 45").
 * A range resolves to its upper bound, because a timer that goes off early is
 * one you have to reset, and undercooked is worse than checked twice.
 *
 * Returns null for anything that is not a number followed by a time word, so
 * quantities and oven settings never become timers.
 */
export function findStepDuration(text: string): CookTimerSpec | null {
  const match = DURATION.exec(text)
  if (!match?.groups) return null

  const { rangeHigh, rangeUnit, plain, plainHalf, plainUnit, loneUnit } = match.groups

  // The low end of a range is matched but never captured: it exists to be
  // stepped over so "10-12 mins" is one duration rather than the number 10.
  const [amount, word] = rangeUnit
    ? [Number(rangeHigh), rangeUnit]
    : plainUnit
      ? [Number(plain) + (plainHalf ? 0.5 : 0), plainUnit]
      : loneUnit
        ? [0.5, loneUnit]
        : [0, null]

  if (!word) return null

  const kind = unitKind(word)
  const seconds = Math.round(amount * PER_UNIT[kind])
  return { seconds, label: labelOf(seconds, kind), name: nameBefore(text, match.index) }
}

/**
 * "20:00", "1:02:05", "0:05".
 *
 * Minutes lose their leading zero and seconds keep theirs, which is how a clock
 * reads. Below zero is clamped rather than shown negative — a finished timer
 * says nothing more than that it finished.
 */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}
