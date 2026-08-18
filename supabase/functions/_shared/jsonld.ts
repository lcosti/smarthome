// Reading a recipe out of a page that already published one.
//
// Nearly every recipe site embeds schema.org Recipe as JSON-LD, because search
// engines reward it. Where that is true the import costs nothing: no model, no
// tokens, no waiting — the page already says what the ingredients are. The LLM
// is the fallback for the rest, not the path.
//
// Pure: no Deno APIs and no DOM, so tests/recipe-jsonld.test.ts imports it
// straight into vitest. Parsing with regex rather than a DOM is the right size
// here — the target is one script tag with JSON in it, not the document.

import { splitIngredientLine } from './ingredient-line.ts'
import type { ExtractedLine, ExtractedNutrition, ExtractedRecipe } from './recipe-schema.ts'

const SCRIPTS = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ndash: '–',
  mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  frac12: '½', frac14: '¼', frac34: '¾', deg: '°', hellip: '…'
}

/**
 * Plain text out of a field that may carry markup — instructions routinely
 * arrive as `<p>Heat the oil&hellip;</p>` even inside JSON-LD.
 */
function clean(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|li|div|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith('#')) {
        const point = code[1]?.toLowerCase() === 'x'
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10)
        return Number.isFinite(point) ? String.fromCodePoint(point) : whole
      }
      return ENTITIES[code.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = clean(value)
  return cleaned || null
}

/** schema.org allows a bare value or a list of them almost everywhere. */
function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

/**
 * ISO-8601 durations as minutes: "PT1H30M" is 90. Sites that ignore the spec and
 * write a bare "30" are read as minutes too, since that is what they meant.
 */
function minutes(value: unknown): number | null {
  const raw = first(value)
  if (typeof raw === 'number') return sane(raw)
  if (typeof raw !== 'string') return null

  const iso = raw.trim().toUpperCase().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/)
  if (iso) {
    const total = Number(iso[1] ?? 0) * 1440 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0)
    return sane(total)
  }

  const bare = raw.trim().match(/^(\d+)$/)
  return bare ? sane(Number(bare[1])) : null
}

/** A time nobody would print: zero, or longer than a day. */
function sane(value: number): number | null {
  return Number.isFinite(value) && value > 0 && value < 24 * 60 ? Math.round(value) : null
}

/**
 * An absolute http(s) address, or null.
 *
 * Anything relative is dropped rather than resolved. The address outlives the
 * HTML it came from — it is stored and handed to an `<img>` weeks later — so a
 * path that only means something next to the original document is worse than no
 * picture at all.
 */
export function absoluteUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^https?:\/\/[^\s"'<>]+$/i.test(trimmed) ? trimmed : null
}

/**
 * The recipe's photograph. schema.org allows a bare URL, an ImageObject, or a
 * list of either, and recipe sites use all three — BBC Good Food publishes a
 * one-element array of ImageObject, Serious Eats a bare string.
 *
 * The first entry wins. Where sites list several they are the same photograph at
 * different crops, in descending size, and the largest is the one worth showing
 * on a wall-mounted screen.
 */
function image(value: unknown): string | null {
  const raw = first(value)
  if (typeof raw === 'string') return absoluteUrl(raw)
  if (typeof raw !== 'object' || raw === null) return null

  const node = raw as Record<string, unknown>
  return absoluteUrl(first(node.url)) ?? absoluteUrl(first(node.contentUrl))
}

/** Entity-encoded query separators are ordinary in a shared address. */
function attribute(tag: string, name: string): string | null {
  const found = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]
  return absoluteUrl(found?.replace(/&amp;/g, '&'))
}

/**
 * Furniture rather than food. Only ever applied to the guessed picture below —
 * a page that declares an address has said what it means, but a page we are
 * reading the layout of can easily hand back its own masthead.
 */
const FURNITURE = /\b(?:logo|icon|favicon|sprite|avatar|placeholder|spacer|blank)\b/i

/**
 * The page's own picture of the dish.
 *
 * The backstop for both extraction paths. A page whose JSON-LD omits `image`
 * usually still declares one of these, because they are what social previews
 * read; and a page with no JSON-LD at all went to the model, which is handed the
 * page as plain text with the tags stripped and so never saw an address at all.
 *
 * In declaration order, most deliberate first: og:image, twitter:image,
 * `rel="image_src"`, and finally whatever the page marked as its largest
 * paint — `rel="preload" as="image"` or `fetchpriority="high"`. That last one is
 * a guess rather than a statement, but it is a good one: it is how a page names
 * the photograph at the top of itself, and some otherwise well-marked-up recipe
 * sites (tomkerridge.com) publish no social tags whatsoever.
 *
 * Attribute order varies between sites, so this finds each tag first and reads
 * its attributes second rather than trying to spell every order in one pattern.
 */
