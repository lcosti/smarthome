<script setup lang="ts">
import { dishLabel, type PlannedEntry } from '../stores/plan'
import { MEAL_LABELS, type Meal } from '../utils/meal'

/**
 * One slot of one day: somewhere a meal goes.
 *
 * Every slot of the wide week — breakfast, lunch and dinner — and the two rows
 * under the phone's dinner. It was breakfast and lunch only, with the wide
 * week's dinner drawn as a `PlanNightCard` with its frame, its header and its
 * footer turned off; three props asking a component not to be itself is a
 * component that is in the wrong place. A row of three slots is three of the
 * same cell.
 *
 * What the night card said in that cell and this does not: "Nothing cooked" on a
 * day that has gone, and "Nobody home" on a day nobody is eating on. Both are
 * facts about the *day*, and the row already carries them — a past day fades
 * whole, and a day the house is out for collapses to one line across the meals.
 * Drawn per cell they were the day's news in a third of the day's width, and the
 * two cells beside them said nothing of the kind.
 *
 * A slot with something in it is `PlanDishCard`, which is what the dinner beside
 * it is too. A lunch that is a recipe costs the same two things a dinner does —
 * minutes at the stove and things to buy — and it was the row drawing its three
 * slots three different ways, rather than anything about breakfast, that made a
 * day read as three unrelated widgets. So this component owns only the empty
 * state and the drop target; the dish itself has one answer, in one place.
 *
 * Empty is still a stock `UButton`: there is nothing to lay out, and an
 * invitation is a label.
 *
 * Taking a meal off used to mean opening the editor, because a one-line cell had
 * no room for a × that was not most of the cell. The dish card has the room and
 * already has the button, so a breakfast comes off the way a dinner does.
 */
const { date, meal, planned = null, tall = false } = defineProps<{
  date: string
  meal: Meal
  /** The slot's entry, or null when it is empty. */
  planned?: PlannedEntry | null
  /**
   * Fill the cell rather than sitting at its natural height.
   *
   * For the wide grid, where a day is a band of equal height and a cell floating
   * in the top of a column reads as something that failed to load. An empty cell
   * drops its label there as well — the column heading two inches above it
   * already says "Breakfast", and the cell repeating it is the same word twice.
   * That goes for the dinner too, which used to be the one cell of the three
   * that spelled itself out: a row where two slots are a plus and the third is a
   * sentence reads as the third one being the one that is asking.
   *
   * False on the phone, where these are two rows under the dinner with no
   * headings over them and no band to fill.
   */
  tall?: boolean
}>()

defineEmits<{ open: [], remove: [] }>()

/**
 * Somewhere a dish can be dropped. Every cell is a target, including an empty
 * one — which is why this lives on the cell and not on the dish inside it.
 * Picking up is `PlanDishCard`'s.
 */
const drag = usePlanDrag()
const root = useTemplateRef<HTMLElement>('root')

const slot = computed(() => drag.slotKey(date, meal))
const isOver = computed(() => drag.overSlot.value === slot.value)

/**
 * What an empty cell is called when it is not saying it out loud.
 *
 * The tall empty cell drops its label — the column heading above it already says
 * "Breakfast" — which leaves a button whose entire content is a plus sign, and
 * seven of those on a screen are indistinguishable to anything that is not
 * looking at the grid.
 */
const ariaLabel = computed(() => `Add ${MEAL_LABELS[meal].toLowerCase()}`)

watchEffect(() => drag.registerTarget(slot.value, root.value ?? null))
onBeforeUnmount(() => drag.registerTarget(slot.value, null))
</script>

<template>
  <!--
    The cell is the drop target and nothing else, so it is a plain element rather
    than a card: whichever of the two states is inside it draws its own edges,
    and a frame here would be a second border a padding's width outside the
    first.
  -->
  <div
    ref="root"
    class="flex min-h-0 flex-col transition-colors"
    :class="[
      tall && 'h-full',
      isOver && 'rounded-lg ring-2 ring-primary bg-primary/5'
    ]"
  >
    <!-- The dish, drawn the way every planned slot in the app draws one. -->
    <PlanDishCard
      v-if="planned"
      :planned="planned"
      :date="date"
      :meal="meal"
      :remove-label="`Take ${dishLabel(planned)} off ${MEAL_LABELS[meal].toLowerCase()}`"
      class="min-h-0 flex-1"
      @open="$emit('open')"
      @remove="$emit('remove')"
    />

    <!--
      Empty says which slot it is, because that is the only thing an empty cell
      knows and the column heading is not always above it — on a phone these two
      are a pair of rows under a dinner, with no table around them. In the grid,
      where there is a heading, it is a plus and a space to put something in.

      `outline` is the dashed variant in this app's theme, which is the shape an
      empty cell wants: an outline around somewhere a meal goes, rather than a
      filled box pretending something is already there.
    -->
    <UButton
      v-else
      color="neutral"
      :variant="tall ? 'outline' : 'ghost'"
      icon="i-lucide-plus"
      :label="tall ? undefined : MEAL_LABELS[meal]"
      :aria-label="ariaLabel"
      block
      class="min-h-0 flex-1 justify-center text-dimmed"
      @click="$emit('open')"
    />
  </div>
</template>
