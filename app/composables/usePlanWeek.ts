import type { Ref } from 'vue'
import { useListStore } from '../stores/list'
import { usePlanStore, type PlannedNight } from '../stores/plan'
import type { RankedCandidate } from '../utils/generator'
import { DINNER, MEALS, type Meal } from '../utils/meal'
import { entryIdsIn, nextUnplannedDate, weekStats } from '../utils/plan-stats'
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
  const list = useListStore()

  const nights = computed<PlannedNight[]>(() => plan.week(weekStart.value))

  /**
   * The nights nobody is eating on, which this week is not asking about.
   *
   * Derived once here rather than at each of the four places that care — the
   * cards, the strip, the fraction, the button that walks the week — because a
   * Wednesday that is greyed out on the strip and still queued up by the footer
   * is worse than either behaviour on its own.
   */
  const noOneEating = computed(
    () => new Set(nights.value.filter(night => plan.nobodyEatingOn(night.date)).map(night => night.date))
  )

  const skipNight = (date: string) => noOneEating.value.has(date)

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
   * ago. A night nobody is in for is skipped for the same reason — "Use Wed" is
   * an offer to cook for an empty house.
   */
  const target = computed(() =>
    nights.value.find(night =>
      !night.entries.length && night.date >= today.value && !skipNight(night.date)
    )?.date ?? null
  )

  /**
   * Ranked meals for every night still empty, scored once for the whole week,
   * and then only the ones for the night being offered.
   *
   * Asked once rather than per empty card: the same top-ranked meal is the
   * top-ranked meal on every free night, so a shortlist on each of them said the
   * same recipe name seven times and read as a plan already made.
   */
  const suggestions = computed<RankedCandidate[]>(() => suggestionsFor(target.value))

  /**
   * The week's ranked meals, kept as one map rather than one lookup per night.
   *
   * Scoring is the expensive part and it is done for the whole week at once, so
   * the phone walking Monday to Sunday costs what the wide screen's single
   * shortlist costs.
   */
  const suggestionsByNight = computed(() => plan.weekSuggestions(weekStart.value, 4))

  /** The shortlist for one night, for a page that shows a night at a time. */
  function suggestionsFor(date: string | null): RankedCandidate[] {
    return date ? suggestionsByNight.value.get(date) ?? [] : []
  }

  /** How full the week is, how much cooking it is, and which night is the long one. */
  const stats = computed(() => weekStats(nights.value, skipNight))

  /** What this week is still waiting on at the shop — every slot of it, not just the dinners. */
  const toBuy = computed(() => list.outstandingForEntries(entryIdsIn(nights.value)))

  /**
   * The night the "next" button goes to, or null when there is none left — which
   * is what turns it into "review the week".
   */
  function nextUnplanned(after?: string | null): string | null {
    return nextUnplannedDate(nights.value, today.value, after, skipNight)
  }

  /** Stays true after the last night comes off — that is exactly when the list
   * still holds ingredients nobody is going to cook. */
  const canDerive = computed(() => plan.hasWorkFor(weekStart.value))

  /** What pressing the shopping button would actually do, so it can say so. */
  const deriveLabel = computed(() => {
    if (!canDerive.value) return 'Add to shopping list'
    const added = plan.derivePreview(weekStart.value).added
    return added ? `Add ${added} to list` : 'Add to shopping list'
  })

  /** Take the meal off one of a day's slots, which for the card that asks is the dinner. */
  async function removeNight(night: PlannedNight, meal: Meal = DINNER) {
    const planned = night.meals[meal]
    if (!planned) return
    await plan.removeEntry(planned.entry.id)
  }

  /**
   * Whether there is anything ahead to clear. A week already cooked has not.
   *
   * Any slot counts: a week somebody has only put breakfasts on is still a week
   * with something to empty, and a "Clear week" greyed out in front of it would
   * be the app disagreeing with the screen.
   */
  const canClear = computed(() => cards.value.some(night => MEALS.some(meal => night.meals[meal])))

  /**
   * Empty the nights still to come, and say how many had a meal on them.
   *
   * The nights that have gone are left alone: the same split that decides which
   * of them get a card decides which of them a clear can touch, so the strip
   * along the top stays the record it is.
   */
  async function clearWeek() {
    return plan.clearWeek(cards.value.map(night => night.date))
  }

  return {
    nights,
    strip,
    cards,
    noOneEating,
    target,
    suggestions,
    suggestionsFor,
    stats,
    toBuy,
    nextUnplanned,
    canDerive,
    deriveLabel,
    removeNight,
    canClear,
    clearWeek
  }
}
