/**
 * The shape a photo import must arrive in before anything is committed.
 *
 * The Edge Function already constrains the model with a JSON schema, but the
 * client revalidates at its own boundary: the function can change independently
 * of a deployed bundle, and a stub in the acceptance harness answers here too.
 * One tested place, so a malformed payload becomes "try again" rather than a
 * half-written recipe.
 */

export interface ExtractedIngredient {
  name: string
  quantity: string | null
}

export interface ExtractedRecipe {
  name: string
  base_servings: number
  prep_minutes: number | null
  cook_minutes: number | null
  method: string | null
  ingredients: ExtractedIngredient[]
}

/** A cookbook serves a family, not a canteen; anything outside this is a misread. */
const MAX_SERVINGS = 24

function asMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 24 * 60
    ? value
    : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function coerceExtractedRecipe(input: unknown): ExtractedRecipe | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>

  const name = asText(raw.name)
  if (!name) return null
  if (!Array.isArray(raw.ingredients)) return null

  const ingredients: ExtractedIngredient[] = []
  for (const line of raw.ingredients) {
    if (typeof line !== 'object' || line === null) continue
    const lineName = asText((line as Record<string, unknown>).name)
    if (!lineName) continue
    ingredients.push({
      name: lineName,
      quantity: asText((line as Record<string, unknown>).quantity)
    })
  }

  const servings = raw.base_servings
  const base_servings = typeof servings === 'number' && Number.isInteger(servings) && servings > 0
    ? Math.min(servings, MAX_SERVINGS)
    : 2

  return {
    name,
    base_servings,
    prep_minutes: asMinutes(raw.prep_minutes),
    cook_minutes: asMinutes(raw.cook_minutes),
    method: asText(raw.method),
    ingredients
  }
}
