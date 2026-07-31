<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { suggestionReason, type RankedCandidate } from '../utils/generator'
import { initialOf, personColors, personHue } from '../utils/person-colors'

/**
 * The two questions the grid cannot answer without being read across.
 *
 * Who is eating is a column-by-column fact laid out sideways: seven cards each
 * showing four faces is a roll-call you have to perform yourself. As one bar per
 * person it is a shape — a short bar is somebody the week has quietly stopped
 * catering for.
 *
 * And it is where the roster gets edited, because the bar and the popover that
 * changes it should be the same object. Marking Tuesday away used to mean opening
 * a night, which is the wrong unit: absence is a fact about a person across a
 * week, not about a night.
 */
const { nights, suggestions, target } = defineProps<{
  nights: PlannedNight[]
  /** Ranked meals for the night the buttons plan onto. Empty when the week is full. */
  suggestions: RankedCandidate[]
  /** The first night still empty and still ahead, or null when there is none. */
  target: string | null
}>()

const emit = defineEmits<{ pick: [recipeId: string] }>()

const people = usePeopleStore()
const attendance = useAttendanceStore()
const plan = usePlanStore()
const recipes = useRecipesStore()
const pantryCovers = usePantryCovers()

/** Nights with a meal on them — the denominator: "how much of this week are you here for". */
const plannedNights = computed(() => nights.filter(night => night.entries.length))

const roster = computed(() =>
  people.people.map((person) => {
    const hue = personHue(person.id, people.people)
    const present = plannedNights.value.filter(night =>
      attendance.isPresent(person.id, night.date)
    ).length
    const total = plannedNights.value.length
    return {
      id: person.id,
      name: person.name,
      initial: initialOf(person.name),
      hue,
      colors: personColors(hue),
      present,
      total,
      // A week with nothing planned yet gets full bars rather than none: nobody
      // has been left out of anything, and empty bars would read as an alarm.
      fraction: total ? present / total : 1,
      away: total > 0 && present < total,
      nights: nights.map(night => ({
        date: night.date,
        label: new Date(
          Number(night.date.slice(0, 4)),
          Number(night.date.slice(5, 7)) - 1,
          Number(night.date.slice(8, 10))
        ).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
        present: attendance.isPresent(person.id, night.date)
      }))
    }
  })
)

/**
 * One person's week as a menu of checkboxes, headed by whose week it is.
 *
 * `checked` is read straight off the roster rather than held separately, so the
 * menu shows attendance rather than a copy of it that can drift.
 */
function nightItems(person: { id: string, name: string, nights: { date: string, label: string, present: boolean }[] }) {
  return [
    [{ label: `${person.name} is eating`, type: 'label' as const }],
    person.nights.map(night => ({
      label: night.label,
      type: 'checkbox' as const,
      checked: night.present,
      onUpdateChecked: (checked: boolean) => {
        attendance.setPresence(person.id, night.date, checked)
      }
    }))
  ]
}

const dayName = computed(() => {
  if (!target) return null
  const [year, month, day] = target.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'short' })
})

/** Every recipe already on this week, so a suggestion can admit it is spoken for. */
const onPlan = computed(() =>
  new Set(nights.flatMap(night => night.entries.map(planned => planned.entry.recipe_id)))
)

/**
 * The reason line, with the one fact the scorer cannot know folded in: whether
 * the cupboard already covers it. Nothing to buy beats every other argument for
 * cooking something tonight.
 */
function reasonFor(candidate: RankedCandidate): string {
  const lines = recipes.ingredientsFor(candidate.recipe.id)
  const allPantry = lines.length > 0 && lines.every(line => pantryCovers.value(line))
  return suggestionReason(candidate, {
    allPantry,
    cookedTimes: plan.timesCooked(candidate.recipe.id, nights[0]?.date ?? '')
  })
}
</script>

<template>
  <UCard
    variant="outline"
    :ui="{
      root: 'flex min-h-0 flex-col overflow-hidden rounded-lg bg-elevated',
      body: 'flex min-h-0 flex-1 flex-col gap-6 p-0 sm:p-0'
    }"
  >
    <!--
      shrink-0 on every block is load-bearing, exactly as in the recipe pane: this
      is a fixed-height flex column, and without it the roster is squashed below
      its own content to make room and overflows onto what follows.
    -->
    <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
      <div class="shrink-0">
        <h3 class="font-mono text-xs uppercase tracking-[0.14em] text-dimmed">
          Who is eating
        </h3>

        <ul class="mt-3 flex flex-col gap-3.5">
          <li
            v-for="person in roster"
            :key="person.id"
          >
            <div class="flex items-center gap-2.5">
              <BoardAvatar
                :initial="person.initial"
                :hue="person.hue"
                :size="28"
              />
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
                {{ person.name }}
              </span>
              <span class="shrink-0 font-mono text-xs text-dimmed">
                {{ person.present }}/{{ person.total }}
              </span>

              <!--
                A checkbox menu rather than a popover full of buttons: seven
                nights each independently on or off is exactly what it models,
                and it brings the keyboard handling and the roles with it.
              -->
              <UDropdownMenu
                :items="nightItems(person)"
                :ui="{ content: 'p-1.5' }"
              >
                <UButton
                  color="neutral"
                  :variant="person.away ? 'subtle' : 'ghost'"
                  size="sm"
                  label="Away"
                  class="shrink-0 rounded-md px-2 py-1 text-xs"
                  :class="person.away ? 'text-default' : 'text-dimmed'"
                />
              </UDropdownMenu>
            </div>

            <!--
              The bar carries the person's own colour rather than the accent, so
              a short one is read as "Ada" before it is read as "a warning".
            -->
            <div class="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-accented/60">
              <div
                class="h-full rounded-full transition-[width] duration-200"
                :style="{
                  width: `${Math.round(person.fraction * 100)}%`,
                  background: person.colors.ring
                }"
              />
            </div>
          </li>
        </ul>

        <p
          v-if="!roster.length"
          class="mt-3 text-sm text-dimmed"
        >
          Nobody in the household yet. Add people in Settings and the week starts catering for them.
        </p>
      </div>

      <div class="shrink-0">
        <h3 class="font-mono text-xs uppercase tracking-[0.14em] text-dimmed">
          Recommended meals
        </h3>

        <ul
          v-if="suggestions.length"
          class="mt-3 flex flex-col gap-4"
        >
          <li
            v-for="candidate in suggestions"
            :key="candidate.recipe.id"
          >
            <p class="text-pretty text-sm font-medium leading-tight text-highlighted">
              {{ candidate.recipe.name }}
            </p>
            <p class="mt-1 text-xs text-muted">
              {{ reasonFor(candidate) }}
            </p>
            <UButton
              v-if="onPlan.has(candidate.recipe.id)"
              color="neutral"
              variant="subtle"
              size="sm"
              label="On plan"
              disabled
              class="mt-2 rounded-md px-2.5 py-1 text-xs"
            />
            <UButton
              v-else
              color="primary"
              variant="soft"
              size="sm"
              :label="`Use ${dayName}`"
              class="mt-2 rounded-md px-2.5 py-1 text-xs"
              @click="emit('pick', candidate.recipe.id)"
            />
          </li>
        </ul>

        <p
          v-else
          class="mt-3 text-sm text-dimmed"
        >
          {{ target
            ? 'Nothing left to suggest — every recipe is already on this week or ruled out by an allergy.'
            : 'Nothing left to plan this week.' }}
        </p>
      </div>
    </div>
  </UCard>
</template>
