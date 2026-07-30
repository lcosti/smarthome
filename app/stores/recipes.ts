import { defineStore } from 'pinia'
import type { RecipeIngredientRow, RecipeRow, RecipeStepRow } from '../utils/db'
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

  function stepsFor(recipeId: string): RecipeStepRow[] {
    return [...allSteps.value.values()]
      .filter(s => s.recipe_id === recipeId && !s.deleted_at)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  }

  function stepById(id: string): RecipeStepRow | undefined {
    const row = allSteps.value.get(id)
    return row && !row.deleted_at ? row : undefined
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
    return best?.aisle_id ?? null
  }

  async function addRecipe(input: {
    name: string
    source_url?: string | null
    base_servings?: number
  }) {
    const name = input.name.trim()
    if (!name || !sync.householdId) return
    const timestamp = nowIso()
    return sync.commit('recipes', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      name,
      source_url: input.source_url ?? null,
      base_servings: input.base_servings ?? 2,
      prep_minutes: null,
      cook_minutes: null,
      method: null,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  type RecipePatch = Partial<Pick<RecipeRow,
    'name' | 'source_url' | 'base_servings' | 'prep_minutes' | 'cook_minutes' | 'method'>>

  async function updateRecipe(id: string, patch: RecipePatch) {
    const current = all.value.get(id)
    if (!current) return
    await sync.commit('recipes', { ...plainCopy(current), ...patch })
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
    const name = input.name.trim()
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
    await sync.commit('recipe_ingredients', { ...plainCopy(current), ...patch })
  }

  async function deleteIngredient(id: string) {
    const current = allLines.value.get(id)
    if (!current) return
    await sync.commit('recipe_ingredients', { ...plainCopy(current), deleted_at: nowIso() })
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

  async function addStep(recipeId: string, text: string) {
    const trimmed = text.trim()
    if (!trimmed || !sync.householdId) return
    const timestamp = nowIso()
    const highest = stepsFor(recipeId).reduce((max, s) => Math.max(max, s.sort_order), 0)
    return sync.commit('recipe_steps', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      recipe_id: recipeId,
      text: trimmed,
      sort_order: highest + 1,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  /**
   * Append several at once, in order. Sequential rather than parallel because
   * each one reads the highest sort_order the last one wrote — commit updates
   * local state before it resolves, so awaiting is what keeps them in sequence.
   */
  async function addSteps(recipeId: string, texts: string[]) {
    for (const text of texts) await addStep(recipeId, text)
  }

  async function updateStep(id: string, text: string) {
    const current = allSteps.value.get(id)
    const trimmed = text.trim()
    if (!current || !trimmed) return
    await sync.commit('recipe_steps', { ...plainCopy(current), text: trimmed })
  }

  async function deleteStep(id: string) {
    const current = allSteps.value.get(id)
    if (!current) return
    await sync.commit('recipe_steps', { ...plainCopy(current), deleted_at: nowIso() })
  }

  /** As moveIngredient: swap sort_order with the neighbour, renumbering nothing. */
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

  return {
    /** Every recipe line, for the one-press catch-up on /ingredients. */
    allLines,
    recipes,
    recipeById,
    ingredientsFor,
    ingredientById,
    stepsFor,
    stepById,
    rememberedAisle,
    addRecipe,
    updateRecipe,
    deleteRecipe,
    addIngredient,
    updateIngredient,
    deleteIngredient,
    moveIngredient,
    addStep,
    addSteps,
    updateStep,
    deleteStep,
    moveStep
  }
})
