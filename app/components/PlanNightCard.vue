<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import { dishLabel, type PlannedNight } from '../stores/plan'
import type { RankedCandidate } from '../utils/generator'
import { deriveLifeStage } from '../utils/people'
import { initialOf, personHue } from '../utils/person-colors'

/**
 * One night of the week, on a screen with room to say what is actually on it.
 *
 * Three facts, in the order somebody standing in front of it wants them: what is
 * being eaten, whether it has been shopped for, and who is at the table. An empty
 * night carries the same three lines' worth of space and fills it with an offer,
 * because the reason a night is still empty at Thursday teatime is almost never
 * that nobody has thought about it — it is that thinking about it is work.
 *
 * Presentational: the week above owns which night is being edited and what
 * accepting a suggestion means, so the phone rows and these cards cannot drift
 * apart over what changing a night does.
 */
const { night, today, suggestions = [] } = defineProps<{
  night: PlannedNight
  today: boolean
  suggestions?: RankedCandidate[]
}>()

defineEmits<{ open: [], pick: [recipeId: string] }>()

const people = usePeopleStore()
const attendance = useAttendanceStore()

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
    initial: initialOf(person.name),
    hue: personHue(person.id, people.people)
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

/** "30 min · 4 eating". A leftovers night is not a cooking night and says so. */
const meta = computed(() => {
  const entry = planned.value
  const table = `${eating.value} eating`
  if (!entry) return table
  if (entry.leftover) return `no cooking · ${table}`
  const minutes = (entry.recipe?.prep_minutes ?? 0) + (entry.recipe?.cook_minutes ?? 0)
  return minutes > 0 ? `${minutes} min · ${table}` : table
})
</script>

<template>
  <!--
    A div rather than a button, because an empty night carries buttons of its own
    and a button inside a button is not a thing a browser will render. The dish
    area is the click target instead.
  -->
  <div
    class="flex min-h-0 flex-col overflow-hidden rounded-lg ring transition-colors"
    :class="today ? 'bg-primary/10 ring-primary/50' : 'bg-elevated ring-default'"
  >
    <div class="flex shrink-0 items-baseline justify-between gap-2 px-3.5 pt-3">
      <span
        class="font-mono text-xs uppercase tracking-[0.14em]"
        :class="today ? 'text-primary' : 'text-dimmed'"
      >{{ dayLabel }}</span>
      <span class="font-mono text-[11px] text-dimmed">{{ dateLabel }}</span>
    </div>

    <button
      v-if="planned"
      type="button"
      class="flex min-h-0 flex-1 flex-col items-start px-3.5 pt-2 text-left transition-opacity duration-[80ms] active:opacity-85"
      @click="$emit('open')"
    >
      <span class="line-clamp-3 text-pretty text-[15px] font-medium leading-tight tracking-[-0.01em] text-highlighted">
        {{ dishLabel(planned) }}
      </span>
      <span class="mt-1.5 font-mono text-xs text-dimmed">{{ meta }}</span>

      <span
        v-if="planned.derived"
        class="mt-2 flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] text-primary"
      >
        <UIcon
          name="i-lucide-check"
          class="size-3.5"
        />
        On list
      </span>
    </button>

    <!--
      An empty night is an invitation, and an invitation that names two meals is
      a decision somebody can make without leaving the page.
    -->
    <div
      v-else
      class="m-3 mt-2 flex min-h-0 flex-1 flex-col gap-1.5 rounded-md border border-dashed border-default p-2"
    >
      <button
        type="button"
        class="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm text-dimmed transition-colors hover:text-default"
        @click="$emit('open')"
      >
        <UIcon
          name="i-lucide-plus"
          class="size-4 shrink-0"
        />
        Add dinner
      </button>

      <button
        v-for="candidate in suggestions"
        :key="candidate.recipe.id"
        type="button"
        class="truncate rounded-md bg-elevated/70 px-2.5 py-1.5 text-left text-[13px] text-default ring ring-default transition-colors hover:bg-accented hover:text-highlighted"
        :title="candidate.recipe.name"
        @click="$emit('pick', candidate.recipe.id)"
      >
        {{ candidate.recipe.name }}
      </button>
    </div>

    <div class="mt-auto flex shrink-0 items-center gap-2 border-t border-default px-3.5 py-2.5">
      <UAvatarGroup
        :max="5"
        :ui="{ base: 'ring-0' }"
      >
        <BoardAvatar
          v-for="face in faces"
          :key="face.id"
          :initial="face.initial"
          :hue="face.hue"
          :size="26"
        />
      </UAvatarGroup>
      <span class="truncate font-mono text-xs text-dimmed">{{ eating }} eating</span>
    </div>
  </div>
</template>
