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

/**
 * Why a candidate scored the way it did, as data rather than a sentence.
 *
 * Whichever component moved the score most, so a suggestion can say something
 * true about itself without the scorer having to know how a screen words things.
 * `suggestionReason` below is the one place that turns these into English.
 */
export interface RankReason {
  kind: 'never' | 'rested' | 'quick' | 'overlap' | 'liked'
  /** 'rested': whole days since it was last cooked. */
  days?: number
  /** 'quick': prep plus cook, against the night's budget. */
  minutes?: number
  budget?: number
  /** 'overlap': canonical ingredients shared with the rest of the week. */
  shared?: number
}

export interface RankedCandidate {
  recipe: GeneratorRecipe
  score: number
  /** What the weighted pick actually draws against: exp(score / temperature). */
  weight: number
  reason: RankReason
}

export interface Pick {
  date: string
  recipeId: string
  servings: number
  /**
   * Set when this night is leftovers of an earlier one, naming that night by
   * date. Not by entry id, because entries do not exist yet — the caller mints
   * them from these picks and resolves the reference as it goes.
   */
  leftoverOfDate?: string
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

/**
 * How much bigger than tonight's table a recipe has to be before the next night
 * is offered its leftovers.
 *
 * Twice, so there is a whole second dinner in the pot rather than a lunchbox.
 * Nothing is scaled up to reach this: the recipe already yields what it yields,
 * and asking somebody to cook double is a different feature.
 */
export const LEFTOVER_BATCH_FACTOR = 2

/** Weeknights are short because they are weeknights. Minutes, prep plus cook. */
export function defaultEffortBudget(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(year!, month! - 1, day!).getDay()
  if (weekday === 0 || weekday === 6) return 75
  if (weekday === 5) return 50
  return 30
}

/** The next calendar day, 'YYYY-MM-DD' in and out. */
function dayAfter(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(year!, month! - 1, day! + 1)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
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
 * Everything the scorer needs that does not change from night to night.
 *
 * `chosen` and `chosenIngredients` are the exception and are deliberately
 * mutable: nights are decided in order, and each decision narrows the next.
 * A caller only ranking — the Plan view's suggestions — builds one of these and
 * never touches them.
 */
export interface GeneratorContext {
  liveRecipes: GeneratorRecipe[]
  namesOf: Map<string, string[]>
  canonicalOf: Map<string, Set<string>>
  lastCooked: Map<string, string>
  constraintsByPerson: Map<string, GeneratorConstraint[]>
  /** Recipes already spoken for this week. Nothing is offered twice. */
  chosen: Set<string>
  chosenIngredients: Set<string>
  budgetFor: (date: string) => number
}

/** The once-per-run indexes, so ranking and generating can share them. */
export function buildContext(input: GenerateInput): GeneratorContext {
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

  return {
    liveRecipes,
    namesOf,
    canonicalOf,
    lastCooked,
    constraintsByPerson,
    chosen,
    chosenIngredients,
    budgetFor: input.effortBudget ?? defaultEffortBudget
  }
}

/**
 * Every recipe this night could have, scored.
 *
 * The whole of the selection policy lives here, so the button that fills a week
 * and the panel that suggests one meal can never disagree about what is allowed
 * or what is good. Anything ruled out by an allergy is absent, not low-scoring.
 *
 * Returned in library order, not score order, and that is load-bearing:
 * `generateWeek` draws from this list with a weighted pick, and a weighted pick
 * maps a given random number onto a different recipe if the list is permuted.
 * Sorting here would silently reshuffle every seeded outcome. Callers who want
 * a leaderboard use {@link topCandidates}.
 */
export function rankCandidates(context: GeneratorContext, night: GeneratorNight): RankedCandidate[] {
  const present = night.people.map(person => person.id)
  const hard: string[] = []
  const dislikes: string[] = []
  const preferences: string[] = []
  for (const id of present) {
    for (const constraint of context.constraintsByPerson.get(id) ?? []) {
      if (isHardConstraint(constraint.kind)) hard.push(constraint.tag)
      else if (constraint.kind === 'dislike') dislikes.push(constraint.tag)
      else preferences.push(constraint.tag)
    }
  }

  const budget = context.budgetFor(night.date)
  const ranked: RankedCandidate[] = []

  for (const recipe of context.liveRecipes) {
    // No recipe twice in one week, however good it looks.
    if (context.chosen.has(recipe.id)) continue

    const names = context.namesOf.get(recipe.id) ?? []
    // The one filter that is not negotiable.
    if (hard.some(tag => mentions(tag, names))) continue

    let score = 0
    // Whichever component actually *added* the most is the reason, tracked as
    // the score is built rather than reconstructed from the total afterwards.
    // Only bonuses compete: a penalty avoided is not an argument for a meal.
    let reason: RankReason | null = null
    let strongest = 0

    const previously = context.lastCooked.get(recipe.id)
    const rested = previously ? daysBetween(previously, night.date) : null
    if (rested === null) {
      score += WEIGHTS.neverCookedBonus
      reason = { kind: 'never' }
      strongest = WEIGHTS.neverCookedBonus
    } else {
      const staleness = Math.max(0, WEIGHTS.recencyWindowDays - rested) / WEIGHTS.recencyWindowDays
      score -= WEIGHTS.recencyPenalty * staleness
    }

    let shared = 0
    for (const id of context.canonicalOf.get(recipe.id) ?? []) {
      if (context.chosenIngredients.has(id)) shared++
    }
    const overlap = Math.min(shared * WEIGHTS.overlapBonus, WEIGHTS.overlapCap)
    score += overlap
    if (overlap > strongest) {
      reason = { kind: 'overlap', shared }
      strongest = overlap
    }

    const minutes = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)
    const over = minutes > budget
    if (minutes > 0) {
      const drift = Math.min(
        over
          ? (minutes - budget) * WEIGHTS.overBudgetPenalty
          : (budget - minutes) * WEIGHTS.underBudgetPenalty,
        WEIGHTS.effortCap
      )
      score -= drift
    }

    let liked = 0
    for (const tag of dislikes) if (mentions(tag, names)) score -= WEIGHTS.dislikePenalty
    for (const tag of preferences) {
      if (!mentions(tag, names)) continue
      score += WEIGHTS.preferenceBonus
      liked += WEIGHTS.preferenceBonus
    }
    if (liked > strongest) reason = { kind: 'liked' }

    // Nothing scored it up, so say the plainest true thing instead. Fitting the
    // night is worth a mention; being over it is a cost and stays unsaid.
    if (!reason) {
      reason = minutes > 0 && !over
        ? { kind: 'quick', minutes, budget }
        : rested === null ? { kind: 'never' } : { kind: 'rested', days: rested }
    }

    ranked.push({ recipe, score, weight: Math.exp(score / WEIGHTS.temperature), reason })
  }

  return ranked
}

/** The same candidates as a leaderboard, best first. Ties break by name, not by chance. */
export function topCandidates(
  context: GeneratorContext,
  night: GeneratorNight,
  limit: number
): RankedCandidate[] {
  return rankCandidates(context, night)
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, limit)
}

