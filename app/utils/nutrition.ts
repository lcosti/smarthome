/**
 * The eight figures a UK nutrition panel prints, in the order it prints them,
 * and the reading of them the library pane shows.
 *
 * One list so the recipe page, the import coercion and anything else that ever
 * reads these columns agree on which fields exist and what to call them. All
 * per serving — the columns store what the source published, and sources
 * publish per serving.
 */

import type { RecipeRow } from './db'

export type NutritionKey = keyof Pick<RecipeRow,
  'kcal' | 'fat_g' | 'saturates_g' | 'carbs_g' | 'sugars_g' | 'fibre_g' | 'protein_g' | 'salt_g'>

export const NUTRITION_FIELDS: { key: NutritionKey, label: string, unit: 'kcal' | 'g' }[] = [
  { key: 'kcal', label: 'kcal', unit: 'kcal' },
  { key: 'fat_g', label: 'fat', unit: 'g' },
  { key: 'saturates_g', label: 'saturates', unit: 'g' },
  { key: 'carbs_g', label: 'carbs', unit: 'g' },
  { key: 'sugars_g', label: 'sugars', unit: 'g' },
  { key: 'fibre_g', label: 'fibre', unit: 'g' },
  { key: 'protein_g', label: 'protein', unit: 'g' },
  { key: 'salt_g', label: 'salt', unit: 'g' }
]

/** One serving as stored, or the dish as cooked. */
export type NutritionScope = 'serving' | 'whole'

/**
 * The three macros, in the order the bar stacks them.
 *
 * Colours are categorical — they identify a series, and nothing about protein is
 * semantically "primary" or "error" — so they are Tailwind palette classes
 * rather than theme colours. Amber first so the bar starts on the app's own
 * accent; the other two are chosen to stay distinguishable from it and from each
 * other on the dark panel this sits on.
 */
export const NUTRITION_MACROS: { key: NutritionKey, label: string, bar: string, dot: string }[] = [
  { key: 'protein_g', label: 'Protein', bar: 'bg-amber-400', dot: 'bg-amber-400' },
  { key: 'carbs_g', label: 'Carbs', bar: 'bg-sky-400', dot: 'bg-sky-400' },
  { key: 'fat_g', label: 'Fat', bar: 'bg-violet-400', dot: 'bg-violet-400' }
]

export interface NutritionMacroView {
  key: NutritionKey
  label: string
  /** Null when the source did not state this one. */
  grams: number | null
  /** Share of the three macros by weight, 0–100. Zero when there is no split. */
  percent: number
  bar: string
  dot: string
}

export interface NutritionView {
  /** False when the recipe has no figures at all, which is when to show nothing. */
  hasData: boolean
  kcal: number | null
  macros: NutritionMacroView[]
  /** True once at least two macros are known — one segment is not a split. */
  hasSplit: boolean
  fibre: number | null
  salt: number | null
  /** '1 of 4 servings' or 'all 4 servings'. */
  scopeLabel: string
}

/**
 * The reference intake a UK label prints %RI against. A fixed number on the
 * back of a packet, not a target this app holds for anybody: nothing stores it
 * per person, and nothing adds these figures up across a day or a plan.
 */
export const REFERENCE_KCAL = 2000

const round = (value: number, places: number) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * What the pane shows about a recipe's nutrition, at one scope or the other.
 *
 * Pure and separate from the component because the arithmetic is the part worth
 * testing: scaling by servings, and a bar whose segments have to total 100 even
 * when a source stated only two of the three macros.
 *
 * The split is by weight rather than by energy. Energy shares are the more
 * nutritionally meaningful reading, but they require multiplying by 4/4/9 —
 * figures this app would be inventing — and the bar is here to show the shape
 * of a meal at a glance, not to be arithmetic anybody relies on.
 */
export function nutritionView(
  recipe: Pick<RecipeRow, NutritionKey | 'base_servings'>,
  scope: NutritionScope = 'serving'
): NutritionView {
  const servings = Math.max(1, Math.round(recipe.base_servings || 1))
  const factor = scope === 'whole' ? servings : 1

  const scaled = (key: NutritionKey, places: number): number | null => {
    const value = recipe[key]
    return typeof value === 'number' && Number.isFinite(value) ? round(value * factor, places) : null
  }

  const grams = NUTRITION_MACROS.map(macro => ({ ...macro, grams: scaled(macro.key, 1) }))
  const total = grams.reduce((sum, macro) => sum + (macro.grams ?? 0), 0)
  const known = grams.filter(macro => macro.grams !== null).length

  return {
    hasData: NUTRITION_FIELDS.some(field => recipe[field.key] != null),
    kcal: scaled('kcal', 0),
    macros: grams.map(macro => ({
      ...macro,
      percent: total > 0 ? round(((macro.grams ?? 0) / total) * 100, 2) : 0
    })),
    hasSplit: known >= 2 && total > 0,
    fibre: scaled('fibre_g', 1),
    salt: scaled('salt_g', 2),
    scopeLabel: scope === 'whole'
      ? `all ${servings} serving${servings === 1 ? '' : 's'}`
      : `1 of ${servings} serving${servings === 1 ? '' : 's'}`
  }
}
