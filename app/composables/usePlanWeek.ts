import type { Ref } from 'vue'
import { usePlanStore, type PlannedNight } from '../stores/plan'
import type { RankedCandidate } from '../utils/generator'
import { splitWeek } from '../utils/week'

/**
 * One week of the plan, derived once for both shapes of the page.
 *
 * The phone and the wide screen show the same week differently — a column of
 * cards under a sticky button, or a grid beside an aside — but they must not
 * disagree about what is in it: which nights have gone, which night a suggestion
 * would land on, or what pressing "add to list" would do. Everything that is a
 * fact about the week rather than about a layout lives here.
 *
 * Both arguments are refs because the week on screen moves — the page steps
 * backwards and forwards through weeks — and midnight moves `today` under a
 * tablet that has been awake for three days.
 */
export function usePlanWeek(weekStart: Ref<string>, today: Ref<string>) {
  const plan = usePlanStore()

  const nights = computed<PlannedNight[]>(() => plan.week(weekStart.value))

  /** What has been cooked, and what is still to decide. */
  const split = computed(() => splitWeek(nights.value, today.value))
  const strip = computed(() => split.value.strip)
  const cards = computed(() => split.value.cards)

  /**
   * The night a suggestion plans onto — the first one still open and still
   * ahead.
   *
   * Skipping the nights that have gone is the whole point: on a Friday the first
   * empty night is Monday, and "Use Mon" is an offer to cook something four days
   * ago.
   */
  const target = computed(() =>
    nights.value.find(night => !night.entries.length && night.date >= today.value)?.date ?? null
  )

  /**
   * Ranked meals for every night still empty, scored once for the whole week,
   * and then only the ones for the night being offered.
   *
   * Asked once rather than per empty card: the same top-ranked meal is the
   * top-ranked meal on every free night, so a shortlist on each of them said the
   * same recipe name seven times and read as a plan already made.
   */
  const suggestions = computed<RankedCandidate[]>(() => {
    if (!target.value) return []
    return plan.weekSuggestions(weekStart.value, 4).get(target.value) ?? []
  })

  /** Stays true after the last night comes off — that is exactly when the list
   * still holds ingredients nobody is going to cook. */
  const canDerive = computed(() => plan.hasWorkFor(weekStart.value))

  /** What pressing the shopping button would actually do, so it can say so. */
  const deriveLabel = computed(() => {
    if (!canDerive.value) return 'Add to shopping list'
    const added = plan.derivePreview(weekStart.value).added
    return added ? `Add ${added} to list` : 'Add to shopping list'
  })

  /** Take the meal off a night. One entry per night today; the first is it. */
  async function removeNight(night: PlannedNight) {
    const planned = night.entries[0]
    if (!planned) return
    await plan.removeEntry(planned.entry.id)
  }

  return { nights, strip, cards, target, suggestions, canDerive, deriveLabel, removeNight }
}
