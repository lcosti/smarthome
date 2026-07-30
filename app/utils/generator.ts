/**
 * Assembling a week from the household's own recipes.
 *
 * Selection, never invention: this picks from the library and nothing else. An
 * LLM may one day suggest additions *to* the library, which a person accepts, but
 * the week itself is built from meals already known to work in this kitchen.
 *
 * The shape is: hard-filter, then score, then pick at weighted random. The last
 * step is the one that matters most. Taking the highest score every time
 * converges on the same five dinners within a fortnight, which is exactly the rut
 * this is supposed to get the household out of — so a good candidate is likely,
 * not certain.
 *
 * Nights are decided in order, because the ingredient-overlap score depends on
 * what has already been chosen: half a bunch of coriander is a reason to cook the
 * other thing that wants coriander.
 *
 * Pure, and takes its randomness as an argument, so a test can pin the outcome.
 */

import { isHardConstraint, normaliseTag } from './attendance'
import type { LifeStage } from './people'

export interface GeneratorRecipe {
  id: string
  name: string
  base_servings: number
  prep_minutes: number | null
  cook_minutes: number | null
  deleted_at: string | null
}

export interface GeneratorLine {
  recipe_id: string
  name: string
  /** The canonical ingredient, when Phase 3 has resolved one. Overlap needs it. */
  ingredient_id: string | null
  deleted_at: string | null
}

export interface GeneratorConstraint {
  person_id: string
  kind: string
  tag: string
  deleted_at: string | null
}

export interface GeneratorPerson {
  id: string
  stage: LifeStage
}

export interface GeneratorNight {
  date: string
  /** Who is eating, already resolved from the roster. */
  people: GeneratorPerson[]
}

/** A night that was cooked before this week, for the recency penalty. */
export interface CookedBefore {
  date: string
  recipe_id: string
}

export interface Pick {
  date: string
  recipeId: string
  servings: number
}

export interface GenerateInput {
  nights: GeneratorNight[]
  recipes: GeneratorRecipe[]
  lines: GeneratorLine[]
  constraints: GeneratorConstraint[]
  history: CookedBefore[]
  /** Nights already planned by a person, which are left alone and still counted. */
  alreadyPlanned?: { date: string, recipe_id: string }[]
  /** Minutes a given date can reasonably take. Defaults to weeknights being short. */
  effortBudget?: (date: string) => number
  random?: () => number
}

/**
 * The knobs, in one place because they are the whole personality of this thing.
 * Points are arbitrary units that only mean anything relative to TEMPERATURE.
 */
export const WEIGHTS = {
  /** Nothing cooked in this many days is fully "rested". */
  recencyWindowDays: 21,
  /** Cost of cooking something the household had yesterday. */
  recencyPenalty: 6,
  /** A meal nobody has cooked yet is worth trying. */
  neverCookedBonus: 2,
  /** Per canonical ingredient shared with something else picked this week. */
  overlapBonus: 1.5,
  overlapCap: 3,
  /** Per minute over the night's budget, and the milder cost of undershooting. */
  overBudgetPenalty: 0.08,
  underBudgetPenalty: 0.01,
  effortCap: 4,
  /** Per person present who dislikes something in it, or asked for it. */
  dislikePenalty: 2,
  preferenceBonus: 1,
  /**
   * How sharply score becomes probability. Lower is fussier, higher is wilder.
   * At 1.5 a candidate two points ahead is roughly four times as likely — a
   * strong lean, not a foregone conclusion.
   */
  temperature: 1.5
} as const

/** Weeknights are short because they are weeknights. Minutes, prep plus cook. */
export function defaultEffortBudget(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(year!, month! - 1, day!).getDay()
  if (weekday === 0 || weekday === 6) return 75
  if (weekday === 5) return 50
  return 30
}

/** Whole days from `from` to `to`, both 'YYYY-MM-DD'. */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const a = Date.UTC(fy!, fm! - 1, fd!)
  const b = Date.UTC(ty!, tm! - 1, td!)
  return Math.round((b - a) / 86_400_000)
}

/**
 * Whether a recipe contains something matching a constraint tag.
 *
 * Substring, not equality, and deliberately generous: "peanut" has to catch
 * "peanut butter", and the cost of over-excluding one dinner is a duller week
 * while the cost of under-excluding one is a hospital.
 */
function mentions(tag: string, ingredientNames: string[]): boolean {
  const needle = normaliseTag(tag)
  if (!needle) return false
  return ingredientNames.some(name => name.includes(needle))
}

/**
 * Who is actually eating.
 *
 * A pre-weaning baby is present at the table and eating nothing off it, so they
 * are not a portion. Everybody else is one, including the toddler who will eat a
 * third of theirs — the alternative is a plan that quietly under-caters.
 */
export function eaters(people: GeneratorPerson[]): GeneratorPerson[] {
  return people.filter(person => person.stage !== 'baby')
}

/** Weighted pick. Weights must be positive; returns null for an empty list. */
function pickWeighted<T>(entries: { item: T, weight: number }[], random: () => number): T | null {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (!entries.length || !(total > 0)) return null
  let cursor = random() * total
  for (const entry of entries) {
    cursor -= entry.weight
    if (cursor <= 0) return entry.item
  }
  return entries[entries.length - 1]!.item
}

