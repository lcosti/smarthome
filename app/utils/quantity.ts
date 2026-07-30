/**
 * Reading the quantities people actually type, so that two recipes asking for
 * tomatoes can be added up.
 *
 * Quantities stay free text. Nobody is going to fill in a number field and a unit
 * dropdown to write down a recipe — that friction is the whole reason the Notion
 * page lost — so this parses what is already there and simply gives up when it
 * cannot. A line that does not parse is not an error: it travels to the shopping
 * list verbatim and sits beside the total rather than inside it.
 *
 * Everything here is pure and knows nothing about Pinia, Dexie or the database.
 */

/** The unit an ingredient is summed in. Mirrors ingredients.base_unit. */
export type BaseUnit = 'g' | 'ml' | 'count'

export interface ParsedQuantity {
  /** Already multiplied by any trailing servings hint. */
  amount: number
  /**
   * The unit as written, lowercased and singular. Null for a bare number.
   * Kept as text because whether "tin" means anything depends on the ingredient.
   */
  unit: string | null
}

/** How to buy one of something: `{ name: 'tin', amount: 400 }` is a 400g tin. */
export interface PurchaseUnit {
  name: string
  amount: number
}

/** A unit that means the same thing for every ingredient, and its base equivalent. */
const INTRINSIC: Record<string, { base: BaseUnit, factor: number }> = {
  g: { base: 'g', factor: 1 },
  gram: { base: 'g', factor: 1 },
  gramme: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  kilo: { base: 'g', factor: 1000 },
  kilogram: { base: 'g', factor: 1000 },
  kilogramme: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  millilitre: { base: 'ml', factor: 1 },
  milliliter: { base: 'ml', factor: 1 },
  cl: { base: 'ml', factor: 10 },
  centilitre: { base: 'ml', factor: 10 },
  l: { base: 'ml', factor: 1000 },
  litre: { base: 'ml', factor: 1000 },
  liter: { base: 'ml', factor: 1000 }
}

/** The base unit an intrinsic unit implies, or null for anything household-specific. */
export function intrinsicBaseUnit(unit: string | null | undefined): BaseUnit | null {
  return unit ? INTRINSIC[unit]?.base ?? null : null
}

const VULGAR: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125
}

const VULGAR_CLASS = Object.keys(VULGAR).join('')

/**
 * Fold a unit word to the form used as a key: lowercase and singular.
 *
 * Plurals are stripped rather than looked up, because the vocabulary is whatever
 * the household writes on a recipe line. "tins" and "packs" lose the s; "bunches"
 * and "boxes" lose the es, which is why that case is tested separately.
 */
export function foldUnit(word: string): string {
  const lower = word.trim().toLowerCase()
  if (/(?:s|x|z|ch|sh)es$/.test(lower)) return lower.slice(0, -2)
  if (/[^s]s$/.test(lower)) return lower.slice(0, -1)
  return lower
}

