import { usePeopleStore } from '../stores/people'
import { useRecipesStore } from '../stores/recipes'
import { asSuggestions, householdAudiences, type SuggestedAdaptation } from '../utils/adaptations'
import { offline, useEdgeFunction } from './useEdgeFunction'

/**
 * Adaptations proposed by a model for the audiences this household actually
 * has, on the terms of the nutrition estimator with one difference: this writes
 * nothing. Proposals sit in `suggestions` for a person to accept one at a time
 * or dismiss — generated weaning guidance is reviewed, per the project brief —
 * and accepting goes through the ordinary store methods on the page. Online
 * only, like every model call.
 */
export function useAdaptationSuggest() {
  const recipes = useRecipesStore()
  const people = usePeopleStore()
  const today = useToday()
  const { invoke } = useEdgeFunction()

  const busy = ref(false)
  const error = ref<string | null>(null)
  const suggestions = ref<SuggestedAdaptation[]>([])

  async function suggest(recipeId: string) {
    if (busy.value) return
    error.value = null

    const recipe = recipes.recipeById(recipeId)
    const lines = recipes.ingredientsFor(recipeId)
    if (!recipe || !lines.length) return

    if (offline()) {
      error.value = 'Suggesting needs signal. Everything else works offline, but this does not.'
      return
    }

    // Only audiences somebody currently is: asking for a toddler version of
    // every recipe in a household with no toddler would be inventing work.
    const audiences = householdAudiences(people.people, people.constraints, today.value)
    const asked = [
      ...[...audiences.stages.keys()].map(stage => ({ life_stage: stage })),
      ...[...audiences.diets.keys()].map(tag => ({ diet_tag: tag }))
    ]
    if (!asked.length) return

    const generic = 'Could not suggest — check your signal and try again.'
    busy.value = true
    try {
      const data = await invoke('suggest-adaptations', {
        name: recipe.name,
        base_servings: recipe.base_servings,
        ingredients: lines.map(line => ({ id: line.id, name: line.name, quantity: line.quantity })),
        steps: recipes.stepsFor(recipeId).map(step => ({ id: step.id, body: step.body })),
        audiences: asked
      }, generic)

      const usable = asSuggestions(data?.suggestions)
      if (!usable.length) throw new Error('Nothing worth suggesting — this dish may already suit everybody.')
      suggestions.value = usable
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : generic
    } finally {
      busy.value = false
    }
  }

  function dismiss(suggestion: SuggestedAdaptation) {
    suggestions.value = suggestions.value.filter(entry => entry !== suggestion)
  }

  /**
   * One proposal, written for real: the adaptation upserted, its overrides
   * appended, and the note filled only where nothing was written — the
   * estimator's rule, an accepted suggestion never overwrites a person's words.
   */
  async function accept(recipeId: string, suggestion: SuggestedAdaptation) {
    const audience = suggestion.life_stage
      ? { life_stage: suggestion.life_stage }
      : { diet_tag: suggestion.diet_tag ?? '' }
    const row = await recipes.upsertAdaptation(recipeId, audience, suggestion.note)
    if (!row) return null
    if (suggestion.note && !row.note?.trim()) {
      await recipes.updateAdaptation(row.id, { note: suggestion.note })
    }
    for (const override of suggestion.ingredient_overrides) {
      await recipes.addAdaptationItem(row.id, { kind: 'ingredient', ...override })
    }
    for (const amendment of suggestion.step_amendments) {
      await recipes.addAdaptationItem(row.id, { kind: 'step', ...amendment })
    }
    dismiss(suggestion)
    return row
  }

  return { busy, error, suggestions, suggest, accept, dismiss }
}
