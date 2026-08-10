<script setup lang="ts">
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { useSyncStore } from '../stores/sync'
import { useToday } from '../composables/useToday'
import { DINNER, type Meal } from '../utils/meal'
import { duration } from '../utils/plan-stats'
import { addDays, isoDate, mondayOf, weekLabel } from '../utils/week'

const plan = usePlanStore()
const recipes = useRecipesStore()
const sync = useSyncStore()
const toast = useToast()

// The two shapes are a week at a glance and a night at a time. A wide screen has
// room to lay seven nights out and decide them in any order; a phone does not,
// so it walks them — one night on screen, the week as a strip above it, and a
// button that goes to the next one still open. Everything else — which week is
// on screen, what is in it, filling it, the night editor — is the same either
// way and stays here, so neither shape can grow an opinion the other has not.
const isWide = useWide()

// Week offset rather than a route param: deep-linking a week is not a real use
// case, and back should leave the page rather than walk backwards through weeks.
const weekOffset = ref(0)

/**
 * The slot the editor is open on — a day and one of its three meals.
 *
 * A slot rather than a date, where `selected` below stays a date: the editor is
 * opened by tapping a particular cell, and the walk is still a walk through
 * nights.
 */
const editingSlot = ref<{ date: string, meal: Meal } | null>(null)
const editorOpen = ref(false)
const deriving = ref(false)
const filling = ref(false)
const clearing = ref(false)

/**
 * Which of the phone's two screens is up: the night being planned, or the week's
 * shopping being read over.
 *
 * Component state and not a route, for the same reason the week is: the review
 * is the last step of one task, and Android back landing you on Thursday rather
 * than leaving the page would be a surprise. The tab bar is still there, so
 * there is always a way out that is not backwards.
 */
const step = ref<'nights' | 'review'>('nights')

/** Null until somebody picks a night, which is what lets the default follow the week. */
const chosenDate = ref<string | null>(null)

const monday = computed(() => addDays(mondayOf(new Date()), weekOffset.value * 7))
const weekStart = computed(() => isoDate(monday.value))
const today = useToday()

const {
  nights, strip, cards, noOneEating, target, suggestions, suggestionsFor, stats, toBuy,
  nextUnplanned, canDerive, deriveLabel, removeNight, canClear, clearWeek
} = usePlanWeek(weekStart, today)

/**
 * The week's diary, by date. Empty on a household with no calendar connected,
 * which is the only thing that decides whether a night mentions one.
 */
const events = usePlanEvents(computed(() => nights.value.map(night => night.date)))

const canFill = computed(() => plan.hasGapsFor(weekStart.value) && recipes.recipes.length > 0)

/**
 * The night on screen: whichever was pressed, else the first one still open, else
 * today.
 *
 * The fallback is a computed rather than an assignment so that stepping to
 * another week cannot leave a date from the last one selected — one fewer
 * watcher that can be forgotten.
 */
const selected = computed(() => {
  const dates = nights.value.map(night => night.date)
  if (chosenDate.value && dates.includes(chosenDate.value)) return chosenDate.value
  return target.value ?? (dates.includes(today.value) ? today.value : dates[0]!)
})

/**
 * Pin the fallback the moment it resolves.
 *
 * Without this the night on screen slides out from under the press that decided
 * it: the default is "the first night still open", so choosing Monday's dinner
 * makes Tuesday the default and the page jumps there before the card has
 * finished becoming a dinner. Moving on is the button's job, and it happens
 * once the change has been seen.
 */
watch(selected, (value) => {
  chosenDate.value = value
}, { immediate: true })

const selectedNight = computed<PlannedNight | null>(() =>
  nights.value.find(night => night.date === selected.value) ?? null
)

/** A shortlist is for a night with nothing on it. A night with a dinner is decided. */
const nightSuggestions = computed(() =>
  selectedNight.value?.entries.length ? [] : suggestionsFor(selected.value)
)

/**
 * Where the button goes next.
 *
 * Null when there is nowhere left — including when the only night still open is
 * the one already on screen, which is not somewhere to go. That is what turns
 * the button into the way out of the flow.
 */
