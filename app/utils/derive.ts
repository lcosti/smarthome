import type { ItemRow, PlanEntryRow, RecipeIngredientRow, RecipeRow } from './db'
import { DERIVE_NAMESPACE, uuidv5 } from './uuid5'

export interface DeriveInput {
  householdId: string
  /** Inclusive date range, 'YYYY-MM-DD'. Date keys compare correctly as strings. */
  start: string
  end: string
  entries: PlanEntryRow[]
  recipes: Map<string, RecipeRow>
  ingredients: RecipeIngredientRow[]
  /** Every item with source 'plan', soft-deleted and checked ones included. */
  planItems: ItemRow[]
  rememberAisle: (name: string) => string | null
  /**
   * The canonical ingredient a recipe line means, or null if nothing known does.
   *
   * Injected rather than resolved here so this stays pure, and read-only on
   * purpose: derive never creates an ingredient or writes back to the line. An
   * unresolved line still produces its item, just an item that groups with
   * nothing — so a household that has never opened /ingredients notices no
   * difference.
   */
  resolveIngredientId: (line: RecipeIngredientRow) => string | null
  /** Where a canonical ingredient has been filed, if anybody has said. */
  ingredientAisle: (ingredientId: string | null) => string | null
  now: string
}

export interface DeriveResult {
  creates: ItemRow[]
  updates: ItemRow[]
  removes: ItemRow[]
}

/**
 * The id a given (plan entry, ingredient line) pair always produces.
 *
 * Deterministic rather than random so that two phones deriving the same week
 * while both offline mint the same ids. Their upserts then converge onto one row
 * through the ordinary last-write-wins path, instead of putting two of every
 * ingredient on the list the moment they reconnect.
 */
export function derivedItemId(planEntryId: string, recipeIngredientId: string): string {
  return uuidv5(DERIVE_NAMESPACE, `${planEntryId}:${recipeIngredientId}`)
}

/**
 * A quantity annotated with how far the night's servings differ from what the
 * recipe was written for. The text is never rescaled — it is free text, and
 * "2 tins" times 1.5 is not a thing anyone can act on in an aisle.
 */
export function servingsHint(quantity: string | null, servings: number, baseServings: number): string | null {
  if (baseServings <= 0 || servings === baseServings) return quantity
  const ratio = Math.round((servings / baseServings) * 10) / 10
  if (ratio === 1) return quantity
  return quantity ? `${quantity} ×${ratio}` : `×${ratio}`
}

/**
 * Work out what the shopping list should hold for a range of nights.
 *
 * Pure: it reads local state and returns the rows to write, so the caller owns
 * every commit and this stays testable without Pinia, Dexie or a network.
 *
 * The rules that matter, all of which fall out of one idea — the plan owns an
 * item until a person touches it:
 *
 *   - A checked item is frozen. Someone has it in the trolley; a plan edit at
 *     home must not rewrite or remove it.
 *   - An item deleted while its night is still planned was deleted by a person,
 *     so it is not resurrected. Only unwanted ids are ever removed by the system,
 *     which is what makes that distinction safe to draw.
 *   - An unchecked item is refreshed from the recipe, because the recipe is the
 *     source of truth until someone acts on the item. Its aisle is only filled
 *     in when empty: re-filing something mid-shop must survive a plan tweak.
 *   - Its canonical ingredient is stamped on, and never unstamped. That is what
 *     lets the list group two recipes' tomatoes into one line without any of
 *     these rules changing shape.
 *   - Items belonging to nights outside the range are left completely alone.
 */
export function derive(input: DeriveInput): DeriveResult {
  const {
    householdId, start, end, entries, recipes, ingredients, planItems,
    rememberAisle, resolveIngredientId, ingredientAisle, now
  } = input

  const linesByRecipe = new Map<string, RecipeIngredientRow[]>()
  for (const line of ingredients) {
    if (line.deleted_at) continue
    const bucket = linesByRecipe.get(line.recipe_id)
    if (bucket) bucket.push(line)
    else linesByRecipe.set(line.recipe_id, [line])
  }
  for (const bucket of linesByRecipe.values()) {
    bucket.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  }

  const entryById = new Map(entries.map(e => [e.id, e]))

  // 1. What the plan says the list should contain.
  const wanted = new Map<string, { entry: PlanEntryRow, line: RecipeIngredientRow, recipe: RecipeRow }>()
  for (const entry of entries) {
    if (entry.deleted_at || entry.date < start || entry.date > end) continue
    const recipe = recipes.get(entry.recipe_id)
    if (!recipe || recipe.deleted_at) continue
    for (const line of linesByRecipe.get(recipe.id) ?? []) {
      wanted.set(derivedItemId(entry.id, line.id), { entry, line, recipe })
    }
  }

  const creates: ItemRow[] = []
  const updates: ItemRow[] = []
  const removes: ItemRow[] = []

  // 2. Reconcile what is already on the list.
  for (const item of planItems) {
    // Belt and braces. The caller passes plan-sourced rows, but an ad-hoc item
    // slipping through here would be soft-deleted as "not in the plan" — and
    // "bin bags" vanishing off the list because someone changed Tuesday's dinner
    // is precisely the kind of thing that stops people trusting the app.
    if (item.source !== 'plan') continue

    const hit = wanted.get(item.id)
    wanted.delete(item.id)

    if (hit) {
      if (item.checked || item.deleted_at) continue
      const ingredientId = resolveIngredientId(hit.line)
      const next: ItemRow = {
        ...item,
        name: hit.line.name,
        quantity: servingsHint(hit.line.quantity, hit.entry.servings, hit.recipe.base_servings),
        aisle_id: item.aisle_id ?? ingredientAisle(ingredientId) ?? hit.line.aisle_id ?? rememberAisle(hit.line.name),
        // Never cleared once set. Resolution improving is worth following; it
        // going quiet — because a device has not pulled the ingredient yet — is
        // not worth un-grouping a line somebody is looking at.
        ingredient_id: ingredientId ?? item.ingredient_id
      }
      if (
        next.name !== item.name
        || next.quantity !== item.quantity
        || next.aisle_id !== item.aisle_id
        || next.ingredient_id !== item.ingredient_id
      ) {
        updates.push(next)
      }
      continue
    }

    // Not wanted here. If its night simply falls outside this range, it belongs
    // to another week and is none of our business.
    const entry = item.plan_entry_id ? entryById.get(item.plan_entry_id) : undefined
    if (entry && !entry.deleted_at && (entry.date < start || entry.date > end)) continue
    if (item.checked || item.deleted_at) continue
    removes.push({ ...item, deleted_at: now })
  }

  // 3. Anything still wanted is new.
  for (const [id, { entry, line, recipe }] of wanted) {
    const ingredientId = resolveIngredientId(line)
    creates.push({
      id,
      household_id: householdId,
      name: line.name,
      quantity: servingsHint(line.quantity, entry.servings, recipe.base_servings),
      // The canonical ingredient's aisle outranks the line's, because it is the
      // thing a person filed deliberately and it holds for every recipe using it.
      aisle_id: ingredientAisle(ingredientId) ?? line.aisle_id ?? rememberAisle(line.name),
      checked: false,
      checked_at: null,
      source: 'plan',
      plan_entry_id: entry.id,
      recipe_ingredient_id: line.id,
      ingredient_id: ingredientId,
      deleted_at: null,
      created_at: now,
      updated_at: now
    })
  }

  return { creates, updates, removes }
}
