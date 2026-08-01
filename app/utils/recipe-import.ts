/**
 * The shape an import must arrive in before anything is committed — whether it
 * was read off a photograph or off a web page.
 *
 * The Edge Function already constrains the model with a JSON schema, but the
 * client revalidates at its own boundary: the function can change independently
 * of a deployed bundle, and a stub in the acceptance harness answers here too.
 * One tested place, so a malformed payload becomes "try again" rather than a
 * half-written recipe.
 */

import { NUTRITION_FIELDS, type NutritionKey } from './nutrition'

export interface ExtractedIngredient {
  name: string
  quantity: string | null
}

/** Per serving, as the source printed it. The keys are the recipes columns. */
export type ExtractedNutrition = Record<NutritionKey, number | null>

export interface ExtractedRecipe {
  name: string
  base_servings: number
  prep_minutes: number | null
  cook_minutes: number | null
  /** In cooking order. Empty when the source had no method to read. */
  steps: string[]
  ingredients: ExtractedIngredient[]
  /** The source's per-serving nutrition panel, or null when it had none. */
  nutrition: ExtractedNutrition | null
  /** The picture the source page published, or null. Always an absolute address. */
  image_url: string | null
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

/**
 * One block of method text as the steps it was always meant to be, split on
 * blank lines.
 *
 * This is the rule the wall board used to apply at render time, kept because a
 * deployed function can still answer with a single `method` string — the bundle
 * and the functions ship separately, so the client has to be able to make steps
 * out of whichever shape arrives. It is also how the migration backfilled the
 * library, which is what keeps old and new imports numbered the same way.
 */
export function splitMethodIntoSteps(method: string): string[] {
  return method
    .split(/\n\s*\n/)
    .map(step => step.trim())
    .filter(Boolean)
}

/**
 * A nutrition panel a function answered with, reduced to what is storable:
 * finite non-negative numbers per known field, anything else null. Null overall
 * when nothing survives — including everything an undeployed function answers,
 * which is nothing. Exported because the estimator's answer crosses the same
 * boundary as the importers' and gets the same treatment.
 */
export function asNutrition(value: unknown): ExtractedNutrition | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  const panel = {} as ExtractedNutrition
  let anything = false
  for (const { key } of NUTRITION_FIELDS) {
    const entry = raw[key]
    const usable = typeof entry === 'number' && Number.isFinite(entry) && entry >= 0
    panel[key] = usable ? entry : null
    if (usable) anything = true
  }
  return anything ? panel : null
}

/**
 * An absolute http(s) address, or null.
 *
 * This value ends up in an `<img src>`, so the check is a filter and not a
 * formality: `javascript:` and `data:` are refused here rather than trusted to
 * whatever answered. The function validates the same way — both ends, because
 * the bundle and the functions deploy separately.
 */
export function asImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^https?:\/\/[^\s"'<>]+$/i.test(trimmed) ? trimmed : null
}

/**
 * Whether what was typed is a link rather than a recipe name.
 *
 * Deliberately blunt: the one box on the recipes page both searches and adds, so
 * this only has to tell a pasted address from something a person would call a
 * meal. Nobody names a recipe "https://".
 */
export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

/**
 * What to tell someone whose import call came back an error.
 *
 * The distinction that matters is whether a reply arrived at all. A function of
 * ours answers with `{ error }` and its own words are always the best ones. But
 * a function that is missing, cold, or over its limits never runs: Supabase's
 * gateway answers `{ code, message }` and a local Kong answers `{ message }`,
 * neither of which has an `error` key. Reading those as "no signal" sends you to
 * check the wifi when the fault is a function that was never deployed, so say
 * the status out loud instead.
 *
 * The type check on `context` is not defensive noise: `FunctionsHttpError` puts
 * the Response there, but `FunctionsFetchError` — the genuine network failure
 * this fallback exists for — puts the fetch error there instead.
 */
export async function importFailureMessage(
  invokeError: unknown,
  fallback: string
): Promise<string> {
  const context = typeof invokeError === 'object' && invokeError !== null && 'context' in invokeError
    ? (invokeError as { context: unknown }).context
    : null

  if (!(context instanceof Response)) return fallback

  const body = await context.json().catch(() => null) as { error?: unknown } | null
  const stated = asText(body?.error)
  if (stated) return stated

  return `Recipe import is down (${context.status}) — that's the app, not your signal.`
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

  // Either shape is accepted on purpose. A current function answers with `steps`;
  // one that has not been redeployed yet answers with `method`, and a recipe
  // imported through the old shape should still arrive as steps rather than as a
  // paragraph in the notes.
  const steps: string[] = []
  if (Array.isArray(raw.steps)) {
    for (const entry of raw.steps) {
      const step = asText(entry)
      if (step) steps.push(step)
    }
  } else {
    const method = asText(raw.method)
    if (method) steps.push(...splitMethodIntoSteps(method))
  }

  return {
    name,
    base_servings,
    prep_minutes: asMinutes(raw.prep_minutes),
    cook_minutes: asMinutes(raw.cook_minutes),
    steps,
    ingredients,
    nutrition: asNutrition(raw.nutrition),
    image_url: asImageUrl(raw.image_url)
  }
}
