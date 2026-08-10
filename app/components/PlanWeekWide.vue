<script setup lang="ts">
import type { PlanEvent } from '../composables/usePlanEvents'
import { usePlanStore, type PlannedNight } from '../stores/plan'
import type { RankedCandidate } from '../utils/generator'
import { DINNER, MEALS, MEAL_LABELS, type Meal } from '../utils/meal'
import { isoDate, mondayOf, weekLabel } from '../utils/week'

/**
 * The week as a screenful, for a screen with the room for it.
 *
 * Days down, meals across: breakfast, lunch, dinner and who is at the table,
 * one row each. The week used to run the other way — a row of night cards, as
 * wide as what was left of the week — and that was the right shape while a day
 * had one meal on it. It is the wrong shape for three: a day is now a thing with
 * parts, and the parts of Tuesday belong on the line that says Tuesday.
 *
 * The columns are not equal, because the meals are not. Dinner is what the week
 * is decided around and gets a full card — a picture, what it costs at the
 * stove and at the shop, who is at the table under it — while breakfast and
 * lunch are one row each, empty most weeks and saying only what they are.
 *
 * Only the days still ahead get a row. A week is read forwards: on a Friday,
 * Monday to Thursday are a record and Friday to Sunday are the decisions still
 * to make. What has been cooked collapses into a strip along the top, still
 * openable, no longer asking for anything.
 *
 * A plain grid rather than a `UTable`: a table's cells are column definitions
 * given rows of data, and every cell here is a drop target that registers
 * itself. Nothing in it is hand-rolled — the cells are `PlanNightCard` and
 * `PlanMealCell`, which are a card and a `UButton`.
 *
 * Nothing on this screen scrolls the page as a whole: the week and the aside
 * scroll separately, so pressing "fill" never moves the thing you were looking
 * at.
 *
 * Presentational. The page above owns the week, which slot is being edited and
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
  open: [date: string, meal?: Meal]
  remove: [night: PlannedNight]
  pick: [recipeId: string, meal: Meal]
  fill: []
  derive: []
  clear: []
  /** Weeks to move, and back to the week the household is living in. */
  step: [weeks: number]
  reset: []
}>()

const plan = usePlanStore()

const monday = computed(() => {
  const [year, month, day] = weekStart.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
})

/** Whether the week on screen is the one the household is living in. */
const thisWeek = computed(() => weekStart === isoDate(mondayOf(new Date())))

/** The two small columns, in the order the day happens. Dinner has a column of its own. */
const SIDE_MEALS = ['breakfast', 'lunch'] as const

/**
 * The day and its four columns, written once and used by both the headings and
 * every row, so a heading can never end up over the wrong cell.
 *
 * Dinner is the wide one because it is the only cell with a card's worth to say.
 * "Eating" is fixed rather than a fraction: it holds up to five faces and a
 * short count, which is a known width, and letting it flex would take room off
 * the meals to leave a gap beside four avatars.
 */
const COLUMNS = '6rem minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr) 9rem'