/**
 * A suggestion's one-line case for itself.
 *
 * Deliberately here rather than in a component: the sentence has to stay true to
 * what the scorer actually rewarded, and the two drifting apart is how an app
 * starts lying about why it suggested something.
 *
 * `allPantry` is passed in because whether the cupboard already covers a recipe
 * is not part of the score — the generator is pure and knows nothing about
 * stock — but it is the most persuasive thing that can be said about a meal, so
 * it wins when it is true.
 */
export function suggestionReason(
  candidate: RankedCandidate,
  options: { allPantry?: boolean, cookedTimes?: number } = {}
): string {
  if (options.allPantry) return 'All pantry — nothing to buy'

  const { reason } = candidate
  switch (reason.kind) {
    case 'never':
      return 'Never cooked — worth a try'
    case 'overlap':
      return reason.shared === 1
        ? 'Shares an ingredient with the rest of the week'
        : `Shares ${reason.shared} ingredients with the rest of the week`
    case 'quick':
      return `${reason.minutes} min — fits a ${reason.budget} min night`
    case 'liked':
      return 'Somebody eating asked for it'
    case 'rested': {
      const weeks = Math.floor((reason.days ?? 0) / 7)
      if (options.cookedTimes && options.cookedTimes > 2) {
        return `Cooked ${options.cookedTimes}× — nobody complains`
      }
      if (weeks >= 4) return 'Not cooked in over a month'
      if (weeks >= 1) return `Nothing like it for ${weeks === 1 ? 'a week' : `${weeks} weeks`}`
      return 'Not on the plan yet'
    }
    default:
      return 'Not on the plan yet'
  }
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
  const context = buildContext(input)
  const { chosen, chosenIngredients, canonicalOf } = context

  const plannedDates = new Set((input.alreadyPlanned ?? []).map(entry => entry.date))
  const picks: Pick[] = []

  const nights = [...input.nights].sort((a, b) => a.date.localeCompare(b.date))
  const nightByDate = new Map(nights.map(night => [night.date, night]))

  for (const night of nights) {
    if (plannedDates.has(night.date)) continue

    const eating = eaters(night.people)
    if (!eating.length) continue

    const winner = pickWeighted(
      rankCandidates(context, night).map(candidate => ({
        item: candidate.recipe,
        weight: candidate.weight
      })),
      random
    )
    if (!winner) continue

    chosen.add(winner.id)
    for (const id of canonicalOf.get(winner.id) ?? []) chosenIngredients.add(id)
    picks.push({ date: night.date, recipeId: winner.id, servings: eating.length })

    // A pot big enough to feed tomorrow as well. Deciding this here rather than
    // scoring it as a candidate keeps the leftovers night out of the selection
    // loop entirely: the recipe is cooked once, so the no-repeat rule is never
    // bent, and reheating costs no effort so no budget has to be checked.
    if (winner.base_servings < LEFTOVER_BATCH_FACTOR * eating.length) continue

    const tomorrow = nightByDate.get(dayAfter(night.date))
    // Never onto a night somebody planned themselves. They said what they wanted
    // to eat; the "Leftovers of…" button in the night editor is how a person
    // changes their own mind.
    if (!tomorrow || plannedDates.has(tomorrow.date)) continue

    const eatingTomorrow = eaters(tomorrow.people)
    // Only what is genuinely left over. Feeding six off a four-serving batch is
    // how a household learns not to trust the plan.
    if (!eatingTomorrow.length || eatingTomorrow.length > winner.base_servings - eating.length) continue

    plannedDates.add(tomorrow.date)
    picks.push({
      date: tomorrow.date,
      // A copy of the recipe, so the night still names a dish if the night it
      // came from is later deleted.
      recipeId: winner.id,
      servings: eatingTomorrow.length,
      leftoverOfDate: night.date
    })
  }

  return picks
}
