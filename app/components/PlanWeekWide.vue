<script setup lang="ts">
import type { PlanEvent } from '../composables/usePlanEvents'
import { usePlanStore, type PlannedNight } from '../stores/plan'
import type { RankedCandidate } from '../utils/generator'
import { DINNER, MEALS, MEAL_LABELS, type Meal } from '../utils/meal'
import { isoDate, mondayOf, weekLabel } from '../utils/week'

/**
 * The week as a screenful, for a screen with the room for it.
 *
 * Days down, meals across: breakfast, lunch and dinner, one row each, with the
 * date, who is at the table and what else the day already holds in the gutter.
 * The week used to run the other way — a row of night cards, as
 * wide as what was left of the week — and that was the right shape while a day
 * had one meal on it. It is the wrong shape for three: a day is now a thing with
 * parts, and the parts of Tuesday belong on the line that says Tuesday.
 *
 * Every planned slot is drawn the same way — `PlanDishCard`, a picture and a
 * name and what it costs at the stove and at the shop — because a lunch that is
 * a recipe costs those same things. The columns are still not equal: dinner is
 * what the week is decided around and is the one most likely to have a long name
 * and a full line of facts, so it gets the width, while breakfast and lunch are
 * empty most weeks and want only enough room to be pressed.
 *
 * Nothing inside a day draws a frame of its own. The day is the card; the three
 * slots sit in its grid. The dinner used to be a card inside that card, which
 * cost a second border and a second inset and left it further from its own row
 * than the breakfast beside it.
 *
 * Only the days still ahead get a row. A week is read forwards: on a Friday,
 * Monday to Thursday are a record and Friday to Sunday are the decisions still
 * to make. What has been cooked collapses into a strip along the top, still
 * openable, no longer asking for anything.
 *
 * A plain grid rather than a `UTable`: a table's cells are column definitions
 * given rows of data, and every cell here is a drop target that registers
 * itself. All three cells are the same `PlanMealCell`, and what they draw is a
 * `UButton` or the one hand-rolled block in the plan — `PlanDishCard`. The
 * dinner used to be a `PlanNightCard` with its frame, its header and its footer
 * switched off, which is three props' worth of asking a component not to be
 * itself; what was left that it did differently was the diary, which is the
 * day's rather than the dinner's and is in the gutter now.
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
  /** Take the dish off one slot. Every slot can be emptied from its own card. */
  remove: [night: PlannedNight, meal: Meal]
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

/**
 * The day and its three meals, written once and used by both the headings and
 * every row, so a heading can never end up over the wrong cell.
 *
 * Dinner is the wide one because it is the only cell with a card's worth to say.
 *
 * Who is eating had a fixed `9rem` column of its own out on the right, and does
 * not any more: it is a line of small faces and two words, and it was the widest
 * fixed cost on a row whose meals were sharing what was left — a pixel spent
 * there is a pixel off a dish name that is already truncating. It rides in the
 * gutter under the date now, and the diary rides under that. The gutter is
 * `10rem` for the diary's sake: the roll-call is faces and two words and would
 * take less, but an event is a sentence somebody wrote, and at `8rem` "Sue has
 * the girls" arrived as "Sue has th…", which is a line of text that costs its
 * space and answers nothing.
 */
const COLUMNS = '10rem minmax(0,1fr) minmax(0,1fr) minmax(0,1.5fr)'

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
        </div>

        <!--
          The day is the card, and the meals are cells inside it. It was the
          other way round while a day had one meal on it — the night was the
          card, and there was nothing else on the row for it to be part of.
        -->
        <!--
          `data-plan-day` is a handle for the acceptance scripts, as
          `data-shopping-aisle` is on the list. The week is days down and meals
          across, and both of those are runtime grid templates rather than
          classes anything can look for.
        -->
        <UCard
          v-for="night in cards"
          :key="night.date"
          :data-plan-day="night.date"
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
                The day, in the gutter, and who is at it. Today says so in a
                badge beside its name rather than in the accent alone — the row
                is already ringed, and the word is what somebody scanning a
                column of seven is looking for.

                The roll-call sits here rather than in a column of its own,
                stacked to the gutter's width. It is once for the day rather than
                once per meal — the roster is kept per day, and three copies of
                the same four faces across a row would be the same fact three
                times. A day nobody is home for says so across the row instead,
                so it is not repeated here.

                The diary is under it for the same reason it is not under the
                dinner any more: "Sue has the girls" is a fact about Tuesday, not
                about what is being cooked on Tuesday, and the gutter is where
                this row keeps what it knows about the day itself. Hanging off
                the dinner it also made one of three slots taller than the other
                two, which is the shape the row had before all three became the
                same cell.
              -->
              <div class="flex min-w-0 flex-col justify-center gap-1">
                <!--
                  The date and the badge on one line, as `PlanNightCard`'s own
                  header has them. Under it, the badge was a third line in a
                  gutter with three lines' room, and today — the row anybody is
                  most likely to be reading — was the one row whose roll-call
                  fell off the bottom.
                -->
                <div class="flex min-w-0 items-center gap-1.5">
                  <span
                    class="truncate text-sm font-semibold"
                    :class="night.date === today ? 'text-primary' : 'text-highlighted'"
                  >{{ dayLabelOf(night.date) }} {{ dateLabelOf(night.date) }}</span>
                  <UBadge
                    v-if="night.date === today"
                    color="primary"
                    variant="subtle"
                    size="sm"
                    label="Today"
                    class="shrink-0"
                  />
                </div>
                <PlanDayEaters
                  v-if="!isAway(night)"
                  :date="night.date"
                />

                <!--
                  Still shown on a day the house is out for, where the roll-call
                  is not: a day nobody is home is exactly the day the diary is
                  the explanation for.

                  One event and a count, where a card that stands alone shows
                  two. This is a line in a gutter on a row that is a seventh of
                  the screen, and the gutter has three lines to give: the day,
                  who is at it, and what else it holds.
                -->
                <PlanEventRail
                  v-if="events.get(night.date)?.length"
                  :events="events.get(night.date)!"
                  :max="1"
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
                class="col-span-3 justify-start text-dimmed"
                @click="emit('open', night.date, DINNER)"
              />

              <!--
                Three slots, one kind of cell, drawn off the same list the
                headings are drawn from — so a heading cannot end up over the
                wrong cell, and the dinner cannot grow a behaviour the breakfast
                beside it has not got.

                What the dinner cell used to say on its own is said by the row
                now, or not at all. A day that has gone fades as a row; a day
                nobody is home for collapses to the line above. Both were states
                a night card drew inside one of three cells, which is the day's
                news in a third of the day's width.
              -->
              <template v-else>
                <PlanMealCell
                  v-for="meal in MEALS"
                  :key="meal"
                  :date="night.date"
                  :meal="meal"
                  :planned="night.meals[meal]"
                  tall
                  @open="emit('open', night.date, meal)"
                  @remove="emit('remove', night, meal)"
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