function dayOf(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

function dayLabelOf(date: string) {
  return dayOf(date).toLocaleDateString(undefined, { weekday: 'short' })
}

function dateLabelOf(date: string) {
  return dayOf(date).toLocaleDateString(undefined, { day: 'numeric' })
}

/**
 * A day nobody is home for, and nothing planned on any of its slots.
 *
 * It collapses to one line rather than three empty cells and a card. It is not a
 * gap — `fillWeek` and `hasGapsFor` have always passed over it — and three
 * invitations across a row for a day the house is away is what made a week away
 * read as a week behind. Anything planned on it takes it out of this state: a
 * dish on a day the roster says is out is somebody hosting, or a roster that is
 * wrong, and either way it is a live intention.
 */
function isAway(night: PlannedNight): boolean {
  return plan.nobodyEatingOn(night.date)
    && !night.meals.breakfast && !night.meals.lunch && !night.meals.dinner
}
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
        The days still to come, one band each, sharing the height that is left.

        Rows of equal height rather than rows as tall as what is in them: the
        week is one object read down the left-hand edge, and a Tuesday with a
        dish on it standing twice as tall as a Wednesday without one made the
        planned days look like the important ones. Equal bands also mean the
        week ends where the screen does — there is nothing below the fold to go
        looking for, which was the other half of the problem.

        `basis-0` is what makes them equal. Without it `flex-1` distributes the
        *spare* height rather than all of it, and a row holding a card starts
        taller and stays taller. The floor is what a day needs to be a
        comfortable target; it is a floor and not a height, so a very short
        window scrolls rather than crushing seven days into slivers.

        A day nobody is home for keeps its natural height instead of a share.
        There is nothing on it to make room for, and giving it an equal band
        spends a seventh of the screen saying that nothing is happening.
      -->
      <div class="flex min-h-0 flex-1 flex-col gap-2">
        <!-- The headings carry the row's own padding so they line up with the cells under them. -->
        <div
          class="grid shrink-0 gap-x-3 px-3"
          :style="{ gridTemplateColumns: COLUMNS }"
        >
          <div />
          <p
            v-for="meal in MEALS"
            :key="meal"
            class="text-xs font-medium uppercase tracking-wide text-dimmed"
          >
            {{ MEAL_LABELS[meal] }}
          </p>
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Eating
          </p>
        </div>

        <!--
          The day is the card, and the meals are cells inside it. It was the
          other way round while a day had one meal on it — the night was the
          card, and there was nothing else on the row for it to be part of.
        -->
        <UCard
          v-for="night in cards"
          :key="night.date"
          variant="subtle"
          :ui="{ root: 'flex flex-col transition-colors', body: 'min-h-0 flex-1 p-3 sm:p-3' }"
          :class="[
            isAway(night) ? 'shrink-0' : 'min-h-20 min-w-0 flex-1 basis-0',
            night.date === today && 'ring-primary/60',
            night.date < today && 'opacity-55'
          ]"
        >
          <template #default>
            <div
              class="grid h-full min-h-0 items-stretch gap-x-3"
              :style="{ gridTemplateColumns: COLUMNS }"
            >
              <!--
                The day, in the gutter. Today says so in a badge under its name
                rather than in the accent alone — the row is already ringed, and
                the word is what somebody scanning a column of seven is looking
                for.
              -->
              <div class="flex flex-col justify-center gap-1">
                <span
                  class="text-sm font-semibold"
                  :class="night.date === today ? 'text-primary' : 'text-highlighted'"
                >{{ dayLabelOf(night.date) }} {{ dateLabelOf(night.date) }}</span>
                <UBadge
                  v-if="night.date === today"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  label="Today"
                  class="self-start"
                />
              </div>

              <!--
                A day nobody is home for says so once, across the rest of the
                row, and is still pressable — you can be hosting, and the roster
                can be wrong. It opens the dinner, which is the slot anybody
                pressing it means.
              -->
              <UButton
                v-if="isAway(night)"
                color="neutral"
                variant="ghost"
                icon="i-lucide-house"
                label="Nobody home"
                class="col-span-4 justify-start text-dimmed"
                @click="emit('open', night.date, DINNER)"
              />

              <template v-else>
                <PlanMealCell
                  v-for="meal in SIDE_MEALS"
                  :key="meal"
                  :date="night.date"
                  :meal="meal"
                  :planned="night.meals[meal]"
                  tall
                  @open="emit('open', night.date, meal)"
                />

                <!--
                  The dinner is the one cell with a card's worth to say, so it
                  keeps being one. `today` is false here because the band around
                  it already carries the ring, and two of them a padding's width
                  apart is one too many.
                -->
                <PlanNightCard
                  :night="night"
                  :today="false"
                  :past="night.date < today"
                  :header="false"
                  eaters="none"
                  :events="events.get(night.date)"
                  class="min-h-0"
                  @open="emit('open', night.date, DINNER)"
                  @remove="emit('remove', night)"
                />

                <!--
                  Who is at the table, once for the day rather than once per meal
                  — the roster is kept per day, and three copies of the same four
                  faces across a row would be the same fact three times.
                -->
                <PlanDayEaters
                  :date="night.date"
                  class="self-center"
                />
              </template>
            </div>
          </template>
        </UCard>
      </div>
    </div>

    <PlanWeekAside
      :nights="nights"
      :suggestions="suggestions"
      :target="target"
      @pick="(recipeId, meal) => emit('pick', recipeId, meal)"
    />
  </div>
</template>
