<script setup lang="ts">
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { isoDate, mondayOf, weekLabel } from '../utils/week'

/**
 * The week as a screenful, for a screen with the room for it.
 *
 * Seven thin columns answered exactly one question — what is on Thursday — and
 * made everything else somebody else's job. Four across and two down gives each
 * night the height to carry what it is, whether it has been shopped for, and who
 * is at the table, and leaves an eighth cell for the four facts about the week
 * that no single night knows.
 *
 * Nothing on this screen scrolls the page. The grid is fixed to the viewport and
 * the aside scrolls on its own, so pressing "fill" never moves the thing you were
 * looking at.
 *
 * The phone gets the same seven nights as rows. Both shapes edit through the one
 * night editor the page above owns, so neither can grow an opinion the other
 * does not have.
 */
const { nights, today, weekStart, canFill, canDerive, filling, deriving } = defineProps<{
  nights: PlannedNight[]
  today: string
  weekStart: string
  canFill: boolean
  canDerive: boolean
  filling: boolean
  deriving: boolean
}>()

const emit = defineEmits<{
  open: [date: string]
  fill: []
  derive: []
  /** Weeks to move, and back to the week the household is living in. */
  step: [weeks: number]
  reset: []
}>()

const plan = usePlanStore()
const toast = useToast()

const monday = computed(() => {
  const [year, month, day] = weekStart.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
})

/** Whether the week on screen is the one the household is living in. */
const thisWeek = computed(() => weekStart === isoDate(mondayOf(new Date())))

/**
 * Ranked meals for every night still empty, scored once for the whole week.
 *
 * The aside is the only thing that asks. Repeating the shortlist on each empty
 * card said the same recipe name seven times over — the same top-ranked meal is
 * the top-ranked meal on every free night — which read as a plan already made
 * rather than as an offer.
 */
const suggestions = computed(() => plan.weekSuggestions(weekStart, 4))

/**
 * The night the aside plans onto — the first one still open and still ahead.
 *
 * Skipping the nights that have gone is the whole point: on a Friday the first
 * empty night is Monday, and "Use Mon" is an offer to cook something four days
 * ago.
 */
const target = computed(() =>
  nights.find(night => !night.entries.length && night.date >= today)?.date ?? null
)

const asideSuggestions = computed(() =>
  target.value ? suggestions.value.get(target.value) ?? [] : []
)

/** What pressing the shopping button would actually do, so it can say so. */
const preview = computed(() => (canDerive ? plan.derivePreview(weekStart) : null))

const deriveLabel = computed(() => {
  const added = preview.value?.added ?? 0
  return added ? `Add ${added} item${added === 1 ? '' : 's'} to list` : 'Add to shopping list'
})

async function pick(date: string, recipeId: string) {
  const row = await plan.setNight(date, recipeId)
  if (!row) return
  toast.add({
    title: `${plan.plannedEntry(row).recipe?.name ?? 'Dinner'} planned`,
    icon: 'i-lucide-check',
    color: 'success'
  })
}
</script>

<template>
  <!--
    A screenful, not a page. h-full rather than a viewport calculation: the shell
    is already one viewport tall and has taken the app header off the top.
  -->
  <div class="flex h-full min-h-0 flex-col gap-4 px-6 py-4">
    <div class="flex shrink-0 items-center gap-4">
      <h2 class="text-2xl font-semibold tracking-[-0.025em] text-highlighted">
        Plan
      </h2>

      <div class="flex items-center gap-0.5 rounded-lg bg-elevated/50 p-1 ring ring-default">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Previous week"
          @click="emit('step', -1)"
        />
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          block
          class="min-w-[9rem]"
          :aria-label="thisWeek ? undefined : 'Back to this week'"
          @click="emit('reset')"
        >
          {{ weekLabel(monday) }}
          <span
            v-if="!thisWeek"
            class="ml-1 text-dimmed"
          >· this week</span>
        </UButton>
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="Next week"
          @click="emit('step', 1)"
        />
      </div>

      <!-- Suggest, adjust what you don't fancy, then shop: the order of the week. -->
      <div class="ml-auto flex items-center gap-2">
        <UButton
          v-if="canFill"
          color="neutral"
          variant="subtle"
          size="lg"
          icon="i-lucide-wand-sparkles"
          label="Fill empty nights"
          :loading="filling"
          @click="emit('fill')"
        />
        <UButton
          color="primary"
          variant="solid"
          size="lg"
          icon="i-lucide-shopping-cart"
          :label="deriveLabel"
          :disabled="!canDerive"
          :loading="deriving"
          @click="emit('derive')"
        />
      </div>
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-4 overflow-hidden">
      <!-- Seven nights and the week itself, always all eight: an empty night is the invitation. -->
      <div class="grid min-h-0 grid-cols-4 grid-rows-2 gap-3">
        <PlanNightCard
          v-for="night in nights"
          :key="night.date"
          :night="night"
          :today="night.date === today"
          :past="night.date < today"
          @open="emit('open', night.date)"
        />

        <PlanWeekStats :nights="nights" />
      </div>

      <PlanWeekAside
        :nights="nights"
        :suggestions="asideSuggestions"
        :target="target"
        @pick="target && pick(target, $event)"
      />
    </div>
  </div>
</template>
