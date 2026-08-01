/**
 * What a recipe line is called once it is on the shopping list.
 *
 * A recipe says "chestnut mushrooms chopped" and "risotto rice such as arborio"
 * because it is telling you how to cook. In an aisle none of that is true yet:
 * you are buying mushrooms and you are buying risotto rice, and the extra words
 * are the difference between a line you read and a line you scan.
 *
 * Only ever applied on the way *out* of a recipe and into a list — see
 * `derive.ts`. The recipe keeps the cook's own wording, which is the whole point
 * of `IngredientLineEditor` round-tripping it verbatim.
 *
 * Deliberately conservative in the same way as its cousin in
 * `supabase/functions/_shared/ingredient-line.ts`, which strips the same clauses
 * off imported lines and cannot be imported from here (Deno). Two rules hold:
 *
 *  - Only trailing words are dropped. "Chopped tomatoes" is a tin you buy, not
 *    tomatoes somebody chopped, and leading words are where that lives.
 *  - Never strip a line down to nothing. A name half gone is worse than a name
 *    with a stray instruction on the end.
 */

/**
 * Words that describe what to do to the thing rather than what it is. The list
 * in `ingredient-line.ts`, plus the adverbs a trailing clause reaches for.
 *
 * A word that could be part of a name — "tinned", "smoked", "ground", "dried" —
 * stays out of here.
 */
const PREPARATION = new Set([
  'chopped', 'finely', 'roughly', 'thinly', 'coarsely', 'freshly', 'lightly',
  'diced', 'sliced', 'minced', 'crushed', 'peeled', 'grated', 'torn', 'halved',
  'quartered', 'trimmed', 'drained', 'rinsed', 'beaten', 'melted', 'softened',
  'cubed', 'shredded', 'deseeded', 'de-seeded', 'zested', 'juiced', 'sifted',
  'washed', 'scrubbed', 'stoned', 'pitted', 'cored', 'seeded', 'skinned',
  'boned', 'rolled', 'plus', 'optional'
])

/**
 * A clause naming an example or a substitute. "Risotto rice such as arborio" is
 * one thing on a shelf; the brand-level advice belongs in the recipe.
 *
 * `or similar` and friends only — a bare "or" is left alone, because "parmesan
 * or Grana Padano" is a genuine choice to make in front of the cheese.
 */
const QUALIFIER = /[,(]?\s*\b(?:such as|or similar|or other|preferably|ideally|if you can|e\.g\.?|eg\.?|i\.e\.?)\b.*$/i

/** Joining words that only ever trail once the clause after them has gone. */
const CONNECTIVE = new Set(['and', 'or', 'then', 'if', 'to', 'well', 'very'])

/**
 * Nouns an "or" is usually splitting the *adjective* of, not the thing itself.
 *
 * "chicken or vegetable stock" is one purchase with two flavours, and taking the
 * first alternative alone leaves "chicken" — which is a different aisle and a
 * different dinner. Where the alternative ends in one of these, the head noun is
 * carried back onto the first choice instead: "chicken stock".
 *
 * "parmesan or Grana Padano" ends in no such noun, so it collapses to the first
 * choice as it should.
 *
 * Only nouns whose first alternative is reliably a *modifier* are in here.
 * `cream` and `cheese` are deliberately out: "yoghurt or soured cream" has the
 * same shape as "chicken or vegetable stock" and the opposite meaning — yoghurt
 * is the thing, where chicken is only how the stock is flavoured — and no rule
 * on the words themselves can tell those apart. Leaving them out costs a longer
 * name; leaving them in invents "Yoghurt cream".
 */
const SHARED_HEAD = new Set([
  'stock', 'broth', 'flour', 'wine', 'sugar', 'milk', 'oil', 'rice', 'sauce',
  'yoghurt', 'yogurt', 'vinegar', 'mince', 'pasta', 'bread', 'beans',
  'lentils', 'butter', 'paste', 'juice', 'water', 'seeds', 'nuts'
])

/**
 * The first of two things a line offers a choice between.
 *
 * Only where the line is naming a substitute — "parmesan or Grana Padano" is one
 * cheese to buy, and reading the whole clause in a list you are scanning costs
 * more than the alternative is worth. The recipe keeps both, because at the hob
 * the choice is real.
 */
function takeFirstAlternative(name: string): string {
  const match = name.match(/^(.*?)\s+or\s+(.+)$/i)
  if (!match) return name

  const first = match[1]!.trim().replace(/[,;]$/, '')
  const rest = words(match[2]!.trim())
  if (!first || !rest.length) return name

  // A head noun comes back with the first choice only when the first choice is
  // plainly a modifier rather than a thing: one word, against an alternative of
  // two or more that ends in a noun they share. "chicken or vegetable stock" is
  // chicken stock; "creme fraiche or soured cream" is creme fraiche, and "milk
  // or cream" is milk.
  const head = rest[rest.length - 1]!.toLowerCase().replace(/[^a-z-]/g, '')
  const modifier = words(first).length === 1 && rest.length > 1
  if (modifier && SHARED_HEAD.has(head) && !first.toLowerCase().endsWith(head)) {
    return `${first} ${head}`
  }

  return first
}

function words(name: string) {
  return name.split(' ').filter(Boolean)
}

/** Trailing preparation words, taken off one at a time: "carrots finely chopped". */
function dropTrailingPreparation(name: string): string {
  const parts = words(name)
  let end = parts.length
  let stripped = false

  while (end > 1) {
    const word = parts[end - 1]!.toLowerCase().replace(/[^a-z-]/g, '')
    if (PREPARATION.has(word)) {
      stripped = true
    } else if (!(stripped && CONNECTIVE.has(word))) {
      // A connective is only fluff once something was dropped after it, so
      // "salt and pepper" keeps its pepper and its and.
      break
    }
    end--
  }

  return stripped ? parts.slice(0, end).join(' ') : name
}

/** Trailing comma clauses: ", freshly grated", ", peeled and finely chopped". */
function dropTrailingClauses(name: string): string {
  let result = name
  for (;;) {
    const comma = result.lastIndexOf(',')
    if (comma <= 0) return result
    const first = result.slice(comma + 1).trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z-]/g, '') ?? ''
    if (!PREPARATION.has(first)) return result
    result = result.slice(0, comma).trim()
  }
}

export function shoppingName(
  raw: string,
  { alternatives = 'keep' }: { alternatives?: 'keep' | 'first' } = {}
): string {
  const original = raw.replace(/\s+/g, ' ').trim()
  if (!original) return raw

  let name = original.replace(QUALIFIER, '').trim()
  name = dropTrailingClauses(name)
  name = dropTrailingPreparation(name)
  if (alternatives === 'first') name = takeFirstAlternative(name)
  name = name.replace(/[\s,;:.\-–—]+$/, '').trim()

  // Nothing survived, or the cleaning found a clause and no ingredient. Keep
  // what the recipe said: a wrong name is worse than a wordy one.
  return name || original
}

/**
 * A recipe line as the library pane lists it: tidied hard, and capitalised.
 *
 * The pane is a place you scan five meals to pick one, so it reads like the
 * shopping list rather than like the recipe — instructions off, the choice
 * between two cheeses resolved to the one you would buy. The recipe itself and
 * cook mode keep every word, because at the hob "finely chopped" is the
 * instruction.
 */
export function displayIngredientName(raw: string): string {
  const name = shoppingName(raw, { alternatives: 'first' })
  return name.charAt(0).toUpperCase() + name.slice(1)
}
