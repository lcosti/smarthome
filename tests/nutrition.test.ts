import { describe, expect, it } from 'vitest'
import { nutritionView, type NutritionKey } from '../app/utils/nutrition'

type Panel = Partial<Record<NutritionKey, number | null>> & { base_servings?: number }

/** The BBC mushroom risotto panel, which is the one this was built against. */
function recipe(overrides: Panel = {}) {
  return {
    base_servings: 4,
    kcal: 445,
    fat_g: 17,
    saturates_g: 7.7,
    carbs_g: 63,
    sugars_g: 3,
    fibre_g: 4,
    protein_g: 15,
    salt_g: 1.45,
    ...overrides
  }
}

describe('nutritionView', () => {
  it('reads a per-serving panel as published', () => {
    const view = nutritionView(recipe())
    expect(view.hasData).toBe(true)
    expect(view.kcal).toBe(445)
    expect(view.fibre).toBe(4)
    expect(view.salt).toBe(1.45)
    expect(view.scopeLabel).toBe('1 of 4 servings')
    expect(view.macros.map(m => [m.label, m.grams])).toEqual([
      ['Protein', 15], ['Carbs', 63], ['Fat', 17]
    ])
  })

  it('multiplies up to the whole dish', () => {
    const view = nutritionView(recipe(), 'whole')
    expect(view.kcal).toBe(1780)
    expect(view.salt).toBe(5.8)
    expect(view.scopeLabel).toBe('all 4 servings')
    expect(view.macros.map(m => m.grams)).toEqual([60, 252, 68])
  })

  it('splits the bar by weight, totalling 100', () => {
    const view = nutritionView(recipe())
    const total = view.macros.reduce((sum, m) => sum + m.percent, 0)
    expect(total).toBeCloseTo(100, 1)
    // 63g of carbs against 95g of macros — the widest segment.
    expect(view.macros[1]!.percent).toBeGreaterThan(view.macros[0]!.percent)
  })

  it('still fills the bar when a source stated only two macros', () => {
    const view = nutritionView(recipe({ fat_g: null }))
    expect(view.hasSplit).toBe(true)
    expect(view.macros.reduce((sum, m) => sum + m.percent, 0)).toBeCloseTo(100, 1)
    expect(view.macros[2]!.grams).toBeNull()
    expect(view.macros[2]!.percent).toBe(0)
  })

  it('draws no bar from a single macro, which is not a split', () => {
    const view = nutritionView(recipe({ carbs_g: null, fat_g: null }))
    expect(view.hasSplit).toBe(false)
    // The figure is still shown; only the proportion is withheld.
    expect(view.macros[0]!.grams).toBe(15)
  })

  it('reports nothing to show for a recipe with no figures', () => {
    const bare = {
      base_servings: 2,
      kcal: null, fat_g: null, saturates_g: null, carbs_g: null,
      sugars_g: null, fibre_g: null, protein_g: null, salt_g: null
    }
    const view = nutritionView(bare)
    expect(view.hasData).toBe(false)
    expect(view.hasSplit).toBe(false)
    expect(view.kcal).toBeNull()
  })

  it('keeps a missing figure missing rather than calling it zero', () => {
    const view = nutritionView(recipe({ kcal: null, fibre_g: null }))
    expect(view.hasData).toBe(true)
    expect(view.kcal).toBeNull()
    expect(view.fibre).toBeNull()
  })

  it('says serving in the singular for a recipe that serves one', () => {
    expect(nutritionView(recipe({ base_servings: 1 })).scopeLabel).toBe('1 of 1 serving')
    expect(nutritionView(recipe({ base_servings: 1 }), 'whole').scopeLabel).toBe('all 1 serving')
  })

  it('survives a nonsense serving count rather than dividing by it', () => {
    // base_servings is NOT NULL with a default, but a row can still arrive from
    // an older client or a bad import; the panel must not render NaN.
    const view = nutritionView(recipe({ base_servings: 0 }), 'whole')
    expect(view.kcal).toBe(445)
    expect(view.scopeLabel).toBe('all 1 serving')
  })

  it('rounds to what a label prints rather than to floating point', () => {
    const view = nutritionView(recipe({ kcal: 445, protein_g: 15.05, salt_g: 1.455 }), 'whole')
    expect(view.macros[0]!.grams).toBe(60.2)
    expect(view.salt).toBe(5.82)
    expect(Number.isInteger(view.kcal!)).toBe(true)
  })
})
