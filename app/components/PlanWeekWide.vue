<script setup lang="ts">
import type { PlanEvent } from '../composables/usePlanEvents'
import type { PlannedNight } from '../stores/plan'
import type { RankedCandidate } from '../utils/generator'
import { isoDate, mondayOf, weekLabel } from '../utils/week'

/**
 * The week as a screenful, for a screen with the room for it.
 *
 * Seven thin columns answered exactly one question — what is on Thursday — and
 * made everything else somebody else's job. Cards give each night the height to
 * carry what it is, whether it has been shopped for, and who is at the table.
 *
 * Only the nights still ahead get one. A week is read forwards: on a Friday,
 * Monday to Thursday are a record and Friday to Sunday are the decisions still
 * to make, and giving four settled nights half the screen pushed the three that
 * are still questions down into a corner. What has been cooked collapses into a
 * strip along the top, still openable, no longer asking for anything.
 *
 * Nothing on this screen scrolls the page as a whole: the week and the aside
 * scroll separately, so pressing "fill" never moves the thing you were looking
 * at.
 *
 * Presentational. The page above owns the week, which night is being edited and
 * what the buttons do, and hands the same facts to the phone — so neither shape
 * can grow an opinion the other does not have.
 */
const { cards, weekStart, events, canFill, canDerive, canClear, filling, deriving } = defineProps<{
  /** The whole week, for the aside's numbers and its roster. */
  nights: PlannedNight[]
  /** The nights that have gone, and the ones still to come. */
  strip: PlannedNight[]
  cards: PlannedNight[]
  today: string
  weekStart: string
  suggestions: RankedCandidate[]
  target: string | null
  /** The week's diary, by date. Empty when no calendar is connected. */
  events: Map<string, PlanEvent[]>
  canFill: boolean
  canDerive: boolean
  canClear: boolean
  deriveLabel: string
  filling: boolean
  deriving: boolean
}>()

const emit = defineEmits<{
  open: [date: string]
  remove: [night: PlannedNight]
  pick: [recipeId: string]
  fill: []
  derive: []
  clear: []
  /** Weeks to move, and back to the week the household is living in. */
  step: [weeks: number]
  reset: []
}>()

const monday = computed(() => {
  const [year, month, day] = weekStart.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
})

/** Whether the week on screen is the one the household is living in. */
const thisWeek = computed(() => weekStart === isoDate(mondayOf(new Date())))

/**
 * Four across at most, and fewer when there are fewer nights left.
 *
 * A fixed four-column grid on a Saturday left two cards huddled in the top-left
 * with half the screen beside them empty. The cards are the width of what is
 * left of the week.
 */
const columns = computed(() => Math.min(Math.max(cards.length, 1), 4))
</script>

<template>
  <!--
    A screenful, not a page. h-full rather than a viewport calculation: the shell
    is already one viewport tall and has taken the app header off the top. Two
    columns to the floor, the week on the left and the aside on the right, each
    scrolling on its own.
  -->
  <div class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_21rem] overflow-hidden">
    <div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4">
      <div class="flex shrink-0 items-center gap-4">
        <h2 class="text-2xl font-semibold tracking-[-0.025em] text-highlighted">
          Plan
        </h2>

        <!--
          Back a week, which week, forward a week: three controls acting on one
          value, which is what `UFieldGroup` is for. The pill it used to be drawn
          as was a field group with the joins missing.
        -->
        <UFieldGroup size="sm">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="outline"
            aria-label="Previous week"
            @click="emit('step', -1)"
          />
          <UButton
            color="neutral"
            variant="outline"
            class="min-w-[9rem] justify-center"
            :aria-label="thisWeek ? undefined : 'Back to this week'"
            @click="emit('reset')"
          >
            {{ weekLabel(monday) }}
            <span
              v-if="!thisWeek"
              class="text-dimmed"
            >· this week</span>
          </UButton>
          <UButton
            icon="i-lucide-chevron-right"
            color="neutral"
            variant="outline"
            aria-label="Next week"
            @click="emit('step', 1)"
          />
        </UFieldGroup>

        <!--
          Suggest, adjust what you don't fancy, then shop: the order of the
          week, and then the kebab for what you do to a week rather than with
          it.
        -->
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
          <PlanWeekMenu
            size="lg"
            :can-clear="canClear"
            @clear="emit('clear')"
          />
        </div>
      </div>

      <PlanEarlierStrip
        v-if="strip.length"
        :nights="strip"
        class="shrink-0"
        @open="emit('open', $event)"
      />

      <USeparator v-if="strip.length" />

      <!--
        The nights still to come, as wide as what is left of the week. Fixed rows
        rather than stretched ones: a card is as tall as it needs to be to hold a
        dish, and a Sunday on its own should not be a card the height of the
        screen.

        Rows as tall as what is in them, with a floor rather than a fixed height.
        A fixed one has to be tall enough for the worst night of the week — a
        long name, a picture, a cost line that has wrapped — which left every
        ordinary night a short line of text in a tall empty box. The floor is
        what an empty night needs to be a comfortable target for "Add dinner".
      -->
      <div
        class="grid shrink-0 auto-rows-[minmax(9rem,auto)] gap-3"
        :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
      >
        <PlanNightCard
          v-for="night in cards"
          :key="night.date"
          :night="night"
          :today="night.date === today"
          :past="night.date < today"
          :events="events.get(night.date)"
          @open="emit('open', night.date)"
          @remove="emit('remove', night)"
        />
      </div>
    </div>

    <PlanWeekAside
      :nights="nights"
      :suggestions="suggestions"
      :target="target"
      @pick="emit('pick', $event)"
    />
  </div>
</template>