const nextDate = computed(() => {
  const next = nextUnplanned(selected.value)
  return next && next !== selected.value ? next : null
})

const nextLabel = computed(() => {
  if (!nextDate.value) return 'Review week'
  const [year, month, day] = nextDate.value.split('-').map(Number)
  const day3 = new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'short' })
  return `Next: ${day3}`
})

/** Which night a shortlist plans onto: the one being looked at, or the week's first gap. */
const pickTarget = computed(() => (isWide.value ? target.value : selected.value))

/**
 * The week in four short facts, for the chip row under the title.
 *
 * The questions a week raises that no single night can answer: is it finished,
 * how much cooking did I just sign up for, what does it cost at the shop, and
 * how much is left to decide. The same four the wide screen's aside carries, in
 * the space a phone has for them.
 *
 * A fact with nothing to say is dropped rather than shown as a zero — "0 empty"
 * on a finished week is a chip whose whole content is that it does not apply,
 * and a fresh week should read as one thing to do rather than four.
 */
const weekFacts = computed(() => {
  const { plannedCount, total, totalMinutes, emptyCount } = stats.value
  return [
    { label: `${plannedCount} of ${total} planned`, lead: true },
    totalMinutes > 0 ? { label: `${duration(totalMinutes)} stove`, lead: false } : null,
    toBuy.value > 0 ? { label: `${toBuy.value} items`, lead: false } : null,
    emptyCount > 0 ? { label: `${emptyCount} empty`, lead: false } : null
  ].filter(fact => fact !== null)
})

// A week the user steps away from is a week they are no longer reviewing, and a
// night selected in it does not exist in the next one.
watch(weekStart, () => {
  step.value = 'nights'
  chosenDate.value = null
})

async function fill() {
  if (filling.value) return
  filling.value = true
  try {
    const { filled, skipped } = await plan.fillWeek(weekStart.value)
    if (!filled) {
      toast.add({
        title: 'Nothing to suggest',
        description: 'Every recipe is either already on this week or ruled out by an allergy.',
        icon: 'i-lucide-info',
        color: 'neutral'
      })
      return
    }
    toast.add({
      title: `${filled} night${filled === 1 ? '' : 's'} planned`,
      description: skipped
        ? `${skipped} night${skipped === 1 ? '' : 's'} had nothing left to suggest.`
        : 'Change any of them, then add it to the list.',
      icon: 'i-lucide-wand-sparkles',
      color: 'success'
    })
  } finally {
    filling.value = false
  }
}

async function clear() {
  if (clearing.value) return
  clearing.value = true
  try {
    const wasDerived = canDerive.value
    const cleared = await clearWeek()
    if (!cleared) return
    toast.add({
      title: `${cleared} night${cleared === 1 ? '' : 's'} cleared`,
      // The ingredients do not come off by themselves, and this is the moment
      // somebody would otherwise go shopping for a week nobody is cooking.
      description: wasDerived
        ? 'Add the week to the list again to take their ingredients off it.'
        : undefined,
      icon: 'i-lucide-trash-2',
      color: 'neutral'
    })
  } finally {
    clearing.value = false
  }
}

function openSlot(date: string, meal: Meal = DINNER) {
  editingSlot.value = { date, meal }
  editorOpen.value = true
}

/**
 * How long the night stays on screen after it is decided.
 *
 * Long enough to see the empty card become a dinner — moving on the instant the
 * button is released reads as the press having gone somewhere else.
 */
const SETTLE_MS = 400

function advance() {
  if (nextDate.value) chosenDate.value = nextDate.value
  else step.value = 'review'
}

/**
 * Planning a night, taking one off and skipping one all say so on the card.
 *
 * No toast on any of the three. The empty card becomes a dinner, the day's dot
 * fills, and the count along the bottom moves — a notification repeating that
 * back is the app narrating a press you just made and watched land. Toasts are
 * kept for the things you cannot see happen: filling a week, clearing one, and
 * putting it on the list.
 */
