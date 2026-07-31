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
import type { ExtractedLine, ExtractedRecipe } from './recipe-schema.ts'

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

/**
 * The page's og:image — the picture it wants shown when somebody shares it.
 *
 * The backstop for both extraction paths. A page whose JSON-LD omits `image`
 * nearly always still has this, because it is what every social preview reads;
 * and a page with no JSON-LD at all went to the model, which is handed the page
 * as plain text with the tags stripped and so never saw an address to report.
 *
 * Attribute order varies between sites, so this finds the tag first and reads
 * its attributes second rather than trying to spell every order in one pattern.
 */
export function openGraphImage(html: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const meta = tag[0]!
    if (!/\b(?:property|name)\s*=\s*["']og:image(?::url)?["']/i.test(meta)) continue
    const content = meta.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1]
    // Entity-encoded query separators are ordinary in a shared address.
    const found = absoluteUrl(content?.replace(/&amp;/g, '&'))
    if (found) return found
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
    image_url: image(recipe.image)
  }
}
