<script setup lang="ts">
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { suggestionReason, type RankedCandidate } from '../utils/generator'

/**
 * What to cook on the next night still open, offered rather than decided.
 *
 * Asked once for the week rather than once per empty night: the same top-ranked
 * meal is the top-ranked meal on every free night, so repeating the shortlist on
 * each empty card said the same recipe name seven times and read as a plan
 * already made.
 *
 * One component for both shapes. On a wide screen it is the bottom of the aside;
 * on a phone it is what follows the nights. An offer is the same offer either
 * way, and the two drifting apart is how a suggestion on one becomes a decision
 * on the other.
 */
const { suggestions, nights, target } = defineProps<{
  /** Ranked meals for the night the buttons plan onto. Empty when the week is full. */
  suggestions: RankedCandidate[]
  /** The whole week, for what is already spoken for and how often it has been cooked. */
  nights: PlannedNight[]
  /** The first night still empty and still ahead, or null when there is none. */
  target: string | null
}>()

const emit = defineEmits<{ pick: [recipeId: string] }>()

const plan = usePlanStore()
const recipes = useRecipesStore()
const pantryCovers = usePantryCovers()

const dayName = computed(() => {
  if (!target) return null
  const [year, month, day] = target.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'short' })
})

/** Every recipe already on this week, so a suggestion can admit it is spoken for. */
const onPlan = computed(() =>
  new Set(nights.flatMap(night => night.entries.map(planned => planned.entry.recipe_id)))
)

/** What it costs to cook, for the badge on the offer. Zero reads as no badge. */
function minutesOf(candidate: RankedCandidate): number {
  return (candidate.recipe.prep_minutes ?? 0) + (candidate.recipe.cook_minutes ?? 0)
}

/**
 * The reason line, with the one fact the scorer cannot know folded in: whether
 * the cupboard already covers it. Nothing to buy beats every other argument for
 * cooking something tonight.
 */
function reasonFor(candidate: RankedCandidate): string {
  const lines = recipes.ingredientsFor(candidate.recipe.id)
  const allPantry = lines.length > 0 && lines.every(line => pantryCovers.value(line))
  return suggestionReason(candidate, {
    allPantry,
    cookedTimes: plan.timesCooked(candidate.recipe.id, nights[0]?.date ?? '')
  })
}
</script>

<template>
  <div>
    <h3 class="text-xs text-dimmed">
      Recommended meals
    </h3>

    <ul
      v-if="suggestions.length"
      class="mt-2 flex flex-col gap-2"
    >
      <li
        v-for="candidate in suggestions"
        :key="candidate.recipe.id"
      >
        <!--
          An offer is a card, not a paragraph with a button after it: the name,
          why it is being offered, what it will cost you and the one thing to do
          about it are one object, and four of them in a column should read as
          four things you could pick rather than as prose.
        -->
        <UCard
          variant="soft"
          :ui="{ body: 'px-3.5 py-3 sm:p-3.5' }"
        >
          <p class="text-pretty text-sm font-medium leading-tight text-highlighted">
            {{ candidate.recipe.name }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ reasonFor(candidate) }}
          </p>

          <div class="mt-2.5 flex items-center gap-2">
            <UBadge
              v-if="minutesOf(candidate)"
              color="neutral"
              variant="subtle"
              size="sm"
              :label="`${minutesOf(candidate)}m`"
            />
            <UButton
              v-if="onPlan.has(candidate.recipe.id)"
              color="neutral"
              variant="subtle"
              size="xs"
              label="On plan"
              disabled
              class="ml-auto"
            />
            <UButton
              v-else
              color="primary"
              variant="subtle"
              size="xs"
              :label="`Use ${dayName}`"
              class="ml-auto"
              @click="emit('pick', candidate.recipe.id)"
            />
          </div>
        </UCard>
      </li>
    </ul>

    <UEmpty
      v-else
      variant="naked"
      size="sm"
      :icon="target ? 'i-lucide-search-x' : 'i-lucide-check'"
      :title="target ? 'Nothing left to suggest' : 'Nothing left to plan'"
      :description="target
        ? 'Every recipe is already on this week or ruled out by an allergy.'
        : 'Every night this week has a meal on it.'"
      :ui="{ root: 'mt-2 p-0 sm:p-0' }"
    />
  </div>
</template>