/**
 * Fill the nights that have somebody eating and nothing planned.
 *
 * Nights nobody is home get nothing, which is the correct plan for them. Nights
 * where every candidate is filtered out also get nothing rather than something
 * somebody is allergic to.
 */
export function generateWeek(input: GenerateInput): Pick[] {
  const random = input.random ?? Math.random
  const budgetFor = input.effortBudget ?? defaultEffortBudget

  const liveRecipes = input.recipes.filter(recipe => !recipe.deleted_at)
  const liveConstraints = input.constraints.filter(constraint => !constraint.deleted_at)

  // Ingredient names and canonical ids per recipe, built once.
  const namesOf = new Map<string, string[]>()
  const canonicalOf = new Map<string, Set<string>>()
  for (const line of input.lines) {
    if (line.deleted_at) continue
    if (!namesOf.has(line.recipe_id)) namesOf.set(line.recipe_id, [])
    namesOf.get(line.recipe_id)!.push(normaliseTag(line.name))
    if (!line.ingredient_id) continue
    if (!canonicalOf.has(line.recipe_id)) canonicalOf.set(line.recipe_id, new Set())
    canonicalOf.get(line.recipe_id)!.add(line.ingredient_id)
  }

  /** The most recent date each recipe was cooked, before this week. */
  const lastCooked = new Map<string, string>()
  for (const past of input.history) {
    const seen = lastCooked.get(past.recipe_id)
    if (!seen || past.date > seen) lastCooked.set(past.recipe_id, past.date)
  }

  const constraintsByPerson = new Map<string, GeneratorConstraint[]>()
  for (const constraint of liveConstraints) {
    if (!constraintsByPerson.has(constraint.person_id)) constraintsByPerson.set(constraint.person_id, [])
    constraintsByPerson.get(constraint.person_id)!.push(constraint)
  }

  // Nights a person already chose count towards overlap and towards not
  // repeating, but are never overwritten: the generator fills gaps, it does not
  // overrule anybody.
  const chosen = new Set((input.alreadyPlanned ?? []).map(entry => entry.recipe_id))
  const chosenIngredients = new Set<string>()
  for (const entry of input.alreadyPlanned ?? []) {
    for (const id of canonicalOf.get(entry.recipe_id) ?? []) chosenIngredients.add(id)
  }

  const plannedDates = new Set((input.alreadyPlanned ?? []).map(entry => entry.date))
  const picks: Pick[] = []

  for (const night of [...input.nights].sort((a, b) => a.date.localeCompare(b.date))) {
    if (plannedDates.has(night.date)) continue

    const eating = eaters(night.people)
    if (!eating.length) continue

    const present = night.people.map(person => person.id)
    const hard: string[] = []
    const dislikes: string[] = []
    const preferences: string[] = []
    for (const id of present) {
      for (const constraint of constraintsByPerson.get(id) ?? []) {
        if (isHardConstraint(constraint.kind)) hard.push(constraint.tag)
        else if (constraint.kind === 'dislike') dislikes.push(constraint.tag)
        else preferences.push(constraint.tag)
      }
    }

    const budget = budgetFor(night.date)
    const candidates: { item: GeneratorRecipe, weight: number }[] = []

    for (const recipe of liveRecipes) {
      // No recipe twice in one week, however good it looks.
      if (chosen.has(recipe.id)) continue

      const names = namesOf.get(recipe.id) ?? []
      // The one filter that is not negotiable.
      if (hard.some(tag => mentions(tag, names))) continue

      let score = 0

      const previously = lastCooked.get(recipe.id)
      if (!previously) {
        score += WEIGHTS.neverCookedBonus
      } else {
        const rested = daysBetween(previously, night.date)
        const staleness = Math.max(0, WEIGHTS.recencyWindowDays - rested) / WEIGHTS.recencyWindowDays
        score -= WEIGHTS.recencyPenalty * staleness
      }

      let shared = 0
      for (const id of canonicalOf.get(recipe.id) ?? []) {
        if (chosenIngredients.has(id)) shared++
      }
      score += Math.min(shared * WEIGHTS.overlapBonus, WEIGHTS.overlapCap)

      const minutes = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)
      if (minutes > 0) {
        const drift = minutes > budget
          ? (minutes - budget) * WEIGHTS.overBudgetPenalty
          : (budget - minutes) * WEIGHTS.underBudgetPenalty
        score -= Math.min(drift, WEIGHTS.effortCap)
      }

      for (const tag of dislikes) if (mentions(tag, names)) score -= WEIGHTS.dislikePenalty
      for (const tag of preferences) if (mentions(tag, names)) score += WEIGHTS.preferenceBonus

      candidates.push({ item: recipe, weight: Math.exp(score / WEIGHTS.temperature) })
    }

    const winner = pickWeighted(candidates, random)
    if (!winner) continue

    chosen.add(winner.id)
    for (const id of canonicalOf.get(winner.id) ?? []) chosenIngredients.add(id)
    picks.push({ date: night.date, recipeId: winner.id, servings: eating.length })
  }

  return picks
}
