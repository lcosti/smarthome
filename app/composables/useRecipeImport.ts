import { useIngredientsStore } from '../stores/ingredients'
import { useRecipesStore } from '../stores/recipes'
import { compressToJpeg } from '../utils/photo'
import { coerceExtractedRecipe, importFailureMessage, type ExtractedRecipe } from '../utils/recipe-import'

/** More photos than a recipe spans; matches the Edge Function's cap. */
const MAX_PHOTOS = 4
/** Long enough for a slow model on poor signal, short enough to feel like an answer. */
const TIMEOUT_MS = 60_000

type Status = 'idle' | 'compressing' | 'extracting' | 'saving'

const PROGRESS: Record<string, string> = {
  'compressing': 'Reading recipe… this can take up to 30 seconds.',
  'extracting:photo': 'Reading recipe… this can take up to 30 seconds.',
  'extracting:url': 'Reading the page… this can take up to 30 seconds.',
  'saving': 'Saving…'
}

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
  const supabase = useSupabaseClient()
  const recipes = useRecipesStore()
  const ingredients = useIngredientsStore()

  const status = ref<Status>('idle')
  const kind = ref<'photo' | 'url'>('photo')
  const error = ref<string | null>(null)

  const busy = computed(() => status.value !== 'idle')
  const progress = computed(() =>
    busy.value ? PROGRESS[`${status.value}:${kind.value}`] ?? PROGRESS[status.value] ?? null : null
  )

  /** Call the function, unwrapping its JSON error body into a human message. */
  async function invoke(name: string, body: Record<string, unknown>, fallbackMessage: string) {
    // An aborted request, not a raced promise: giving up must also cancel the
    // call, or the extraction keeps running for an answer nobody is waiting on.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let data, invokeError
    try {
      ({ data, error: invokeError } = await supabase.functions.invoke(name, {
        body,
        signal: controller.signal
      }))
    } finally {
      clearTimeout(timer)
    }
    if (controller.signal.aborted) throw new Error(fallbackMessage)

    if (invokeError) {
      // The message a person reads is deliberately short; the whole error is
      // what tells you which of the many ways this can fail actually happened.
      console.error('edge function invoke failed', name, invokeError)
      throw new Error(await importFailureMessage(invokeError, fallbackMessage))
    }

    return data
  }

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
      cook_minutes: recipe.cook_minutes
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
      const ingredientId = await ingredients.linkFor(line.name, { quantity: line.quantity })
      await recipes.addIngredient(created.id, {
        name: line.name,
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
    kind.value = 'photo'

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
    kind.value = 'url'

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

  return { status, busy, progress, error, importPhotos, importUrl }
}

function offline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}
