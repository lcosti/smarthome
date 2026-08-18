import { useIngredientsStore } from '../stores/ingredients'
import { useRecipesStore } from '../stores/recipes'
import { deShout } from '../utils/name-case'
import { compressToJpeg } from '../utils/photo'
import { coerceExtractedRecipe, type ExtractedRecipe } from '../utils/recipe-import'
import { offline, useEdgeFunction } from './useEdgeFunction'

/**
 * More photos than a recipe spans; matches the Edge Function's cap.
 *
 * Exported because the camera path counts up to it as the shots are taken —
 * see `RecipePhotoTray` — rather than finding out here that it went too far.
 */
export const MAX_PHOTOS = 4

type Status = 'idle' | 'compressing' | 'extracting' | 'saving'

/**
 * Getting a recipe into the library without typing it: photograph it, or paste
 * its address. The two online-only actions in the app — extraction needs the
 * network — but everything after the response goes through the normal stores,
 * so the committed recipe survives signal dropping the moment extraction
 * returns.
 *
 * One composable for both because everything after "the function answered" is
 * identical, and that saving path is the part with the sharp edge in it.
 */
export function useRecipeImport() {
  const recipes = useRecipesStore()
  const ingredients = useIngredientsStore()
  const { invoke } = useEdgeFunction()

  const status = ref<Status>('idle')
  const error = ref<string | null>(null)

  /**
   * The page number the photographs turned out to show, once they have been
   * read. Null until then, and null when no folio was legible.
   *
   * Published rather than saved. A page number is the one imported fact nobody
   * can check later — the book is back on the shelf — so this goes into the box
   * somebody is already filling in and is written only because they submitted
   * it. See `RecipeBookSheet` for the offer and `recipes/index.vue` for the one
   * narrow case where it fills a blank on its own.
   */
  const pageSeen = ref<string | null>(null)

  const busy = computed(() => status.value !== 'idle')

  /** Commit an extraction as a recipe, exactly as if it had been typed in. */
  async function save(recipe: ExtractedRecipe, sourceUrl: string | null) {
    status.value = 'saving'
    const created = await recipes.addRecipe({
      name: recipe.name,
      base_servings: recipe.base_servings,
      source_url: sourceUrl,
      image_url: recipe.image_url
    })
    if (!created) throw new Error('Could not save the recipe.')

    await recipes.updateRecipe(created.id, {
      prep_minutes: recipe.prep_minutes,
      cook_minutes: recipe.cook_minutes,
      ...(recipe.nutrition ?? {})
    })

    // Sequential for the same reason as the lines below: addStep reads back the
    // highest sort_order it has already written, so a parallel loop would give
    // every step the same number and lose the order the method was read in.
    for (const step of recipe.steps) {
      await recipes.addStep(created.id, step)
    }

    // Sequential, not Promise.all: linkFor resolves against ingredients created
    // by earlier lines, so "tomatoes" twice must mint one row, not two.
    for (const line of recipe.ingredients) {
      // De-shouted before it reaches the canonical list too, or a page printed in
      // capitals mints "PLAIN FLOUR" as an ingredient row and it shouts on the
      // shopping list forever. Matching is case-insensitive either way.
      const name = deShout(line.name.trim())
      const ingredientId = await ingredients.linkFor(name, { quantity: line.quantity })
      await recipes.addIngredient(created.id, {
        name,
        quantity: line.quantity,
        ingredient_id: ingredientId
      })
    }

    return created.id
  }

  /** Returns the new recipe's id, or null with `error` set. */
  async function importPhotos(files: File[]): Promise<string | null> {
    if (busy.value || !files.length) return null
    error.value = null
    pageSeen.value = null

    if (files.length > MAX_PHOTOS) {
      error.value = `That's a lot of pages — send at most ${MAX_PHOTOS} photos.`
      return null
    }
    if (offline()) {
      error.value = 'Photo import needs signal. Everything else works offline, but reading a photo does not.'
      return null
    }

    const generic = 'Could not read the photo — check your signal and try again.'
    try {
      status.value = 'compressing'
      const images = []
      for (const file of files) {
        images.push(await compressToJpeg(file))
      }

      status.value = 'extracting'
      const data = await invoke('import-recipe-photo', { images }, generic)

      const recipe = coerceExtractedRecipe(data?.recipe)
      if (!recipe) throw new Error('That didn\'t come back looking like a recipe. Try a clearer photo.')

      // Offered, not stored: the question on screen has a box for this.
      pageSeen.value = recipe.page

      return await save(recipe, null)
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : generic
      return null
    } finally {
      status.value = 'idle'
    }
  }

  /**
   * Returns the recipe's id, or null with `error` set.
   *
   * A URL already in the library returns the recipe it already made. Pasting the
   * same link twice is what happens when somebody forgets they saved it, and two
   * copies of a recipe is a worse answer than the one that exists.
   */
  async function importUrl(url: string): Promise<string | null> {
    if (busy.value) return null
    error.value = null

    const address = url.trim()
    if (!address) return null

    const existing = recipes.recipes.find(r => r.source_url === address)
    if (existing) return existing.id

    if (offline()) {
      error.value = 'Importing a link needs signal. Everything else works offline, but reading a page does not.'
      return null
    }

    const generic = 'Could not read that page — check your signal and try again.'
    try {
      status.value = 'extracting'
      const data = await invoke('import-recipe-url', { url: address }, generic)

      const recipe = coerceExtractedRecipe(data?.recipe)
      if (!recipe) throw new Error('That page didn\'t come back looking like a recipe.')

      return await save(recipe, address)
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : generic
      return null
    } finally {
      status.value = 'idle'
    }
  }

  return { status, busy, error, pageSeen, importPhotos, importUrl }
}
