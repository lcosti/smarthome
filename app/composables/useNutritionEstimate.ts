import { useRecipesStore } from '../stores/recipes'
import { NUTRITION_FIELDS, type NutritionKey } from '../utils/nutrition'
import { asNutrition } from '../utils/recipe-import'
import { offline, useEdgeFunction } from './useEdgeFunction'

/**
 * Per-serving nutrition estimated from the ingredient list, for the recipes
 * that never had a panel to import.
 *
 * Fills only the blanks: a figure a source printed or a person typed is theirs,
 * and an estimate never overwrites it. Re-estimating a field means clearing it
 * first — which is also what makes pressing the button twice harmless. Online
 * only, like the importers; the write itself rides the offline queue as an
 * ordinary recipe update.
 */
export function useNutritionEstimate() {
  const recipes = useRecipesStore()
  const { invoke } = useEdgeFunction()

  const busy = ref(false)
  const error = ref<string | null>(null)

  async function estimate(recipeId: string) {
    if (busy.value) return
    error.value = null

    const recipe = recipes.recipeById(recipeId)
    const lines = recipes.ingredientsFor(recipeId)
    if (!recipe || !lines.length) return

    if (offline()) {
      error.value = 'Estimating needs signal. Everything else works offline, but this does not.'
      return
    }

    const generic = 'Could not estimate — check your signal and try again.'
    busy.value = true
    try {
      const data = await invoke('estimate-nutrition', {
        name: recipe.name,
        base_servings: recipe.base_servings,
        ingredients: lines.map(line => ({ name: line.name, quantity: line.quantity }))
      }, generic)

      const panel = asNutrition(data?.nutrition)
      if (!panel) throw new Error('Those ingredients weren\'t enough to put numbers to.')

      const patch: Partial<Record<NutritionKey, number>> = {}
      for (const { key } of NUTRITION_FIELDS) {
        const estimated = panel[key]
        if (recipe[key] == null && estimated != null) patch[key] = estimated
      }
      if (Object.keys(patch).length) await recipes.updateRecipe(recipeId, patch)
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : generic
    } finally {
      busy.value = false
    }
  }

  return { busy, error, estimate }
}
