// Pulling "400g" off the front of "400g chopped tomatoes".
//
// Structured recipe data gives one string per ingredient, quantity and all,
// where the photo importer's model is asked for the two separately. Without the
// split every imported line would mint a canonical ingredient called "400g
// chopped tomatoes" — a row nothing else will ever resolve to, in the library
// that Phase 3 exists to keep clean.
//
// The forms accepted here mirror app/utils/quantity.ts:parseQuantity, so what
// comes out the front is what the app can later read a number and a unit from.
// Deno cannot import across into app/, hence the second implementation; the
// tests for both live side by side.
//
// Pure: no Deno APIs, so tests/ingredient-line.test.ts imports it directly.

/** Unit words, singular. Only a word in here is taken into the quantity. */
const UNITS = new Set([
  // Measures.
  'g', 'gram', 'gramme', 'kg', 'kilo', 'kilogram', 'kilogramme', 'mg',
  'ml', 'millilitre', 'milliliter', 'cl', 'l', 'litre', 'liter',
  'tsp', 'teaspoon', 'tbsp', 'tbs', 'tablespoon', 'dsp', 'dessertspoon',
  'oz', 'ounce', 'lb', 'pound', 'cup', 'pint', 'pt', 'quart', 'fl',
  // What a kitchen counts in.
  'tin', 'can', 'jar', 'pack', 'packet', 'bag', 'box', 'punnet', 'bottle',
  'clove', 'sprig', 'stick', 'stalk', 'slice', 'rasher', 'sheet', 'head',
  'bunch', 'handful', 'pinch', 'dash', 'drop', 'splash', 'glug', 'knob',
  'piece', 'strip', 'fillet', 'ball', 'square', 'block'
])

/**
 * A trailing clause that describes what to do to the ingredient, not what it is.
 * "2 cloves of garlic, finely chopped" is garlic. Kept deliberately short: a word
 * that might be part of a name ("tinned", "smoked", "ground") is not in here,
 * because dropping half a name is worse than keeping a stray instruction.
 */
const PREPARATION = new Set([
  'chopped', 'finely', 'roughly', 'thinly', 'diced', 'sliced', 'minced',
  'crushed', 'peeled', 'grated', 'torn', 'halved', 'quartered', 'trimmed',
  'drained', 'rinsed', 'beaten', 'melted', 'softened', 'cubed', 'shredded',
  'deseeded', 'de-seeded', 'zested', 'juiced', 'to', 'plus', 'optional'
])

const VULGAR = '½⅓⅔¼¾⅛⅜⅝⅞'

/** Longest form first: "1 1/2" has to beat "1", or the fraction is left behind. */
const NUMBER = new RegExp(
  '^(?:'
  + `\\d+\\s+\\d+\\s*/\\s*\\d+` // 1 1/2
  + `|\\d+\\s*[${VULGAR}]` // 1½
  + `|\\d+\\s*/\\s*\\d+` // 1/2
  + `|[${VULGAR}]` // ½
  + `|\\d+(?:[.,]\\d+)?(?:\\s*(?:-|–|—|to)\\s*\\d+(?:[.,]\\d+)?)?` // 400, 1.5, 2-3
  + ')'
)

/** Lowercase and singular, the same fold quantity.ts uses to look a unit up. */
function foldUnit(word: string): string {
  const lower = word.trim().toLowerCase().replace(/\.$/, '')
  if (/(?:s|x|z|ch|sh)es$/.test(lower)) return lower.slice(0, -2)
  if (/[^s]s$/.test(lower)) return lower.slice(0, -1)
  return lower
}

function tidyName(text: string): string {
  let name = text.replace(/^[\s,;:.\-–—]+/, '').replace(/\s+/g, ' ').trim()
  if (/^of\s+/i.test(name)) name = name.slice(3).trim()

  // Drop a trailing preparation clause, but only when something is left.
  const comma = name.lastIndexOf(',')
  if (comma > 0) {
    const clause = name.slice(comma + 1).trim().toLowerCase()
    const first = clause.split(/\s+/)[0]?.replace(/[^a-z-]/g, '') ?? ''
    if (PREPARATION.has(first)) name = name.slice(0, comma).trim()
  }

  return name
}

/**
 * Split one written ingredient line into the quantity and the thing itself.
 *
 * A unit word is only taken when it is a unit this kitchen would recognise:
 * "1 onion, diced" must not become a quantity of "1 onion" and an ingredient
 * called "diced". Anything with no leading number keeps the whole line and no
 * quantity — "salt and pepper" is an ingredient, not a measurement.
 */
export function splitIngredientLine(line: string): { name: string, quantity: string | null } {
  const trimmed = line.replace(/\s+/g, ' ').trim()
  if (!trimmed) return { name: '', quantity: null }

  const number = trimmed.match(NUMBER)
  if (!number) return { name: tidyName(trimmed), quantity: null }

  // Walk a cursor rather than rebuilding from tokens, so the quantity comes out
  // spaced exactly as it was written.
  let cursor = number[0].length
  let afterMultiplier = false

  for (;;) {
    const rest = trimmed.slice(cursor)

    // "1 x 400g tin tomatoes": the multiplier and everything it multiplies is
    // still the quantity.
    const multiplier = rest.match(/^\s*(?:x|×)(?=\s|\d)/i)
    if (multiplier) {
      cursor += multiplier[0].length
      afterMultiplier = true
      continue
    }
    if (afterMultiplier) {
      const amount = rest.match(/^\s*\d+(?:[.,]\d+)?/)
      if (amount) {
        cursor += amount[0].length
        afterMultiplier = false
        continue
      }
    }

    // A unit only counts when it is a unit: "1 onion, diced" must not become a
    // quantity of "1 onion" and an ingredient called "diced".
    const word = rest.match(/^\s*([a-zA-Z]+\.?)(?=\s|$)/)
    if (word && UNITS.has(foldUnit(word[1]!))) {
      cursor += word[0].length
      // "fl oz" is one unit written as two words.
      if (foldUnit(word[1]!) === 'fl') {
        const ounces = trimmed.slice(cursor).match(/^\s*(?:oz|ounces?)(?=\s|$)/i)
        if (ounces) cursor += ounces[0].length
      }
      continue
    }

    break
  }

  const name = tidyName(trimmed.slice(cursor))
  // A line that is nothing but a number is a quantity of what, exactly? Keep it
  // whole rather than committing an ingredient with no name.
  if (!name) return { name: trimmed, quantity: null }

  return { name, quantity: trimmed.slice(0, cursor).trim() }
}