async function pick(recipeId: string, meal: Meal = DINNER) {
  const date = pickTarget.value
  if (!date) return
  const row = await plan.setNight(date, recipeId, meal)
  if (!row) return
  // Only a dinner moves the walk on. The footer names the next unplanned night,
  // so advancing after somebody planned a lunch would answer a question they
  // had not asked.
  if (!isWide.value && meal === DINNER) setTimeout(advance, SETTLE_MS)
}

async function skip(reason: string) {
  await plan.skipNight(selected.value, reason)
  setTimeout(advance, SETTLE_MS)
}

/**
 * Take the dish off one slot. Any of the three — every planned meal is drawn as
 * `PlanDishCard` now, and every one of those carries the ×.
 */
async function remove(night: PlannedNight, meal: Meal = DINNER) {
  await removeNight(night, meal)
}

async function derive() {
  if (deriving.value) return
  deriving.value = true
  try {
    const { added, updated, removed } = await plan.deriveWeek(weekStart.value)
    if (added === 0 && updated === 0 && removed === 0) {
      toast.add({ title: 'Already on the list', icon: 'i-lucide-check', color: 'neutral' })
      return
    }
    const parts = [
      added && `${added} item${added === 1 ? '' : 's'} added`,
      updated && `${updated} updated`,
      removed && `${removed} removed`
    ].filter(Boolean)
    toast.add({ title: parts.join(', '), icon: 'i-lucide-shopping-cart', color: 'success' })
  } finally {
    deriving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- The wide shape is a screenful of its own and owns its margins. -->
    <PlanWeekWide
      v-if="isWide && sync.hydrated"
      :nights="nights"
      :strip="strip"
      :cards="cards"
      :today="today"
      :week-start="weekStart"
      :suggestions="suggestions"
      :target="target"
      :events="events"
      :can-fill="canFill"
      :can-derive="canDerive"
      :can-clear="canClear"
      :derive-label="deriveLabel"
      :filling="filling"
      :deriving="deriving"
      @open="openSlot"
      @remove="remove"
      @pick="pick"
      @fill="fill"
      @derive="derive"
      @clear="clear"
      @step="weekOffset += $event"
      @reset="weekOffset = 0"
    />

    <LoadingState v-else-if="isWide" />

    <!--
      The last step of the phone's flow, and a screen of its own: it is about the
      whole week rather than any night in it, so it replaces the day header and
      the strip rather than appearing under them.
    -->
    <PlanReview
      v-else-if="step === 'review' && sync.hydrated"
      :nights="nights"
      :week-start="weekStart"
      :week-label="weekLabel(monday)"
      @back="step = 'nights'"
    />

    <template v-else>
      <AppPageHeader content-class="max-w-xl">
        <!--
          No plan-freshness badge here any more. It stood in for "is this still
          the plan", and the strip of dots and the bar along the bottom answer
          that about the week you are actually looking at — which is better than
          a relative time, and leaves the bar room for the week itself.
        -->
        <template #title>
          <h1 class="min-w-0 flex-1 text-lg font-semibold">
            Plan
          </h1>
        </template>

        <template #actions>
          <!--
            Which week, up here with the page's own title, because it is the
            frame everything below is inside. The label goes back to this week.
          -->
          <UFieldGroup class="shrink-0">
            <UButton
              icon="i-lucide-chevron-left"
              color="neutral"
              variant="outline"
              size="sm"
              aria-label="Previous week"
              @click="weekOffset--"
            />
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              class="tabular-nums"
              :aria-label="weekOffset === 0 ? undefined : 'Back to this week'"
              @click="weekOffset = 0"
            >
              {{ weekLabel(monday) }}
            </UButton>
            <UButton
              icon="i-lucide-chevron-right"
              color="neutral"
              variant="outline"
              size="sm"
              aria-label="Next week"
              @click="weekOffset++"
            />
          </UFieldGroup>

          <!--
            Filling and clearing both live in here on a phone. The bar already
            holds a title, a week and the way to Settings; a fourth control would
            leave none of them room, and neither is the thing this page is open
            to do.
          -->
          <PlanWeekMenu
            :can-clear="canClear"
            :can-fill="canFill"
            show-fill
            @clear="clear"
            @fill="fill"
          />
        </template>

        <!--
          The week in a line, under its own title.

          This is where the day heading used to be, and the week is the better
          use of it: which night is on screen is already the lit pill in the
          strip, whereas how far through the week you are, what it costs in
          stove time and what it costs at the shop are facts no single night can
          tell you. Each one is dropped when it has nothing to say, so a fresh
          week is one chip rather than four saying zero.
        -->
        <div
          v-if="sync.hydrated"
          class="flex flex-wrap items-center gap-1.5"
        >
          <UBadge
            v-for="fact in weekFacts"
            :key="fact.label"
            :color="fact.lead ? 'primary' : 'neutral'"
            variant="subtle"
            size="sm"
            :label="fact.label"
          />
        </div>
      </AppPageHeader>

      <!--
        The one screen that does not scroll.

        Planning a night is a comparison — this dinner, against who is at the
        table, against what else the evening already holds — and a comparison
        made by scrolling is made from memory. Everything the decision needs is
        on screen at once, so what gives under pressure is decided here rather
        than by whatever happens to be last: the night in the middle takes the
        slack, the roll-call and the shortlist keep their height, and the
        shortlist runs off the right-hand edge instead of the bottom.

        `overflow-y-auto` is a floor, not the plan. On the phones this household
        owns nothing scrolls — the pieces are sized so they do not have to — but
        a short screen, a long dish name and a household of six can still add up
        past the window, and a column that refuses to scroll answers that by
        laying its own children on top of each other. Reaching for a scrollbar
        that is almost never there beats reading the roll-call through the
        shortlist.
      -->
      <!--
        The gutter is on the scroller rather than here, and that is not a tidy-up:
        `overflow-y-auto` forces the other axis to `auto` too, so the column
        clips horizontally at its own content edge. A card in it is exactly as
        wide as that edge, and a `ring` is a box-shadow drawn *outside* the
        border box — so the night's ring lost its left and right sides and the
        selected dinner looked cut off down both edges. Padding inside the
        clipping box is what gives the ring somewhere to be drawn.
      -->
      <main class="mx-auto min-h-0 w-full max-w-xl flex-1 overflow-hidden pb-3">
        <LoadingState
          v-if="!sync.hydrated"
          class="px-3"
        />

        <div
          v-else
          class="flex h-full flex-col gap-3 overflow-y-auto px-3 pt-3"
        >
          <PlanDayStrip
            :nights="nights"
            :no-one-eating="noOneEating"
            :selected="selected"
            class="shrink-0"
            @select="chosenDate = $event"
          />

          <!--
            Every block at its own height, and the slack left at the bottom.

            Stretching one of them to absorb it was tried and is worse both
            ways: a night with a dinner on it became a small card marooned above
            four hundred pixels of nothing, and the same rule on a short screen
            laid the night over the roll-call underneath, because a flex child
            told to fill can also be told to shrink below what is inside it.
            Space under the last thing is the one arrangement that reads the
            same on every night and every screen.
          -->
          <PlanNightFocus
            v-if="selectedNight"
            :night="selectedNight"
            :today="today"
            :past="selected < today"
            :events="events.get(selected)"
            class="shrink-0"
            @open="openSlot(selected)"
            @open-meal="openSlot(selected, $event)"
            @remove="remove(selectedNight)"
            @remove-meal="remove(selectedNight, $event)"
            @skip="skip"
          />

          <PlanDiners
            :date="selected"
            class="shrink-0"
          />

          <PlanSuggestions
            v-if="nightSuggestions.length"
            :suggestions="nightSuggestions"
            :nights="nights"
            :target="selected"
            tiles
            class="shrink-0"
            @pick="pick"
            @see-all="openSlot(selected)"
          />
        </div>
      </main>

      <PlanFlowFooter
        v-if="sync.hydrated"
        :label="nextLabel"
        @next="advance"
      />
    </template>

    <PlanNightEditor
      v-model:open="editorOpen"
      :date="editingSlot?.date ?? null"
      :meal="editingSlot?.meal"
    />

    <!--
      Once for the page rather than once per shape: there is one pointer, so
      there is one thing following it, and both layouts drag onto the same
      nights through the same composable.
    -->
    <PlanDragGhost />
  </div>
</template>
