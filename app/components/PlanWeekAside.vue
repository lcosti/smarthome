<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import type { PlannedNight } from '../stores/plan'
import type { RankedCandidate } from '../utils/generator'
import type { Meal } from '../utils/meal'
import { initialOf } from '../utils/person-colors'

/**
 * What the grid cannot answer without being read across: the week in numbers,
 * who is at the table for it, and what to put on the nights still open.
 *
 * Who is eating is a column-by-column fact laid out sideways — seven cards each
 * showing four faces is a roll-call you have to perform yourself. One row per
 * person answers it in a glance: a count of the nights they are in for, and a
 * chip saying whether they are missing any of them — which is also what opens
 * the menu that changes it.
 */
const { nights, suggestions, target } = defineProps<{
  nights: PlannedNight[]
  /** Ranked meals for the night the buttons plan onto. Empty when the week is full. */
  suggestions: RankedCandidate[]
  /** The first night still empty and still ahead, or null when there is none. */
  target: string | null
}>()

const emit = defineEmits<{ pick: [recipeId: string, meal: Meal] }>()

const people = usePeopleStore()
const attendance = useAttendanceStore()

/**
 * Attendance across the whole week, not across the nights that happen to have a
 * meal on them.
 *
 * The denominator used to be the planned nights, which made an unplanned week
 * read "0 of 0 nights" for everybody — including somebody who is in on two of
 * them — and made the number move every time a dinner was chosen. Whether Luke
 * is eating here on Saturday is a fact about Saturday; it does not wait for
 * anyone to decide what is being cooked.
 */
const roster = computed(() =>
  people.people.map((person) => {
    const present = attendance.nightsPresent(person.id, nights.map(night => night.date))
    const total = nights.length
    return {
      id: person.id,
      name: person.name,
      initial: initialOf(person.name),
      avatar: person.avatar,
      present,
      total,
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
 *
 * The menu stays open across a tick. A dropdown closing on select is right when
 * the items are commands and picking one ends the task, and wrong here: "who is
 * eating this week" is answered several nights at a time — away Wednesday,
 * Thursday and Friday is one thought, not three — and re-opening the same menu
 * between each of them is the whole of the friction. Reka closes on `select`
 * unless the event is prevented, so each night prevents it.
 */
function nightItems(person: { id: string, name: string, nights: { date: string, label: string, present: boolean }[] }) {
  return [
    [{ label: `${person.name} is eating`, type: 'label' as const }],
    person.nights.map(night => ({
      label: night.label,
      type: 'checkbox' as const,
      checked: night.present,
      onSelect: (event: Event) => event.preventDefault(),
      onUpdateChecked: (checked: boolean) => {
        attendance.setPresence(person.id, night.date, checked)
      }
    }))
  ]
}
</script>

<template>
  <!--
    A column beside the week rather than a panel on top of it: the rule down its
    left edge is the only frame it needs, and the cards inside are the objects.
    shrink-0 on every block is load-bearing, exactly as in the recipe pane —
    without it the roster is squashed below its own content to make room for
    what follows and overflows onto it.
  -->
  <div class="flex min-h-0 flex-col gap-5 overflow-y-auto border-l border-default px-5 py-4">
    <PlanWeekStats
      :nights="nights"
      class="shrink-0"
    />

    <div class="shrink-0">
      <h3 class="text-xs text-dimmed">
        Who is eating
      </h3>

      <ul class="mt-2 flex flex-col gap-2">
        <li
          v-for="person in roster"
          :key="person.id"
        >
          <UCard
            variant="soft"
            :ui="{ body: 'flex items-center gap-2.5 px-3 py-2.5 sm:p-3' }"
          >
            <UAvatar
              :src="person.avatar ?? undefined"
              :alt="person.name"
              :text="person.initial"
              size="sm"
            />
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
              {{ person.name }}
            </span>
            <span class="shrink-0 text-xs text-dimmed tabular-nums">
              {{ person.present }} of {{ person.total }} nights
            </span>

            <!--
              What it says and what changes it are the same object: marking
              Tuesday away used to mean opening a night, which is the wrong unit,
              because absence is a fact about a person across a week. A button
              rather than a badge, chip-shaped though it is — it opens a menu,
              and that is what a button is for. A checkbox menu rather than a
              popover full of buttons: seven nights each independently on or off
              is exactly what it models, and it brings the keyboard handling and
              the roles with it.
            -->
            <UDropdownMenu
              :items="nightItems(person)"
              :ui="{ content: 'p-1.5' }"
            >
              <UButton
                :color="person.away ? 'neutral' : 'primary'"
                variant="subtle"
                size="xs"
                class="shrink-0"
                :label="person.away ? `Away ${person.total - person.present}` : 'Eating in'"
              />
            </UDropdownMenu>
          </UCard>
        </li>
      </ul>

      <UEmpty
        v-if="!roster.length"
        variant="naked"
        size="sm"
        icon="i-lucide-users"
        title="Nobody in the household yet"
        description="Add people in Settings and the week starts catering for them."
        :ui="{ root: 'mt-2 p-0 sm:p-0' }"
      />
    </div>

    <PlanSuggestions
      :suggestions="suggestions"
      :nights="nights"
      :target="target"
      class="shrink-0"
      @pick="(recipeId, meal) => emit('pick', recipeId, meal)"
    />
  </div>
</template>
