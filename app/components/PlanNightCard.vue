<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { dishLabel, type PlannedNight } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { deriveLifeStage } from '../utils/people'
import { initialOf } from '../utils/person-colors'
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
const { night, today, past = false, table = true, events = [] } = defineProps<{
  night: PlannedNight
  today: boolean
  /** The night is before today. */
  past?: boolean
  /**
   * Show the whole table — the faces and the portion count — along the bottom.
   *
   * False on a phone, where the cards are a column and the same four faces on
   * every one of them is a roll-call nobody reads. What survives is the
   * exception: a night somebody is missing says who, and a night with everybody
   * there says nothing. Everybody being home is the normal case and needs no
   * ink.
   */
  table?: boolean
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
 * Only who is eating. A night is a list of the people at the table, not a
 * register of the household with some of it crossed out — the count beside the
 * faces is what says how many are missing, and it says it in one number.
 */
const faces = computed(() =>
  attendance.presentOn(night.date).map(person => ({
    id: person.id,
    name: person.name,
    initial: initialOf(person.name),
    avatar: person.avatar
  }))
)

/**
 * How many portions the night is for.
 *
 * A pre-weaning baby is at the table and eating nothing off it, exactly as the
 * generator counts it — otherwise the card promises a portion nobody plates.
 */
const eating = computed(() =>
  attendance.presentOn(night.date)
    .filter(person => deriveLifeStage(person.date_of_birth, night.date) !== 'baby')
    .length
)

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
/**
 * At most two, and a count for the rest.
 *
 * A card is a quarter of a screen and the dinner is what it is for. Two lines is
 * enough to know the evening is spoken for; the day itself is where you go to
 * read the whole of it.
 */
const MAX_EVENTS = 2

const shownEvents = computed(() => events.slice(0, MAX_EVENTS))
const moreEvents = computed(() => Math.max(0, events.length - MAX_EVENTS))

/** Whoever's event it is, in their colour. Neutral for the household's own. */
function railStyle(hue: number | null) {
  return hue === null ? undefined : { background: `oklch(0.72 0.13 ${hue})` }
}

const drag = usePlanDrag()
const root = useTemplateRef<{ $el?: HTMLElement } | HTMLElement>('root')

const isOver = computed(() => drag.overDate.value === night.date)
const isSource = computed(() =>
  drag.payload.value?.kind === 'night' && drag.payload.value.date === night.date
)

/** `UCard` is a component, so the element to hit-test against is its root node. */
function elementOf(instance: unknown): HTMLElement | null {
  if (!instance) return null
  const el = (instance as { $el?: unknown }).$el ?? instance
  return el instanceof HTMLElement ? el : null
}

watchEffect(() => drag.registerTarget(night.date, elementOf(root.value)))
onBeforeUnmount(() => drag.registerTarget(night.date, null))

function pickUp(event: PointerEvent) {
  if (!planned.value) return
  drag.press(event, {
    kind: 'night',
    entryId: planned.value.entry.id,
    date: night.date,
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
      past && 'opacity-55',
      // Where it would land, and where it came from. The night being dragged
      // fades rather than disappearing, so the week keeps its shape while one
      // of it is in the air.
      isOver && 'ring-2 ring-primary bg-primary/5',
      isSource && 'opacity-40'
    ]"
  >
    <template #header>
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
      <div
        v-if="shownEvents.length"
        class="mt-2 flex min-w-0 flex-col gap-1"
      >
        <span
          v-for="event in shownEvents"
          :key="event.id"
          class="flex min-w-0 items-center gap-1.5"
        >
          <span
            class="h-3 w-0.5 shrink-0 rounded-sm bg-accented"
            :style="railStyle(event.hue)"
          />
          <span
            v-if="event.time"
            class="shrink-0 font-mono text-[11px] text-dimmed tabular-nums"
          >{{ event.time }}</span>
          <span class="truncate text-[11px] text-dimmed">{{ event.title }}</span>
        </span>

        <span
          v-if="moreEvents"
          class="pl-2 text-[11px] text-dimmed"
        >+{{ moreEvents }} more</span>
      </div>
    </div>

    <template
      v-if="table || awayLabel"
      #footer
    >
      <template v-if="table">
        <UAvatarGroup
          :max="5"
          size="xs"
        >
          <UAvatar
            v-for="face in faces"
            :key="face.id"
            :src="face.avatar ?? undefined"
            :alt="face.name"
            :text="face.initial"
          />
        </UAvatarGroup>
        <span class="truncate text-xs text-dimmed">{{ eating }} eating</span>
      </template>

      <span
        v-else
        class="truncate text-xs text-dimmed"
      >{{ awayLabel }}</span>
    </template>
  </UCard>
</template>
