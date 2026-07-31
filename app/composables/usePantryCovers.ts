import { useIngredientsStore, asBaseUnit } from '../stores/ingredients'
import { usePantryStore } from '../stores/pantry'
import { lineNeedBase } from '../utils/pantry'

/** The parts of a recipe line this needs to answer the question. */
interface CoverableLine {
  name: string
  quantity: string | null
  ingredient_id?: string | null
}

/**
 * "Have I already got this?", for one recipe line.
 *
 * The predicate the recipe library is given, kept here rather than inside
 * buildRecipeLibrary so that pure file never has to know about base units,
 * purchase units or which nights have already claimed what.
 *
 * A line with no usable quantity — "salt", "a splash of oil" — counts as covered
 * as soon as there is any stock at all. That is how a person reads their own
 * cupboard, and demanding a number would make the answer no for almost every
 * recipe, which is the same as not having the feature. A line that does name an
 * amount is held to it.
 */
export function usePantryCovers() {
  const ingredients = useIngredientsStore()
  const pantry = usePantryStore()

  return computed(() => {
    const available = pantry.available
    return (line: CoverableLine): boolean => {
      const ingredient = ingredients.ingredientById(line.ingredient_id ?? null)
        ?? ingredients.resolve(line.name)
      if (!ingredient) return false

      const have = available.get(ingredient.id) ?? 0
      if (have <= 0) return false

      const need = lineNeedBase(
        line.quantity,
        asBaseUnit(ingredient.base_unit),
        ingredients.purchaseUnitsFor(ingredient.id)
      )
      return need === null || have >= need
    }
  })
}
