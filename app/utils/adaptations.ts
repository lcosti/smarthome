/**
 * Which recipe adaptations apply to this household, and to whom.
 *
 * An adaptation names an audience — a life stage or a diet — and the household
 * answers with people. The match is derived at read time from dates of birth
 * and constraint rows, never stored, so a weaning adaptation retires by itself
 * the week the baby turns one and nobody edits anything (decision #3, applied
 * to a new question).
 *
 * Pure, structural interfaces, no store imports — the attendance.ts shape —
 * because the panel, cook mode and the tests all ask this question and must get
 * the same answer.
 */

import { DIET_KIND, normaliseTag } from './attendance'
import { STAGE_LABEL, deriveLifeStage } from './people'
import { ADAPTATION_NAMESPACE, uuidv5 } from './uuid5'

/**
 * The stages an adaptation can target. 'baby' is deliberately absent: a
 * pre-weaning baby is at the table and eating nothing off it, so there is
 * nothing to adapt.
 */
export const ADAPTATION_STAGES = ['weaning', 'toddler', 'child', 'adult'] as const
export type AdaptationStage = typeof ADAPTATION_STAGES[number]

/** Narrowed at the boundary, never cast — the asConstraintKind convention. */
export function asAdaptationStage(value: string | null): AdaptationStage | null {
  return (ADAPTATION_STAGES as readonly string[]).includes(value ?? '')
    ? value as AdaptationStage
    : null
}

export interface AdaptationLike {
  life_stage: string | null
  diet_tag: string | null
  deleted_at: string | null
}

export interface AdaptationPersonLike {
  id: string
  name: string
  date_of_birth: string | null
  deleted_at: string | null
}

export interface AdaptationConstraintLike {
  person_id: string
  kind: string
  tag: string
  deleted_at: string | null
}

/**
 * The audience half of an adaptation's identity: 'stage:weaning' or
 * 'diet:high protein', with the tag normalised so however a device typed the
 * diet, both mint the same id.
 */
export function adaptationAudienceKey(adaptation: Pick<AdaptationLike, 'life_stage' | 'diet_tag'>): string {
  if (adaptation.life_stage) return `stage:${adaptation.life_stage}`
  return `diet:${normaliseTag(adaptation.diet_tag ?? '')}`
}

/**
 * The id a given (recipe, audience) always produces, so two devices authoring
 * the same adaptation converge through the ordinary last-write-wins path.
 */
export function adaptationId(householdId: string, recipeId: string, audienceKey: string): string {
  return uuidv5(ADAPTATION_NAMESPACE, `${householdId}:${recipeId}:${audienceKey}`)
}

/** Who in the household is at each stage, and on each diet, today. */
export interface HouseholdAudiences {
  stages: Map<AdaptationStage, AdaptationPersonLike[]>
  diets: Map<string, AdaptationPersonLike[]>
}

export function householdAudiences(
  people: AdaptationPersonLike[],
  constraints: AdaptationConstraintLike[],
  today: string
): HouseholdAudiences {
  const alive = people.filter(person => !person.deleted_at)
  const byId = new Map(alive.map(person => [person.id, person]))

  const stages = new Map<AdaptationStage, AdaptationPersonLike[]>()
  for (const person of alive) {
    // 'baby' falls through: not an audience, see ADAPTATION_STAGES.
    const stage = asAdaptationStage(deriveLifeStage(person.date_of_birth, today))
    if (!stage) continue
    if (!stages.has(stage)) stages.set(stage, [])
    stages.get(stage)!.push(person)
  }

  const diets = new Map<string, AdaptationPersonLike[]>()
  for (const constraint of constraints) {
    if (constraint.deleted_at || constraint.kind !== DIET_KIND) continue
    const person = byId.get(constraint.person_id)
    if (!person) continue
    const tag = normaliseTag(constraint.tag)
    if (!diets.has(tag)) diets.set(tag, [])
    diets.get(tag)!.push(person)
  }

  return { stages, diets }
}

export interface MatchedAdaptation<T extends AdaptationLike> {
  adaptation: T
  /** Who at this table it is for — the names beside the badge. */
  people: AdaptationPersonLike[]
}

/**
 * The adaptations worth showing: those whose audience somebody currently is.
 * Youngest stage first — the weaning note is the one that cannot wait — then
 * diets alphabetically.
 */
