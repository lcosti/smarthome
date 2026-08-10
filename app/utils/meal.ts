/**
 * The three slots a day has.
 *
 * `meal_plan_entries.meal` and `attendance.meal` have carried this column since
 * the first plan migration, deliberately without a check constraint, so that
 * adding lunches would be a code change rather than a migration. This is that
 * code change: the union the database was left open for.
 *
 * Dinner is the primary slot and the rest of the app knows it. The week's
 * fraction, the generator, the phone's guided walk and the wall board all mean
 * dinner when they say "night", and `entriesOn` defaults to it so that they go
 * on meaning it without being edited. Breakfast and lunch are hand-planned
 * extras that derive to the shopping list like anything else.
 *
 * A leaf module on purpose: this is imported by both stores, the drag
 * composable and most of the plan's components, and it imports nothing itself,
 * so it cannot be one end of a cycle.
 *
 * Two things called `meal` in this codebase are not this type and must not be
 * given it. `BoardNight.meal` in `utils/board.ts` is *the dish planned for a
 * night*, and `ScheduleRow.meal` is a boolean meaning *this timeline row is the
 * dinner*. Both would typecheck against `Meal` and both would be wrong.
 */
export type Meal = 'breakfast' | 'lunch' | 'dinner'

/** In the order a day happens, which is the order everything renders them in. */
export const MEALS = ['breakfast', 'lunch', 'dinner'] as const

/** The slot everything defaults to, and the only one the roster is kept for. */
export const DINNER: Meal = 'dinner'

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner'
}

export const MEAL_ICONS: Record<Meal, string> = {
  breakfast: 'i-lucide-egg-fried',
  lunch: 'i-lucide-sandwich',
  dinner: 'i-lucide-utensils'
}

/**
 * Where a slot sits in the day, for sorting rows that share a date.
 *
 * A meal this build has never heard of sorts *last* rather than first. The
 * column has no check constraint, so a row written by a later version of the
 * app can arrive here — and `indexOf` returning -1 would file "supper" above
 * breakfast, which is the one answer that is definitely wrong.
 */
export function mealRank(meal: string): number {
  const index = (MEALS as readonly string[]).indexOf(meal)
  return index === -1 ? MEALS.length : index
}

export function isMeal(value: string): value is Meal {
  return (MEALS as readonly string[]).includes(value)
}

/** The column each slot is stored in, so the checkboxes and the sort read the same field. */
export const MEAL_COLUMNS = {
  breakfast: 'suits_breakfast',
  lunch: 'suits_lunch',
  dinner: 'suits_dinner'
} as const satisfies Record<Meal, string>

/**
 * The part of a recipe these read.
 *
 * Structural rather than `RecipeRow`, so this file goes on importing nothing and
 * cannot be one end of a cycle.
 */
export type MealSuits = { [K in typeof MEAL_COLUMNS[Meal]]: boolean }

/**
 * Whether anybody has said what this recipe is for.
 *
 * All three false is **no opinion**, not "suits nothing" — which is the state
 * every recipe in the library is in until somebody labels one, and the reason
 * this could land without a backfill. An unlabelled recipe is offered at every
 * meal exactly as it was before there were three.
 */
export function isMealTagged(recipe: MealSuits): boolean {
  return MEALS.some(meal => recipe[MEAL_COLUMNS[meal]])
}

/** Whether a recipe is one somebody would eat at this meal. Untagged suits all three. */
export function suitsMeal(recipe: MealSuits, meal: Meal): boolean {
  return !isMealTagged(recipe) || recipe[MEAL_COLUMNS[meal]]
}

/**
 * How near the top of a list of recipes this one belongs, for a given slot.
 *
 * Three tiers rather than a yes/no, because the two kinds of "not labelled for
 * breakfast" are not the same thing. A recipe somebody labelled a breakfast
 * leads; a recipe nobody has labelled at all follows, because it is not a claim
 * that it is a poor breakfast; a recipe labelled for other meals only sinks,
 * because that is somebody having said so.
 *
 * An unlabelled library therefore sorts exactly as it always did — everything is
 * tier 1 and alphabetical order survives — which is what makes labelling a thing
 * worth doing to five recipes rather than a chore to do to four hundred.
 */
export function mealFitRank(recipe: MealSuits, meal: Meal): number {
  if (recipe[MEAL_COLUMNS[meal]]) return 0
  return isMealTagged(recipe) ? 2 : 1
}
