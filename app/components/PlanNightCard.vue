<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { dishLabel, usePlanStore, type PlannedNight } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { DINNER } from '../utils/meal'
import { pictureOf } from '../utils/photo'
import { skipIcon } from '../utils/skip'

/**
 * One night of the week, on a screen with room to say what is actually on it.
 *
 * Three facts, in the order somebody standing in front of it wants them: what is
 * being eaten, whether it has been shopped for, and who is at the table. An empty
 * night says only that it is empty and offers the way in — what to cook is the
 * aside's question, asked once for the week rather than seven times with the same
 * answer.
 *
 * A night that has been and gone fades and stops asking. What was cooked on it
 * still opens — that is the only way back to it, and a plan is a record as much
 * as it is an intention — but an empty one is a fact now, not an invitation.
 *
 * Presentational: the week above owns which night is being edited, so the phone
 * rows and these cards cannot drift apart over what changing a night does.
 */
const { night, today, past = false, header = true, eaters = 'table', events = [] } = defineProps<{
  night: PlannedNight
  today: boolean
  /** The night is before today. */
  past?: boolean
  /**
   * Show the day and the date along the top.
   *
   * False where the page is already a day — the phone plans one night at a time
   * under a heading that names it, and the card repeating "Mon · 10 Aug" under
   * "Monday" is the same sentence twice.
   */
  header?: boolean
  /**
   * How much of who is eating the card says along the bottom.
   *
   * `table` is the whole roll-call — the faces and the portion count — for a
   * card standing on its own.
   *
   * `away` is the exception only, for the phone: the cards are a column there
   * and the same four faces on every one of them is a roll-call nobody reads,
   * so a night somebody is missing says who and a night with everybody there
   * says nothing. Everybody being home is the normal case and needs no ink.
   *
   * `none` is for the wide week, where the day's table is a column of the row
   * this card sits in. The roster is kept per day, so anything here would be the
   * same fact twice on one line.
   */
  eaters?: 'table' | 'away' | 'none'
  /**
   * What else the day is already spoken for by.
   *
   * Passed in rather than read here, like everything else on this card: the page
   * owns the week, so both shapes of the plan show a night the same way.
   */
  events?: PlanEvent[]
}>()

defineEmits<{ open: [], remove: [] }>()

const attendance = useAttendanceStore()
const recipes = useRecipesStore()
const plan = usePlanStore()

const planned = computed(() => night.entries[0] ?? null)

