import { useIngredientsStore } from '../stores/ingredients'
import { useRecipesStore } from '../stores/recipes'
import { compressToJpeg } from '../utils/photo'
import { coerceExtractedRecipe } from '../utils/recipe-import'

/** More photos than a recipe spans; matches the Edge Function's cap. */
const MAX_PHOTOS = 4
/** Long enough for a slow model on poor signal, short enough to feel like an answer. */
const TIMEOUT_MS = 60_000

/**
 * Photograph a recipe, get a recipe. The one online-only action in the app:
 * extraction needs the network, but everything after the response goes through
 * the normal stores, so the committed recipe survives signal dropping the
 * moment extraction returns.
 */
export function useRecipePhotoImport() {
  const supabase = useSupabaseClient()
  const recipes = useRecipesStore()
  const ingredients = useIngredientsStore()

  const status = ref<'idle' | 'compressing' | 'extracting' | 'saving'>('idle')
  const error = ref<string | null>(null)

  /** Returns the new recipe's id, or null with `error` set. */
  async function importPhotos(files: File[]): Promise<string | null> {
    if (status.value !== 'idle' || !files.length) return null
    error.value = null

    if (files.length > MAX_PHOTOS) {
      error.value = `That's a lot of pages — send at most ${MAX_PHOTOS} photos.`
      return null
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      error.value = 'Photo import needs signal. Everything else works offline, but reading a photo does not.'
      return null
    }

    try {
      status.value = 'compressing'
      const images = []
      for (const file of files) {
        images.push(await compressToJpeg(file))
      }

      status.value = 'extracting'
      const invoke = supabase.functions.invoke('import-recipe-photo', { body: { images } })
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
      )
      const { data, error: invokeError } = await Promise.race([invoke, timeout])

      if (invokeError) {
        // FunctionsHttpError carries the function's JSON body with the human message.
        const body = 'context' in invokeError
          ? await (invokeError.context as Response).json().catch(() => null)
          : null
        throw new Error(body?.error ?? 'Could not read the photo — check your signal and try again.')
      }

      const recipe = coerceExtractedRecipe(data?.recipe)
      if (!recipe) throw new Error('That didn\'t come back looking like a recipe. Try a clearer photo.')

      status.value = 'saving'
      const created = await recipes.addRecipe({
        name: recipe.name,
        base_servings: recipe.base_servings
      })
      if (!created) throw new Error('Could not save the recipe.')

      await recipes.updateRecipe(created.id, {
        prep_minutes: recipe.prep_minutes,
        cook_minutes: recipe.cook_minutes,
        method: recipe.method
      })

      // Sequential, not Promise.all: linkFor resolves against ingredients created
      // by earlier lines, so "tomatoes" twice must mint one row, not two.
      for (const line of recipe.ingredients) {
        const ingredientId = await ingredients.linkFor(line.name, { quantity: line.quantity })
        await recipes.addIngredient(created.id, {
          name: line.name,
          quantity: line.quantity,
          ingredient_id: ingredientId
        })
      }

      return created.id
    } catch (caught) {
      error.value = caught instanceof Error && caught.message !== 'timeout'
        ? caught.message
        : 'Could not read the photo — check your signal and try again.'
      return null
    } finally {
      status.value = 'idle'
    }
  }

  return { status, error, importPhotos }
}
