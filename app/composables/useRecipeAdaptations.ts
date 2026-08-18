import { usePeopleStore } from '../stores/people'
import { useRecipesStore } from '../stores/recipes'
import { audienceLabel, householdAudiences, matchAdaptations } from '../utils/adaptations'
import type { RecipeAdaptationItemRow } from '../utils/db'

/** One override, resolved to the line or step it amends and said as a sentence. */
export interface AdaptationItemView {
  id: string
  kind: 'ingredient' | 'step'
  /** Live target only: an item whose line or step has been deleted is skipped. */
  lineId: string | null
  stepId: string | null
  /** "Swap the Greek yoghurt for coconut yoghurt", "Step 3 — set theirs aside". */
  text: string
}

export interface AdaptationView {
  id: string
  /** 'Weaning', or the diet tag as stored. */
  label: string
  /** "for Astrid", "for Astrid and Tom" — who at this table it is for. */
  forWho: string
  note: string | null
  items: AdaptationItemView[]
}

/**
 * The adaptations worth showing for one recipe, resolved and ready to draw.
 *
 * One computed shared by the read panel and cook mode, so "which adaptations
 * apply, to whom, and to which line or step" has a single answer wherever it is
 * asked. Matching is against the household today — anyone alive whose stage or
 * diet fits — which is what lets this exist on pages that know no date and
 * lets a weaning entry vanish everywhere at once as the baby ages up.
 */
export function useRecipeAdaptations(recipeId: () => string | null) {
  const recipes = useRecipesStore()
  const people = usePeopleStore()
  const today = useToday()

  const matched = computed<AdaptationView[]>(() => {
    const id = recipeId()
    if (!id) return []
    const audiences = householdAudiences(people.people, people.constraints, today.value)
    return matchAdaptations(recipes.adaptationsFor(id), audiences).map(({ adaptation, people: who }) => ({
      id: adaptation.id,
      label: audienceLabel(adaptation),
      forWho: `for ${listNames(who.map(person => person.name))}`,
      note: adaptation.note?.trim() || null,
      items: recipes.adaptationItemsFor(adaptation.id)
        .map(item => resolveItem(item))
        .filter((item): item is AdaptationItemView => item !== null)
    }))
  })

  /**
   * An override says where it applies, so cook mode can put the sentence on the
   * line being measured or the step being done rather than in a panel behind
   * the current pane.
   */
  function resolveItem(item: RecipeAdaptationItemRow): AdaptationItemView | null {
    if (item.kind === 'ingredient') {
      const line = recipes.ingredientById(item.recipe_ingredient_id ?? '')
      if (!line) return null
      return {
        id: item.id,
        kind: 'ingredient',
        lineId: line.id,
        stepId: null,
        text: ingredientText(item.action, line.name, item.body)
      }
    }
    const step = recipes.stepById(item.recipe_step_id ?? '')
    if (!step) return null
    const id = recipeId()
    const position = id ? recipes.stepsFor(id).findIndex(s => s.id === step.id) + 1 : 0
    return {
      id: item.id,
      kind: 'step',
      lineId: null,
      stepId: step.id,
      text: position > 0 ? `Step ${position} — ${item.body}` : item.body
    }
  }

  const byLine = computed(() => groupTargets(matched.value, 'lineId'))
  const byStep = computed(() => groupTargets(matched.value, 'stepId'))

  return { matched, byLine, byStep }
}

/** The same entry cook mode draws: whose adaptation, and what it says. */
export interface TargetedAdaptation {
  label: string
  forWho: string
  text: string
}

function groupTargets(views: AdaptationView[], key: 'lineId' | 'stepId'): Map<string, TargetedAdaptation[]> {
  const map = new Map<string, TargetedAdaptation[]>()
  for (const view of views) {
    for (const item of view.items) {
      const target = item[key]
      if (!target) continue
      if (!map.has(target)) map.set(target, [])
      map.get(target)!.push({ label: view.label, forWho: view.forWho, text: item.text })
    }
  }
  return map
}

function ingredientText(action: string | null, lineName: string, body: string): string {
  const detail = body.trim()
  if (action === 'swap') return `Swap the ${lineName} for ${detail}`
  if (action === 'omit') return detail ? `Skip the ${lineName} — ${detail}` : `Skip the ${lineName}`
  return detail ? `Less ${lineName} — ${detail}` : `Less ${lineName}`
}

/** "Astrid", "Astrid and Tom", "Astrid, Tom and Pia". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