function partsOf(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

const dayLabel = computed(() =>
  partsOf(night.date).toLocaleDateString(undefined, { weekday: 'short' })
)

const dateLabel = computed(() =>
  partsOf(night.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
)

/**
 * Whether the night is asking for anything. The faces and the count that go with
 * it are `PlanDayEaters`, which the wide plan shows in a column of its own.
 */
const nobodyHome = computed(() => plan.nobodyEatingOn(night.date))

/** Only who is out — the shorter list, and the one worth the width. */
const awayLabel = computed(() => {
  const names = attendance.awayOn(night.date).map(person => person.name)
  if (!names.length) return null
  if (names.length === 1) return `${names[0]} away`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} away`
})

/**
 * The picture of what is being eaten — which on a leftovers night is the picture
 * of the night it came off, as the wall board already has it. Thursday's plate
 * looks like Tuesday's because it is Tuesday's.
 */
const picture = computed(() =>
  pictureOf(planned.value?.leftoverSource?.recipe ?? planned.value?.recipe)
)

/**
 * What the dish costs, in the two units a Tuesday evening is spent in: time at
 * the stove and things to buy. A leftovers night costs neither and says so.
 *
 * Icons rather than words because there are two of them on one short line and
 * the card is a quarter of a screen wide. The names are listed in nuxt.config's
 * client bundle: chosen here rather than in a template, the scanner cannot see
 * them, and an unbundled icon on a kitchen tablet with no signal is a blank.
 */
const dishMeta = computed<{ icon: string, label: string }[]>(() => {
  const entry = planned.value
  if (!entry) return []

  const out: { icon: string, label: string }[] = []
  // A skipped night says the same thing a leftovers night says — nobody is at
  // the stove — and the icon is what tells you which kind of evening it is. The
  // name above already says "Takeaway", so this line does not repeat it.
  if (entry.skipped) {
    out.push({ icon: skipIcon(entry.entry.skip_reason), label: 'no cooking' })
    return out
  }
  if (entry.leftover) {
    out.push({ icon: 'i-lucide-refrigerator', label: 'no cooking' })
  } else {
    const minutes = (entry.recipe?.prep_minutes ?? 0) + (entry.recipe?.cook_minutes ?? 0)
    if (minutes > 0) out.push({ icon: 'i-lucide-clock', label: `${minutes}m` })
  }

  const items = entry.recipe ? recipes.ingredientsFor(entry.recipe.id).length : 0
  if (items) out.push({ icon: 'i-lucide-utensils', label: `${items} items` })

  return out
})

/**
 * The night as somewhere a dish can be dropped, and as a dish that can be
 * picked up.
 *
 * Every night is a target, including an empty one and a night that has gone —
 * moving Thursday's dinner onto a Tuesday that has already happened is a
 * correction of the record, and the plan is a record as much as an intention.
 * Only a night with something on it is a source.
 */
const drag = usePlanDrag()
const root = useTemplateRef<{ $el?: HTMLElement } | HTMLElement>('root')

/**
 * This card is the dinner, always — the day's other two slots are
 * `PlanMealCell`s beside it or under it. So it registers as the dinner cell and
 * has no `meal` prop: giving it one would invite somebody to render a breakfast
 * through a card built to be the night.
 */
const slot = computed(() => drag.slotKey(night.date, DINNER))

const isOver = computed(() => drag.overSlot.value === slot.value)

// The entry rather than the date: a day has three slots now, and a lunch in the
// air must not fade the dinner underneath it.
const isSource = computed(() =>
  drag.payload.value?.kind === 'night' && drag.payload.value.entryId === planned.value?.entry.id
)

/** `UCard` is a component, so the element to hit-test against is its root node. */
function elementOf(instance: unknown): HTMLElement | null {
  if (!instance) return null
  const el = (instance as { $el?: unknown }).$el ?? instance
  return el instanceof HTMLElement ? el : null
}

watchEffect(() => drag.registerTarget(slot.value, elementOf(root.value)))
onBeforeUnmount(() => drag.registerTarget(slot.value, null))

function pickUp(event: PointerEvent) {
  if (!planned.value) return
  drag.press(event, {
    kind: 'night',
    entryId: planned.value.entry.id,
    date: night.date,
    meal: DINNER,
    label: dishLabel(planned.value),
    image: picture.value
  })
}
</script>

<template>
  <!--
    The card is a `UCard`: day on the header, the dish in the body, the table in
    the footer, and the rules between them are the variant's own `divide-y`
    rather than borders written on by hand. Only the two colours a card can be —
    tonight, or a night that has gone — are ours.
  -->
  <UCard
    ref="root"
    variant="subtle"
    :ui="{
      root: 'flex min-h-0 flex-col transition-colors',
      header: 'flex shrink-0 items-center justify-between gap-2 px-3 py-2.5 sm:px-3',
      body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0',
      footer: 'flex shrink-0 items-center gap-2 px-3 py-2 sm:px-3'
    }"
    :class="[
      today ? 'ring-primary/60' : '',
      // The same fade for a night that has gone and a night nobody is in for,
      // because they are the same statement: this one wants nothing from you.
      // Only while it is empty, though — a dish planned onto a night the roster
      // says is out is somebody hosting, or a roster that is wrong, and either
      // way it is a live intention rather than something to fade.
      (past || (nobodyHome && !planned)) && 'opacity-55',
      // Where it would land, and where it came from. The night being dragged
      // fades rather than disappearing, so the week keeps its shape while one
      // of it is in the air.
      isOver && 'ring-2 ring-primary bg-primary/5',
      isSource && 'opacity-40'
    ]"
  >
    <template
      v-if="header"
      #header
    >
      <div class="flex items-center gap-2">
        <span
          class="text-sm font-semibold"
          :class="today ? 'text-highlighted' : 'text-muted'"
        >{{ dayLabel }}</span>
        <UBadge
          v-if="today"
          color="primary"
          variant="subtle"
          size="sm"
          label="Today"
        />
      </div>
      <span class="text-xs text-dimmed tabular-nums">{{ dateLabel }}</span>
    </template>

    <div class="flex min-h-0 flex-1 flex-col p-3">
      <!--
        The dish is a card inside the card: on a night that has one, the thing
        being cooked is the object you act on — open it, or take it off — and the
        night around it is only the frame holding the date and the table.
      -->
      <!--
        And the thing you pick up. A dish is what moves between nights — the day
        and the table around it belong to the night and stay where they are — so
        the press that starts a drag starts here. A mouse picks it up on the
        first few pixels of travel; a finger holds it for a moment first, so that
        scrolling a column of these still scrolls.
      -->
      <UCard
        v-if="planned"
        variant="soft"
        :ui="{ root: 'relative min-h-0 flex-1 touch-manipulation select-none', body: 'h-full p-3 sm:p-3' }"
        :class="isSource ? 'cursor-grabbing' : 'cursor-grab'"
        @pointerdown="pickUp"
      >
        <!--
          A raw button, per the card-and-row exception in CLAUDE.md: this is a
          stacked block — dish, meta, badge — not a label, and a `UButton` lays
          its content out as a flex row through slots it would take four
          overrides to undo. It fills the inner card so the whole dish is the
          target, and keeps its right edge clear of the remove button — which is
          a sibling rather than a child, because a button inside a button is not
          a thing a browser will render.
        -->
        <button
          type="button"
          class="flex h-full w-full items-start gap-3 pr-7 text-left transition-opacity duration-[80ms] active:opacity-85"
          @click="$emit('open')"
        >
          <RecipeThumb
            :src="picture"
            :alt="dishLabel(planned)"
          />

          <!--
            `min-w-0` is what lets the name wrap beside the picture: a flex child
            defaults to its content's width, and a long dish name would push the
            card wider than its column rather than running onto a second line.
          -->
          <span class="flex min-w-0 flex-1 flex-col items-start">
            <span class="line-clamp-3 text-pretty text-[15px] font-medium leading-tight tracking-[-0.01em] text-highlighted">
              {{ dishLabel(planned) }}
            </span>

            <span class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dimmed">
              <span
                v-for="fact in dishMeta"
                :key="fact.label"
                class="flex items-center gap-1"
              >
                <UIcon
                  :name="fact.icon"
                  class="size-3.5 shrink-0"
                />
                {{ fact.label }}
              </span>

              <!--
                Shopped-for is the third fact about the night, and sits on the
                line with the other two rather than under them — a card is a
                fixed height with a picture in it now, and a block of its own
                was the line that fell off the bottom.
              -->
              <UBadge
                v-if="planned.derived"
                color="primary"
                variant="soft"
                size="sm"
                icon="i-lucide-check"
                label="On list"
              />
            </span>
          </span>
        </button>

        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          data-no-drag
          :aria-label="`Take ${dishLabel(planned)} off ${dayLabel}`"
          class="absolute right-1.5 top-1.5"
          @click="$emit('remove')"
        />
      </UCard>

      <!-- An empty night that has gone is a fact, and states it rather than asking. -->
      <UEmpty
        v-else-if="past"
        variant="naked"
        size="xs"
        title="Nothing cooked"
        :ui="{ root: 'min-h-0 flex-1 p-0 sm:p-0', title: 'text-dimmed font-normal' }"
      />

      <!--
        A night nobody is eating on states that instead of asking for a dinner.
        It is not a gap — `fillWeek` and `hasGapsFor` have always passed over it
        — and an invitation at full strength on five of seven cells is what made
        a week away read as a week behind.

        Still a button, and still the whole cell: you can be hosting, and the
        roster can be wrong. It only stops being the first thing the card asks
        for.
      -->
      <UButton
        v-else-if="nobodyHome"
        color="neutral"
        variant="ghost"
        icon="i-lucide-house"
        label="Nobody home"
        class="min-h-0 flex-1 justify-center text-dimmed"
        @click="$emit('open')"
      />

      <!-- An empty night is an invitation: one way in, the whole cell as the target. -->
      <UButton
        v-else
        color="neutral"
        variant="ghost"
        icon="i-lucide-plus"
        label="Add dinner"
        class="min-h-0 flex-1 justify-center text-dimmed"
        @click="$emit('open')"
      />

      <!--
        What the evening is already spoken for by, under the dinner rather than
        beside it: the calendar is the reason a night gets moved, and reading it
        here is what stops the plan and the diary being two screens checked
        against each other. Each one carries its owner's colour on the same
        little rail the board's week strip uses — the answer to "whose is this"
        should look the same wherever it is asked.
      -->
      <PlanEventRail
        v-if="events.length"
        :events="events"
        class="mt-2"
      />
    </div>

    <template
      v-if="eaters === 'table' || (eaters === 'away' && awayLabel)"
      #footer
    >
      <!-- One answer to "who is at the table", shared with the wide plan's own column. -->
      <PlanDayEaters
        v-if="eaters === 'table'"
        :date="night.date"
      />

      <span
        v-else
        class="truncate text-xs text-dimmed"
      >{{ awayLabel }}</span>
    </template>
  </UCard>
</template>
