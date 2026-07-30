/**
 * Deciding which canonical ingredient a piece of typed text means.
 *
 * The friction rule governs everything here. Writing down a recipe has to stay
 * "type the name, press enter" — so resolution happens silently, behind the
 * typing, and being unsure is always allowed. An unresolved line is not broken; it
 * just does not aggregate, exactly as before Phase 3.
 *
 * Pure, and typed against only the fields it reads, so the real database rows
 * satisfy these shapes without this file needing to know about Dexie or Postgres.
 */

import { ALIAS_NAMESPACE, uuidv5 } from './uuid5'

/** The parts of an ingredient row that resolution looks at. */
export interface IngredientLike {
  id: string
  name: string
  /** Set by a merge: "this row turned out to be that row." */
  merged_into: string | null
  deleted_at: string | null
  created_at: string
}

/** The parts of an alias row that resolution looks at. */
export interface AliasLike {
  ingredient_id: string
  alias: string
  deleted_at: string | null
}

/** How far to follow a chain of merges before assuming something is wrong. */
const MAX_MERGE_DEPTH = 5

/**
 * The comparison form of a name: case, surrounding space and repeated spaces all
 * stop mattering. Names are stored as typed, so the alias list keeps reading like
 * something a person wrote.
 */
export function normaliseIngredientName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * The id a given alias always produces.
 *
 * Deterministic so that two people who both teach the app the same synonym mint
 * the same row and converge, rather than filling the table with duplicates that
 * nobody can see. Normalised, so "Tinned Tomatoes" and "tinned tomatoes" are one
 * alias rather than two spellings of one.
 */
export function aliasId(householdId: string, ingredientId: string, alias: string): string {
  return uuidv5(ALIAS_NAMESPACE, `${householdId}:${ingredientId}:${normaliseIngredientName(alias)}`)
}

/**
 * Of two candidates for the same name, the one every device will agree on.
 *
 * Two phones both creating "tomatoes" offline is expected — there is no unique
 * constraint to prevent it, deliberately — so the tie has to break the same way
 * everywhere or the two devices would resolve typing differently and quietly stop
 * aggregating with each other. Oldest wins, and the id settles a dead heat.
 */
function preferred<T extends { id: string, created_at: string }>(a: T, b: T): T {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? a : b
  return a.id < b.id ? a : b
}

/**
 * Follow `merged_into` to the row that survived.
 *
 * A merge writes one pointer rather than rewriting every row that referenced the
 * loser — some of which are on a phone in a car park — so readers do this instead.
 * Returns null when the chain leads somewhere this device has not got, or runs
 * longer than a person could plausibly have merged, which also breaks any cycle.
 */
export function chaseMerge<T extends IngredientLike>(
  id: string | null,
  ingredients: Map<string, T>
): T | null {
  let current = id ? ingredients.get(id) : undefined
  for (let depth = 0; current && depth <= MAX_MERGE_DEPTH; depth++) {
    if (!current.merged_into) return current.deleted_at ? null : current
    const next = ingredients.get(current.merged_into)
    // A dangling pointer is more useful than nothing if the row is still live.
    if (!next) return current.deleted_at ? null : current
    current = next
  }
  return null
}

/** Every live ingredient, merges already followed. */
function liveIngredients<T extends IngredientLike>(ingredients: Map<string, T>): T[] {
  const seen = new Map<string, T>()
  for (const row of ingredients.values()) {
    const resolved = chaseMerge(row.id, ingredients)
    if (resolved) seen.set(resolved.id, resolved)
  }
  return [...seen.values()]
}

/**
 * The ingredient a piece of text means, or null if nothing already known does.
 *
 * Exact matches only — on the canonical name first, then on a recorded alias.
 * Prefixes are deliberately not accepted here: this runs when somebody presses
 * enter, and "pe" quietly becoming "pears" while they were typing "pesto" is the
 * kind of wrong that makes people stop trusting the app. Prefix matching belongs
 * in the suggestion list, where a person is choosing.
 */
export function resolveIngredient<T extends IngredientLike>(
  name: string,
  ingredients: Map<string, T>,
  aliases: AliasLike[] = []
): T | null {
  const key = normaliseIngredientName(name)
  if (!key) return null

  const live = liveIngredients(ingredients)

  let best: T | null = null
  for (const row of live) {
    if (normaliseIngredientName(row.name) !== key) continue
    best = best ? preferred(best, row) : row
  }
  if (best) return best

  for (const alias of aliases) {
    if (alias.deleted_at || normaliseIngredientName(alias.alias) !== key) continue
    const target = chaseMerge(alias.ingredient_id, ingredients)
    if (!target) continue
    best = best ? preferred(best, target) : target
  }
  return best
}

export interface Suggestion<T extends IngredientLike = IngredientLike> {
  ingredient: T
  /** The alias that matched, when it was not the canonical name. */
  matchedAlias: string | null
}

/**
 * What to offer while somebody is typing, best first.
 *
 * Exact before prefix before substring, and the canonical name before an alias, so
 * the thing they almost certainly mean is the one under their thumb. One entry per
 * ingredient however many of its aliases match.
 */
export function suggestIngredients<T extends IngredientLike>(
  query: string,
  ingredients: Map<string, T>,
  aliases: AliasLike[] = [],
  limit = 6
): Suggestion<T>[] {
  const key = normaliseIngredientName(query)
  if (!key) return []

  const rank = (text: string, aliasOffset: number): number | null => {
    const value = normaliseIngredientName(text)
    if (value === key) return 0 + aliasOffset
    if (value.startsWith(key)) return 2 + aliasOffset
    if (value.includes(key)) return 4 + aliasOffset
    return null
  }

  const best = new Map<string, { rank: number, suggestion: Suggestion<T> }>()
  const offer = (ingredient: T, score: number, matchedAlias: string | null) => {
    const held = best.get(ingredient.id)
    if (held && held.rank <= score) return
    best.set(ingredient.id, { rank: score, suggestion: { ingredient, matchedAlias } })
  }

  for (const ingredient of liveIngredients(ingredients)) {
    const score = rank(ingredient.name, 0)
    if (score !== null) offer(ingredient, score, null)
  }

  for (const alias of aliases) {
    if (alias.deleted_at) continue
    const score = rank(alias.alias, 1)
    if (score === null) continue
    const target = chaseMerge(alias.ingredient_id, ingredients)
    if (target) offer(target, score, alias.alias)
  }

  return [...best.values()]
    .sort((a, b) =>
      a.rank - b.rank
      || a.suggestion.ingredient.name.localeCompare(b.suggestion.ingredient.name)
      || a.suggestion.ingredient.id.localeCompare(b.suggestion.ingredient.id))
    .slice(0, limit)
    .map(entry => entry.suggestion)
}