export function pageImage(html: string): string | null {
  const tags = [...html.matchAll(/<(?:meta|link|img)\b[^>]*>/gi)].map(match => match[0]!)

  const declared = (test: RegExp, attr: string) => {
    for (const tag of tags) {
      if (!test.test(tag)) continue
      const found = attribute(tag, attr)
      if (found) return found
    }
    return null
  }

  const social = /\b(?:property|name)\s*=\s*["']og:image(?::url)?["']/i
  const twitter = /\b(?:property|name)\s*=\s*["']twitter:image(?::src)?["']/i
  const linked = /\brel\s*=\s*["']image_src["']/i

  const stated = declared(social, 'content')
    ?? declared(twitter, 'content')
    ?? declared(linked, 'href')
  if (stated) return stated

  for (const tag of tags) {
    const preloaded = /\brel\s*=\s*["']preload["']/i.test(tag) && /\bas\s*=\s*["']image["']/i.test(tag)
    if (!preloaded && !/\bfetchpriority\s*=\s*["']high["']/i.test(tag)) continue
    // Lazy-loaded heroes keep the real address in data-src and a stub in src.
    const found = attribute(tag, 'href') ?? attribute(tag, 'data-src') ?? attribute(tag, 'src')
    if (found && !FURNITURE.test(found)) return found
  }
  return null
}

/** "4", 4, "Serves 4", "4 servings", ["4 servings"] — all four. */
function servings(value: unknown): number | null {
  const raw = first(value)
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const match = raw.match(/\d+/)
  if (!match) return null
  const count = Number(match[0])
  return count > 0 ? count : null
}

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * A figure off a nutrition panel: the first number in "34 g", "34.5g",
 * "480 calories", or a bare 34, and whether it was printed in milligrams —
 * which changes what the number means, not just its scale.
 *
 * Both spellings of the unit count, because sites use both. What they cannot be
 * trusted on is whether the word is *true* — see toSalt.
 */
function figure(value: unknown): { amount: number, milligrams: boolean } | null {
  const raw = first(value)
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? { amount: raw, milligrams: false } : null
  }
  const cleaned = typeof raw === 'string' ? clean(raw).toLowerCase() : ''
  // The word boundary binds to the unit, never after the optional group as a
  // whole: trailing it would make "34.5g" backtrack the number itself down to 34.
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(mg\b|milligrams?\b)?/)
  if (!match) return null
  const amount = Number(match[1])
  return Number.isFinite(amount) ? { amount, milligrams: Boolean(match[2]) } : null
}

function toGrams(value: unknown): number | null {
  const found = figure(value)
  if (!found) return null
  return round2(found.milligrams ? found.amount / 1000 : found.amount)
}

/** schema.org `calories` means kcal; the odd site prints kilojoules instead. */
function toKcal(value: unknown): number | null {
  const raw = first(value)
  const found = figure(raw)
  if (!found) return null
  const kilojoules = typeof raw === 'string' && /\bkj\b/i.test(clean(raw))
  return Math.round(kilojoules ? found.amount / 4.184 : found.amount)
}

/**
 * Above this, a `sodiumContent` figure is milligrams of sodium; below it, grams
 * of salt. Nobody serves 25g of salt in a portion — that is a fifth of a lethal
 * dose — and no meal contains 25mg of sodium, so the two ranges never overlap.
 */
const SODIUM_MG_FLOOR = 25

/**
 * Salt out of `sodiumContent`, the only field the vocabulary offers for it.
 *
 * Milligrams means sodium the element, which is how US labels print it — salt is
 * sodium × 2.5. Grams means the figure is already salt: UK sites put their label's
 * salt line here because there is nowhere else for it to go.
 *
 * The magnitude decides, not the stated unit, because the stated unit is often
 * wrong. BBC Good Food publishes `"1.45 milligram of sodium"` on a page that
 * prints **salt 1.45g** — take the word literally and a correct 1.45 becomes
 * 0.0036. The ranges are three orders of magnitude apart, so the number itself is
 * the more trustworthy signal and no real panel is ambiguous.
 */
function toSalt(value: unknown): number | null {
  const found = figure(value)
  if (!found) return null
  return round2(found.amount >= SODIUM_MG_FLOOR ? found.amount * 2.5 / 1000 : found.amount)
}

/**
 * The per-serving panel a site publishes as NutritionInformation.
 *
 * Per serving is assumed rather than checked: that is the convention for a
 * Recipe's nutrition node, since recipeYield names the divisor. Null when the
 * page published nothing usable — a panel of eight nulls is not a panel.
 */
function nutrition(value: unknown): ExtractedNutrition | null {
  const raw = first(value)
  if (typeof raw !== 'object' || raw === null) return null
  const node = raw as Record<string, unknown>

  const panel: ExtractedNutrition = {
    kcal: toKcal(node.calories),
    fat_g: toGrams(node.fatContent),
    saturates_g: toGrams(node.saturatedFatContent),
    carbs_g: toGrams(node.carbohydrateContent),
    sugars_g: toGrams(node.sugarContent),
    fibre_g: toGrams(node.fiberContent),
    protein_g: toGrams(node.proteinContent),
    salt_g: toSalt(node.sodiumContent)
  }
  return Object.values(panel).some(entry => entry !== null) ? panel : null
}

/**
 * The method as steps, flattening the shapes schema.org allows: a block of text,
 * a list of strings, HowToStep objects, or HowToSections whose itemListElement
 * holds the steps.
 */
function instructions(value: unknown, depth = 0): string[] {
  if (depth > 3) return []
  if (typeof value === 'string') {
    const cleaned = clean(value)
    return cleaned ? [cleaned] : []
  }
  if (Array.isArray(value)) return value.flatMap(item => instructions(item, depth + 1))
  if (typeof value !== 'object' || value === null) return []

  const node = value as Record<string, unknown>
  if (node.itemListElement) return instructions(node.itemListElement, depth + 1)
  // A step's `name` is often just the first sentence of its `text`, so prefer text.
  const step = text(node.text) ?? text(node.name)
  return step ? [step] : []
}

function isRecipe(node: unknown): node is Record<string, unknown> {
  if (typeof node !== 'object' || node === null) return false
  const type = (node as Record<string, unknown>)['@type']
  const types = Array.isArray(type) ? type : [type]
  return types.some(t => typeof t === 'string' && t.toLowerCase().endsWith('recipe'))
}

/** Every object in a parsed document, following @graph and nested lists. */
function walk(value: unknown, found: unknown[], depth = 0): void {
  if (depth > 6 || typeof value !== 'object' || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, found, depth + 1)
    return
  }
  found.push(value)
  const node = value as Record<string, unknown>
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
    if (node[key]) walk(node[key], found, depth + 1)
  }
}

/**
 * The recipe a page publishes about itself, or null if it does not publish one.
 *
 * Null is not a failure — it is the signal to fall back to the model, which is
 * why nothing here throws and a script block of broken JSON is simply skipped.
 */
export function extractRecipeJsonLd(html: string): ExtractedRecipe | null {
  const nodes: unknown[] = []
  for (const match of html.matchAll(SCRIPTS)) {
    const body = match[1]!.replace(/<!\[CDATA\[|\]\]>/g, '').trim()
    if (!body) continue
    try {
      walk(JSON.parse(body), nodes)
    } catch {
      // One malformed block does not spoil the page: a site may embed several.
    }
  }

  const recipe = nodes.find(isRecipe)
  if (!recipe) return null

  const name = text(recipe.name)
  if (!name) return null

  const raw = recipe.recipeIngredient ?? recipe.ingredients
  const ingredients: ExtractedLine[] = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const line = text(entry)
      if (!line) continue
      const split = splitIngredientLine(line)
      if (split.name) ingredients.push(split)
    }
  }

  return {
    name,
    base_servings: servings(recipe.recipeYield),
    prep_minutes: minutes(recipe.prepTime),
    cook_minutes: minutes(recipe.cookTime),
    // Passed through as the list schema.org published. This used to be joined
    // into one string here and split apart again in the client, which threw away
    // the one thing a HowToStep is for.
    steps: instructions(recipe.recipeInstructions),
    ingredients,
    nutrition: nutrition(recipe.nutrition),
    // A web page has no page number. The field exists for the photographs.
    page: null,
    image_url: image(recipe.image)
  }
}
