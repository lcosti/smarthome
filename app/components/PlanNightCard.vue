<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { dishLabel, usePlanStore, type PlannedNight } from '../stores/plan'
import { DINNER } from '../utils/meal'

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
const { night, today, past = false, header = true, frame = true, eaters = 'table', events = [] } = defineProps<{
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
   * `none` is for the wide week, where the day's table is in the gutter of the
   * row this card sits in. The roster is kept per day, so anything here would be
   * the same fact twice on one line.
   */
  eaters?: 'table' | 'away' | 'none'
  /**
   * Draw the card around the night.
   *
   * False in the wide week, where the day is already a card and the night is one
   * cell inside it: a card inside a card, a padding apart, drew two borders and
   * two insets for one dinner, and left it sitting further from its own row than
   * the breakfast beside it. Without the frame this is the dish, the empty state
   * and the diary, in the cell — which is what `PlanMealCell` is too, so all
   * three slots of a day sit in the row's grid the same way.
   *
   * The header and the footer are dropped with it. Both are already off in the
   * one place that turns this off, and a header rule with nothing above it is
   * a line across a cell.
   */
  frame?: boolean
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
 * it are `PlanDayEaters`, which the wide plan shows in the day's gutter.
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
 * How an empty night draws itself.
 *
 * Inside a frame it is a ghost: the card around it is already the box, and a
 * second one drawn inside it is a border against a border. Frameless there is no
 * box, so it draws its own — `outline` is the dashed variant in this app's
 * theme, the same one an empty breakfast beside it uses, which is the shape an
 * empty slot wants: an outline around somewhere a meal goes rather than a filled
 * cell pretending something is there.
 */
const emptyVariant = computed(() => frame ? 'ghost' as const : 'outline' as const)

/**
 * The night as somewhere a dish can be dropped.
 *
 * Every night is a target, including an empty one and a night that has gone —
 * moving Thursday's dinner onto a Tuesday that has already happened is a
 * correction of the record, and the plan is a record as much as an intention.
 * Picking a dish *up* belongs to `PlanDishCard`, which is what moves.
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

/**
 * `UCard` is a component, so the element to hit-test against is its root node.
 * Frameless, the root is already an element and this passes it through.
 */
function elementOf(instance: unknown): HTMLElement | null {
  if (!instance) return null
  const el = (instance as { $el?: unknown }).$el ?? instance
  return el instanceof HTMLElement ? el : null
}

watchEffect(() => drag.registerTarget(slot.value, elementOf(root.value)))
onBeforeUnmount(() => drag.registerTarget(slot.value, null))
</script>

<template>
  <!--
    The card is a `UCard`: day on the header, the dish in the body, the table in
    the footer, and the rules between them are the variant's own `divide-y`
    rather than borders written on by hand. Only the two colours a card can be —
    tonight, or a night that has gone — are ours.

    Frameless it is the same component with its skin off: `soft` has no ring,
    `bg-transparent` takes the fill, and the header and the footer — which are
    what the rules and the padding are for — do not render. One root either way,
    so the drop target is registered in one place and cannot go missing at one
    of the two widths.
  -->
  <UCard
    ref="root"
    :variant="frame ? 'subtle' : 'soft'"
    :ui="{
      root: frame
        ? 'flex min-h-0 flex-col transition-colors'
        : 'flex min-h-0 flex-col transition-colors bg-transparent',
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
      // Where it would land. The dish being carried fades rather than
      // disappearing — that is `PlanDishCard`'s own — so the week keeps its
      // shape while one of it is in the air.
      isOver && 'ring-2 ring-primary bg-primary/5'
    ]"
  >
    <template
      v-if="frame && header"
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

    <!--
      Frameless, the body is the cell: there is no card around it to be inset
      from, and the padding it used to spend put the dinner further from its own
      row than the breakfast beside it.
    -->
    <div
      class="flex min-h-0 flex-1 flex-col"
      :class="frame && 'p-3'"
    >
      <!--
        The dish is a card inside the card: on a night that has one, the thing
        being cooked is the object you act on — open it, take it off, carry it to
        another day — and the night around it is only the frame holding the date
        and the table. It is `PlanDishCard`, which is what a planned breakfast
        and a planned lunch are as well, so a day's three slots are one answer to
        "what does a planned meal look like" rather than three.
      -->
      <PlanDishCard
        v-if="planned"
        :planned="planned"
        :date="night.date"
        :meal="DINNER"
        :remove-label="`Take ${dishLabel(planned)} off ${dayLabel}`"
        class="min-h-0 flex-1"
        @open="$emit('open')"
        @remove="$emit('remove')"
      />

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
        :variant="emptyVariant"
        icon="i-lucide-house"
        label="Nobody home"
        class="min-h-0 flex-1 justify-center text-dimmed"
        @click="$emit('open')"
      />

      <!-- An empty night is an invitation: one way in, the whole cell as the target. -->
      <UButton
        v-else
        color="neutral"
        :variant="emptyVariant"
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
      v-if="frame && (eaters === 'table' || (eaters === 'away' && awayLabel))"
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
