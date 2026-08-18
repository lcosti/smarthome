import { defineStore } from 'pinia'
import { guessAisleId } from '../utils/aisles'
import type { RecipeIngredientRow, RecipeRow, RecipeStepRow } from '../utils/db'
import { deShout } from '../utils/name-case'
import { tidyBook, tidyPage, tidySource } from '../utils/recipe-source'
import { shoppingName } from '../utils/shopping-name'
import { plainCopy } from '../utils/sync'
import { useListStore } from './list'
import { nowIso, useSyncStore } from './sync'

function normaliseName(name: string) {
  return name.trim().toLowerCase()
}

export const useRecipesStore = defineStore('recipes', () => {
  const sync = useSyncStore()
  const list = useListStore()

  const all = computed(() => sync.rowsOf('recipes'))
  const allLines = computed(() => sync.rowsOf('recipe_ingredients'))
  const allSteps = computed(() => sync.rowsOf('recipe_steps'))

  /** Alphabetical: a household library is small, and it stays where you left it. */
  const recipes = computed(() =>
    [...all.value.values()]
      .filter(r => !r.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  function recipeById(id: string): RecipeRow | undefined {
    const row = all.value.get(id)
    return row && !row.deleted_at ? row : undefined
  }

  function ingredientsFor(recipeId: string): RecipeIngredientRow[] {
    return [...allLines.value.values()]
      .filter(l => l.recipe_id === recipeId && !l.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  }

  function ingredientById(id: string): RecipeIngredientRow | undefined {
    const row = allLines.value.get(id)
    return row && !row.deleted_at ? row : undefined
  }

  function stepById(id: string): RecipeStepRow | undefined {
    const row = allSteps.value.get(id)
    return row && !row.deleted_at ? row : undefined
  }

  /** The method, in the order it is cooked. Same rules as the ingredient lines. */
  function stepsFor(recipeId: string): RecipeStepRow[] {
    return [...allSteps.value.values()]
      .filter(s => s.recipe_id === recipeId && !s.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  }

  /**
   * Where this ingredient has been filed before — on the shopping list, or on
   * another recipe. Typing "passata" into a recipe should land it in the same
   * aisle as the last time somebody shopped for it.
   */
  function rememberedAisle(name: string): string | null {
    const fromList = list.rememberedAisle(name)
    if (fromList) return fromList

    const key = normaliseName(name)
    let best: RecipeIngredientRow | undefined
    for (const row of allLines.value.values()) {
      if (!row.aisle_id || row.deleted_at || normaliseName(row.name) !== key) continue
      if (!best || row.updated_at > best.updated_at) best = row
    }
    if (best) return best.aisle_id

    // Nothing to remember, which is every line of the first recipe imported into
    // an empty library. Guessed from the built-in list against the household's
    // own aisles, on the tidied name so "garlic cloves finely chopped" is looked
    // up as garlic. Anything learned above outranks this.
    return guessAisleId(shoppingName(name), list.aisles.values())
  }

  async function addRecipe(input: {
    name: string
    source_url?: string | null
    /** The book it was photographed out of, and the page in it. See utils/recipe-source.ts. */
    source_book?: string | null
    source_page?: string | null
    base_servings?: number
    image_url?: string | null
  }) {
    // Every recipe arrives here — typed in, photographed, or pasted as a link —
    // so this is the one place a shouting source gets quietened.
    const name = deShout(input.name.trim())
    if (!name || !sync.householdId) return
    const timestamp = nowIso()
    return sync.commit('recipes', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      name,
      source_url: input.source_url ?? null,
      // Tidied here rather than trusted, for the same reason the name above is:
      // every recipe arrives through this function, and "p. 82" typed into the
      // page box would otherwise be cited as "p. p. 82" for the rest of its life.
      ...tidySource({ book: input.source_book, page: input.source_page }),
      base_servings: input.base_servings ?? 2,
      prep_minutes: null,
      cook_minutes: null,
      method: null,
      image_url: input.image_url ?? null,
      photo: null,
      kcal: null,
      fat_g: null,
      saturates_g: null,
      carbs_g: null,
      sugars_g: null,
      fibre_g: null,
      protein_g: null,
      salt_g: null,
      shortlisted_at: null,
      // Unlabelled, which is "no opinion" and not "suits nothing": a new recipe
      // is offered at every meal until somebody says otherwise on its page.
      suits_breakfast: false,
      suits_lunch: false,
      suits_dinner: false,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  type RecipePatch = Partial<Pick<RecipeRow,
    'name' | 'source_url' | 'source_book' | 'source_page'
    | 'base_servings' | 'prep_minutes' | 'cook_minutes' | 'method' | 'image_url' | 'photo'
    | 'kcal' | 'fat_g' | 'saturates_g' | 'carbs_g' | 'sugars_g' | 'fibre_g' | 'protein_g' | 'salt_g'
    | 'suits_breakfast' | 'suits_lunch' | 'suits_dinner'>>

  async function updateRecipe(id: string, patch: RecipePatch) {
    const current = all.value.get(id)
    if (!current) return
    const name = patch.name === undefined ? {} : { name: deShout(patch.name.trim()) || current.name }
    // Only the halves this patch actually carries, so saving a page number does
    // not re-tidy — or clear — a book nobody touched.
    const source = {
      ...(patch.source_book === undefined ? {} : { source_book: tidyBook(patch.source_book) }),
      ...(patch.source_page === undefined ? {} : { source_page: tidyPage(patch.source_page) })
    }
    await sync.commit('recipes', { ...plainCopy(current), ...patch, ...name, ...source })
  }

  /**
   * The books this household has typed in before, most recently used first.
   *
   * Offered back when the next recipe is photographed, so the same shelf is
   * spelled the same way twice — which is the only thing that makes "everything
   * out of the Ottolenghi" a question anybody can answer later. A pass over an
   * array of tens of rows, which is why this is not an index or a table.
   */
  const books = computed(() => {
    const seen = new Map<string, string>()
    for (const recipe of [...all.value.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      const book = tidyBook(recipe.source_book)
      if (!book || recipe.deleted_at) continue
      // Keyed case-insensitively so one book does not offer itself twice, and the
      // spelling kept is the one used most recently.
      if (!seen.has(book.toLowerCase())) seen.set(book.toLowerCase(), book)
    }
    return [...seen.values()]
  })

  /** What the household fancies soon, most recently added first. */
  const shortlisted = computed(() =>
    recipes.value
      .filter(recipe => recipe.shortlisted_at)
      .sort((a, b) => b.shortlisted_at!.localeCompare(a.shortlisted_at!))
  )

  /**
   * Put a recipe on the shortlist, or take it off.
   *
   * A timestamp rather than a flag, so the list has an order without a second
   * column, and a full-row upsert like everything else — two phones shortlisting
   * the same recipe converge, and doing it in airplane mode queues.
   *
   * The generator reads this as its largest bonus (WEIGHTS.shortlistBonus), which
   * is the whole point: it is how somebody says "this week, please" without
   * having to pick the night themselves.
   */
  async function toggleShortlist(id: string) {
    const current = all.value.get(id)
    if (!current) return
    await sync.commit('recipes', {
      ...plainCopy(current),
      shortlisted_at: current.shortlisted_at ? null : nowIso()
    })
  }

  /**
   * Soft delete. The ingredient lines are left alone: nothing reads them once
   * the recipe is gone, and leaving them means undeleting is a one-row change.
   */
  async function deleteRecipe(id: string) {
    const current = all.value.get(id)
    if (!current) return
    await sync.commit('recipes', { ...plainCopy(current), deleted_at: nowIso() })
  }

  async function addIngredient(recipeId: string, input: {
    name: string
    quantity?: string | null
    aisle_id?: string | null
    ingredient_id?: string | null
  }) {
    // Same treatment as the recipe's own name: a photographed page that shouts
    // its title tends to shout its ingredient list too.
    const name = deShout(input.name.trim())
    if (!name || !sync.householdId) return
    const timestamp = nowIso()
    const highest = ingredientsFor(recipeId).reduce((max, l) => Math.max(max, l.sort_order), 0)
    return sync.commit('recipe_ingredients', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      recipe_id: recipeId,
      name,
      quantity: input.quantity ?? null,
      // Undefined means "work it out"; an explicit null means "no aisle".
      aisle_id: input.aisle_id === undefined ? rememberedAisle(name) : input.aisle_id,
      ingredient_id: input.ingredient_id ?? null,
      sort_order: highest + 1,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  async function updateIngredient(
    id: string,
    patch: Partial<Pick<RecipeIngredientRow, 'name' | 'quantity' | 'aisle_id' | 'ingredient_id'>>
  ) {
    const current = allLines.value.get(id)
    if (!current) return
    const name = patch.name === undefined ? {} : { name: deShout(patch.name.trim()) || current.name }
    await sync.commit('recipe_ingredients', { ...plainCopy(current), ...patch, ...name })
  }

  async function deleteIngredient(id: string) {
    const current = allLines.value.get(id)
    if (!current) return
    await sync.commit('recipe_ingredients', { ...plainCopy(current), deleted_at: nowIso() })
  }

  /**
   * A step, appended.
   *
   * Deliberately the same four functions as the ingredient lines, doing the same
   * four things — a step and an ingredient are both a short string in an order
   * somebody rearranges, and the second copy of a working pattern is cheaper to
   * read than an abstraction over one.
   */
  async function addStep(recipeId: string, body: string) {
    const text = body.trim()
    if (!text || !sync.householdId) return
    const timestamp = nowIso()
    const highest = stepsFor(recipeId).reduce((max, s) => Math.max(max, s.sort_order), 0)
    return sync.commit('recipe_steps', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      recipe_id: recipeId,
      body: text,
      sort_order: highest + 1,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  async function updateStep(id: string, body: string) {
    const current = allSteps.value.get(id)
    const text = body.trim()
    // An emptied step is a deletion somebody expressed by clearing the box, which
    // is a likelier way to mean it than finding the button.
    if (!current) return
    if (!text) return deleteStep(id)
    await sync.commit('recipe_steps', { ...plainCopy(current), body: text })
  }

  async function deleteStep(id: string) {
    const current = allSteps.value.get(id)
    if (!current) return
    await sync.commit('recipe_steps', { ...plainCopy(current), deleted_at: nowIso() })
  }

  async function moveStep(id: string, direction: -1 | 1) {
    const current = allSteps.value.get(id)
    if (!current) return
    const ordered = stepsFor(current.recipe_id)
    const index = ordered.findIndex(s => s.id === id)
    const target = ordered[index + direction]
    const source = ordered[index]
    if (!source || !target) return
    await sync.commit('recipe_steps', { ...plainCopy(source), sort_order: target.sort_order })
    await sync.commit('recipe_steps', { ...plainCopy(target), sort_order: source.sort_order })
  }

  /** Swap sort_order with the neighbour, so lines read in cooking order. */
  async function moveIngredient(id: string, direction: -1 | 1) {
    const current = allLines.value.get(id)
    if (!current) return
    const ordered = ingredientsFor(current.recipe_id)
    const index = ordered.findIndex(l => l.id === id)
    const target = ordered[index + direction]
    const source = ordered[index]
    if (!source || !target) return
    await sync.commit('recipe_ingredients', { ...plainCopy(source), sort_order: target.sort_order })
    await sync.commit('recipe_ingredients', { ...plainCopy(target), sort_order: source.sort_order })
  }

  return {
    /** Every recipe line, for the one-press catch-up on /ingredients. */
    allLines,
    recipes,
    books,
    shortlisted,
    recipeById,
    ingredientsFor,
    ingredientById,
    stepsFor,
    stepById,
    rememberedAisle,
    addRecipe,
    updateRecipe,
    toggleShortlist,
    deleteRecipe,
    addIngredient,
    updateIngredient,
    deleteIngredient,
    moveIngredient,
    addStep,
    updateStep,
    deleteStep,
    moveStep
  }
})
