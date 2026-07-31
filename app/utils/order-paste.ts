/**
 * Reading a supermarket order confirmation, so putting the shop away is a paste
 * rather than forty taps.
 *
 * The online shop already knows exactly what arrived and in what sizes. Getting
 * that into the pantry by hand is the kind of chore nobody does twice, so this
 * parses the confirmation email or order page as text — no API, no login, nothing
 * to break when a supermarket redesigns something.
 *
 * The parser is deliberately dim. It reads a count, a pack size and a name, and
 * gives up on anything else rather than guessing, because a wrong number here
 * becomes a wrong number on a shopping list weeks later. Everything it produces
 * goes in front of a person before a single row is written — the review step is
 * not a courtesy, it is what makes a heuristic parser safe to use at all.
 *
 * Pure, and knows nothing about Pinia, Dexie or the database.
 */

import type { BaseUnit, PurchaseUnit } from './quantity'
import { foldUnit, intrinsicBaseUnit, parseQuantity, toBaseAmount } from './quantity'

/** One line of a pasted order, as far as the text alone can be read. */
export interface OrderLine {
  /** The line as pasted, so a person can always see what the app was looking at. */
  raw: string
  /** How many of them arrived. 1 unless the line says otherwise. */
  count: number
  /** The line with the count, pack size and price taken off. */
  name: string
  /** Base units in one of them — a 400g tin is 400 — or null if the line never said. */
  packBase: number | null
  /** The base unit that pack size is measured in, or null alongside packBase. */
  packUnit: BaseUnit | null
}

/**
 * Words that appear in an order without being shopping.
 *
 * A line is discarded only when every word on it is one of these, which is the
 * distinction that matters: "Total" is a receipt line and "Total Greek Yoghurt"
 * is breakfast. Matching the start of a line instead would lose the yoghurt, and
 * a shop that silently drops things is worse than no parser at all.
 */
const NOISE_WORDS = new Set([
  'total', 'subtotal', 'sub', 'order', 'orders', 'basket', 'trolley', 'delivery',
  'substitution', 'substitutions', 'substituted', 'unavailable', 'payment', 'paid',
  'vat', 'savings', 'saving', 'discount', 'discounts', 'thank', 'thanks', 'you',
  'your', 'item', 'items', 'qty', 'quantity', 'price', 'summary', 'checkout',
  'collection', 'slot', 'charge', 'charges', 'fee', 'to', 'pay', 'and', 'for'
])

/** Every run of letters on a line, lowercased. */
function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? []
}

/** A price anywhere it tends to trail: "£1.20", "1.20 each", "£3.00/kg". */
const PRICE = /(?:[£$€]\s*\d+(?:[.,]\d{1,2})?(?:\s*\/\s*\w+)?|\b\d+[.,]\d{2}\s*(?:each|per\s+\w+)?)\s*$/i