export function matchAdaptations<T extends AdaptationLike>(
  adaptations: Iterable<T>,
  audiences: HouseholdAudiences
): MatchedAdaptation<T>[] {
  const matched: MatchedAdaptation<T>[] = []
  for (const adaptation of adaptations) {
    if (adaptation.deleted_at) continue
    const stage = asAdaptationStage(adaptation.life_stage)
    const people = stage
      ? audiences.stages.get(stage)
      : audiences.diets.get(normaliseTag(adaptation.diet_tag ?? ''))
    if (people?.length) matched.push({ adaptation, people })
  }
  return matched.sort((a, b) => audienceRank(a.adaptation) - audienceRank(b.adaptation)
    || audienceLabel(a.adaptation).localeCompare(audienceLabel(b.adaptation)))
}

function audienceRank(adaptation: AdaptationLike): number {
  const stage = asAdaptationStage(adaptation.life_stage)
  return stage ? ADAPTATION_STAGES.indexOf(stage) : ADAPTATION_STAGES.length
}

/** The actions an ingredient override can take, in the order they are offered. */
export const OVERRIDE_ACTIONS = [
  { value: 'swap', label: 'Swap' },
  { value: 'omit', label: 'Skip' },
  { value: 'reduce', label: 'Less' }
] as const
export type OverrideAction = typeof OVERRIDE_ACTIONS[number]['value']

/**
 * An ingredient override said as a sentence, so the panel, cook mode and the
 * editor all say it the same way. For a swap the body is the replacement; for
 * skip and less it is optional detail.
 */
export function ingredientOverrideText(action: string | null, lineName: string, body: string): string {
  const detail = body.trim()
  if (action === 'swap') return `Swap the ${lineName} for ${detail}`
  if (action === 'omit') return detail ? `Skip the ${lineName} — ${detail}` : `Skip the ${lineName}`
  return detail ? `Less ${lineName} — ${detail}` : `Less ${lineName}`
}

/** 'Weaning', or the diet tag as stored. */
export function audienceLabel(adaptation: Pick<AdaptationLike, 'life_stage' | 'diet_tag'>): string {
  const stage = asAdaptationStage(adaptation.life_stage)
  if (stage) return STAGE_LABEL[stage]
  return adaptation.diet_tag ?? ''
}

export interface SuggestedAdaptation {
  life_stage: AdaptationStage | null
  diet_tag: string | null
  note: string | null
  ingredient_overrides: { recipe_ingredient_id: string, action: OverrideAction, body: string }[]
  step_amendments: { recipe_step_id: string, body: string }[]
}

const OVERRIDE_ACTION_VALUES = OVERRIDE_ACTIONS.map(action => action.value) as string[]

/**
 * What suggest-adaptations answered, reduced to what is usable: entries with
 * exactly one audience, overrides with a target and a known action, anything
 * else dropped. The Edge Function constrains the model with a schema, but the
 * client revalidates at its own boundary — the bundle and the function deploy
 * independently, and an undeployed function answers with nothing.
 */
export function asSuggestions(value: unknown): SuggestedAdaptation[] {
  if (!Array.isArray(value)) return []
  const suggestions: SuggestedAdaptation[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const raw = entry as Record<string, unknown>
    const life_stage = asAdaptationStage(typeof raw.life_stage === 'string' ? raw.life_stage : null)
    const diet_tag = typeof raw.diet_tag === 'string' && normaliseTag(raw.diet_tag)
      ? normaliseTag(raw.diet_tag)
      : null
    if ((life_stage === null) === (diet_tag === null)) continue

    const overrides = (Array.isArray(raw.ingredient_overrides) ? raw.ingredient_overrides : [])
      .filter((o): o is { recipe_ingredient_id: string, action: OverrideAction, body: string } =>
        typeof o?.recipe_ingredient_id === 'string'
        && typeof o?.action === 'string' && OVERRIDE_ACTION_VALUES.includes(o.action)
        && typeof o?.body === 'string'
        // A swap with no replacement says nothing — the store refuses it too.
        && (o.action !== 'swap' || o.body.trim() !== ''))
    const amendments = (Array.isArray(raw.step_amendments) ? raw.step_amendments : [])
      .filter((a): a is { recipe_step_id: string, body: string } =>
        typeof a?.recipe_step_id === 'string'
        && typeof a?.body === 'string' && a.body.trim() !== '')
    const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim() : null

    // An empty suggestion is the model agreeing the dish already suits them.
    if (!overrides.length && !amendments.length && !note) continue
    suggestions.push({
      life_stage: diet_tag ? null : life_stage,
      diet_tag,
      note,
      ingredient_overrides: overrides,
      step_amendments: amendments
    })
  }
  return suggestions
}