/** "tin" -> "tins" when there is more than one. Naive on purpose. */
export function pluralise(word: string, count: number): string {
  if (Math.abs(count - 1) < 1e-9) return word
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`
  return `${word}s`
}

/**
 * Consume a leading number, returning it and whatever follows.
 *
 * Ordered longest-form-first: "1 1/2" has to be tried before "1", or the integer
 * matches alone and the fraction is left behind as unparseable junk.
 */
function leadingNumber(text: string): { value: number, rest: string } | null {
  const patterns: [RegExp, (m: RegExpMatchArray) => number][] = [
    // 1 1/2
    [/^(\d+)\s+(\d+)\s*\/\s*(\d+)/, m => Number(m[1]) + Number(m[2]) / Number(m[3])],
    // 1½ or 1 ½
    [new RegExp(`^(\\d+)\\s*([${VULGAR_CLASS}])`), m => Number(m[1]) + VULGAR[m[2]!]!],
    // 1/2
    [/^(\d+)\s*\/\s*(\d+)/, m => Number(m[1]) / Number(m[2])],
    // ½
    [new RegExp(`^([${VULGAR_CLASS}])`), m => VULGAR[m[1]!]!],
    // 400 or 1.5 or 1,5 — but not 1,500, where the comma is a thousands
    // separator and reading it as a decimal would shrink the amount a
    // thousandfold. Three or more digits after a comma means give up.
    [/^(\d+(?:[.,]\d+)?)/, m => /,\d{3}/.test(m[1]!) ? Number.NaN : Number(m[1]!.replace(',', '.'))]
  ]

  for (const [pattern, read] of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const value = read(match)
    if (!Number.isFinite(value)) return null
    return { value, rest: text.slice(match[0].length).trim() }
  }
  return null
}

/**
 * Read a quantity string, or null if it is not a quantity at all.
 *
 * Accepts exactly `<number> [unit] [x<ratio>]` and nothing else. "2 tins drained"
 * is rejected along with "a splash" and "2-3", because a parser that guesses at
 * prose would put confident wrong numbers on a shopping list, which is worse than
 * putting the words there unchanged.
 *
 * The trailing "x1.5" is the servings hint that derive writes when a night is
 * cooked for more people than the recipe serves — see servingsHint in derive.ts.
 * Reading it here is what turns that annotation into real arithmetic without
 * derive having to store a scaled number it would then have to keep correct.
 */
export function parseQuantity(text: string | null | undefined): ParsedQuantity | null {
  if (!text) return null
  let body = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!body) return null

  // Peel the servings hint off the end first, so the rest is what a person wrote.
  // The × derive writes is always a hint; a plain ascii x only counts as one when
  // it follows a unit word ("400g x2"), because after a bare number ("2 x 400")
  // it is somebody writing two-of-something, not a ratio.
  let ratio = 1
  const hint = body.match(/\s*(×|x)\s*(\d+(?:[.,]\d+)?)$/)
  if (hint && (hint[1] === '×' || /[a-z]$/.test(body.slice(0, hint.index).trim()))) {
    ratio = Number(hint[2]!.replace(',', '.'))
    if (!Number.isFinite(ratio) || ratio <= 0) return null
    body = body.slice(0, hint.index).trim()
  }
  if (!body) return null

  const number = leadingNumber(body)
  if (!number) return null

  // One unit word, letters only, or nothing. Anything else and we do not know
  // what we are looking at.
  const rest = number.rest
  if (rest && !/^[a-z]+$/.test(rest)) return null

  return { amount: number.value * ratio, unit: rest ? foldUnit(rest) : null }
}

/**
 * A parsed quantity expressed in an ingredient's base unit, or null when it cannot
 * be — which is the signal to show it as written instead of adding it in.
 *
 * Deliberately strict. A bare number is only a count when the ingredient is
 * counted; "400" on a flour line does not silently become 400g, and millilitres
 * never become grams.
 */
export function toBaseAmount(
  parsed: ParsedQuantity,
  baseUnit: BaseUnit,
  purchaseUnits: PurchaseUnit[] = []
): number | null {
  if (!parsed.unit) return baseUnit === 'count' ? parsed.amount : null

  const intrinsic = INTRINSIC[parsed.unit]
  if (intrinsic) return intrinsic.base === baseUnit ? parsed.amount * intrinsic.factor : null

  // Not a measure, so it has to be something this household buys it in.
  const unit = purchaseUnits.find(p => foldUnit(p.name) === parsed.unit)
  if (unit && unit.amount > 0) return parsed.amount * unit.amount

  return null
}

/** Up to `places` decimals, with trailing zeros dropped: 1.20 -> "1.2". */
function trimNumber(value: number, places: number): string {
  return String(Number(value.toFixed(places)))
}

/**
 * A base-unit total as it should read on the list: "800g", "1.2kg", "1.5l", "3".
 *
 * Scales up past a thousand because "1200g" is a number you have to think about
 * and "1.2kg" is one you can read off a packet.
 */
export function formatBaseAmount(amount: number, baseUnit: BaseUnit): string {
  if (baseUnit === 'count') return trimNumber(amount, 2)
  const big = baseUnit === 'g' ? 'kg' : 'l'
  // Judge against the rounded value, or 999.96 slips past as "1000g".
  if (Number(amount.toFixed(1)) >= 1000) return `${trimNumber(amount / 1000, 2)}${big}`
  return `${trimNumber(amount, 1)}${baseUnit}`
}

/**
 * How many to put in the trolley for a given total, rounded up.
 *
 * Up, always: three and a bit tins means buying four. `exact` says whether the
 * total landed on a whole number of them, so the caller can mark the difference
 * rather than quietly implying the recipe wanted a round amount.
 */
export function purchaseCount(
  baseAmount: number,
  unit: PurchaseUnit
): { count: number, exact: boolean } | null {
  if (!(unit.amount > 0) || !(baseAmount > 0)) return null
  const raw = baseAmount / unit.amount
  const count = Math.ceil(raw - 1e-9)
  return { count, exact: Math.abs(raw - count) < 1e-9 }
}

/** "2 tins", or "~3 tins" when the total does not divide evenly. */
export function formatPurchase(baseAmount: number, unit: PurchaseUnit): string | null {
  const result = purchaseCount(baseAmount, unit)
  if (!result) return null
  const label = `${result.count} ${pluralise(foldUnit(unit.name), result.count)}`
  return result.exact ? label : `~${label}`
}