/** "4 x 110g" and friends, taken before the single-pack pattern so the 4 is not lost. */
const MULTIPACK = /(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*([a-z]+)\b/i

/** "400g", "1.5 kg", "568ml". */
const PACK = /(\d+(?:[.,]\d+)?)\s*([a-z]+)\b/gi

/** A leading "2 x " or "3 × ". */
const LEADING_MULTIPLIER = /^(\d+)\s*[x×]\s+/i

/** A leading bare count: "2 Onions". */
const LEADING_COUNT = /^(\d+)\s+(?=\S)/

function toNumber(text: string): number {
  return Number(text.replace(',', '.'))
}

function tidy(name: string): string {
  return name
    .replace(/^[\s,;:·•\-–—]+/, '')
    .replace(/[\s,;:·•\-–—]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Pull a pack size out of a line, and return the line without it.
 *
 * Multipacks first: "4 x 110g" is 440g in one line item, and reading only the
 * 110 would understate the shop by a factor of four. Single sizes are read from
 * the last one on the line, because "Tomatoes 400g tin, 2 for 500g offer" style
 * noise puts the useful number nearer the end than the start.
 */
function readPack(text: string): { base: number, unit: BaseUnit, rest: string } | null {
  const multi = text.match(MULTIPACK)
  if (multi) {
    // Folded, so that "2 litres" is read as litres rather than as a word this
    // knows nothing about.
    const word = foldUnit(multi[3]!)
    const unit = intrinsicBaseUnit(word)
    const each = parseQuantity(`${multi[2]}${word}`)
    const base = unit && each ? toBaseAmount(each, unit) : null
    if (unit && base !== null && base > 0) {
      const count = toNumber(multi[1]!)
      if (count > 0) {
        return { base: base * count, unit, rest: text.replace(multi[0], ' ') }
      }
    }
  }

  let found: { base: number, unit: BaseUnit, match: string } | null = null
  for (const match of text.matchAll(PACK)) {
    const word = foldUnit(match[2]!)
    const unit = intrinsicBaseUnit(word)
    if (!unit) continue
    const parsed = parseQuantity(`${match[1]}${word}`)
    const base = parsed ? toBaseAmount(parsed, unit) : null
    if (base === null || !(base > 0)) continue
    found = { base, unit, match: match[0] }
  }

  return found ? { base: found.base, unit: found.unit, rest: text.replace(found.match, ' ') } : null
}

/**
 * Read a pasted order into lines worth looking at.
 *
 * Lines that carry no name survive nothing here: a bare price, a header, a blank.
 * Everything else comes through, including things this app will never match to an
 * ingredient, because a line the parser drops silently is a line a person cannot
 * correct.
 */
export function parseOrderText(text: string): OrderLine[] {
  const lines: OrderLine[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const raw = rawLine.trim()
    if (!raw) continue

    // Prices can stack up at the end of a line: "Onions 3 pack £1.20 £1.20".
    // Taken off before anything else is judged, so "Total £27.60" is read as the
    // word "total" rather than as a line with a number on it.
    let body = raw
    let stripped = body.replace(PRICE, '').trim()
    while (stripped && stripped !== body) {
      body = stripped
      stripped = body.replace(PRICE, '').trim()
    }

    const spoken = words(body)
    if (!spoken.length || spoken.every(word => NOISE_WORDS.has(word))) continue

    let count = 1
    const multiplier = body.match(LEADING_MULTIPLIER)
    if (multiplier) {
      count = toNumber(multiplier[1]!)
      body = body.slice(multiplier[0].length)
    }

    const pack = readPack(body)
    if (pack) body = pack.rest

    // A bare leading number is only a count once the pack size is out of the way.
    // Otherwise "500 g Flour" reads as five hundred bags of flour.
    if (!multiplier) {
      const bare = body.match(LEADING_COUNT)
      if (bare) {
        const value = toNumber(bare[1]!)
        if (value > 0 && value < 100) {
          count = value
          body = body.slice(bare[0].length)
        }
      }
    }

    const name = tidy(body)
    if (!name || !/[a-z]/i.test(name) || !(count > 0)) continue

    lines.push({
      raw,
      count,
      name,
      packBase: pack?.base ?? null,
      packUnit: pack?.unit ?? null
    })
  }

  return lines
}

/** What matching needs to know about the household's own ingredients. */
export interface MatchContext {
  /** The ingredient a name already means, or null. Never creates anything. */
  resolve: (name: string) => { id: string, name: string } | null
  baseUnitOf: (ingredientId: string) => BaseUnit
  purchaseUnitsOf: (ingredientId: string) => PurchaseUnit[]
  /** Base units of this ingredient the shopping list is currently asking for. */
  neededOf: (ingredientId: string) => number
}

export interface OrderMatch {
  line: OrderLine
  ingredientId: string | null
  ingredientName: string | null
  /** Base units that arrived, or null when the line does not say enough to know. */
  bought: number | null
  /** What the list wanted, for a person to sanity-check the match against. */
  needed: number
  /** What to add to the pantry: everything that arrived, for a person to edit. */
  deposit: number
  /** Whether to write this line by default. Anything uncertain starts off. */
  include: boolean
}

/**
 * Work out what each pasted line means for the pantry.
 *
 * The proposed deposit is the whole amount that arrived, not the surplus over
 * what the recipes wanted — which looks wrong at first glance and is the only
 * arithmetic that balances. The pantry is what is in the house. Everything bought
 * comes into the house; what gets cooked leaves it again when the night is
 * settled. Depositing only the surplus would take the cooking off twice, once by
 * never counting it in and once by settling it out, and the household would end
 * up short by exactly what it ate.
 *
 * The cost of that choice is real and worth naming: anything eaten off-plan —
 * toast, a raided cupboard, a packet of biscuits nobody planned — is never
 * settled and so drifts upwards. Which is why the review step is editable, and
 * why the pantry page lets somebody type the true number over the top. Correcting
 * a count you can see is a far smaller job than remembering to record a shop.
 */
export function matchOrderLines(lines: OrderLine[], context: MatchContext): OrderMatch[] {
  return lines.map((line) => {
    const ingredient = context.resolve(line.name)
    if (!ingredient) {
      return {
        line,
        ingredientId: null,
        ingredientName: null,
        bought: null,
        needed: 0,
        deposit: 0,
        include: false
      }
    }

    const baseUnit = context.baseUnitOf(ingredient.id)
    let bought: number | null = null

    if (line.packBase !== null && line.packUnit === baseUnit) {
      bought = line.count * line.packBase
    } else if (baseUnit === 'count') {
      // Nothing said a weight and the thing is counted, so the count is the answer.
      bought = line.count
    } else {
      // A weight or a volume with no size on the line. The household's own idea of
      // how it is bought is the only thing left to go on.
      const unit = context.purchaseUnitsOf(ingredient.id)[0]
      if (unit && unit.amount > 0) bought = line.count * unit.amount
    }

    return {
      line,
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      bought,
      needed: context.neededOf(ingredient.id),
      deposit: bought ?? 0,
      // A line whose size could not be worked out is shown, but not ticked: the
      // number beside it would be a guess, and guesses need a person's eye.
      include: bought !== null && bought > 0
    }
  })
}
