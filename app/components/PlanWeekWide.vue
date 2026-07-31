<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import type { PlannedNight } from '../stores/plan'
import { initialOf, personHue } from '../utils/person-colors'

/**
 * The week as seven columns, for a screen with the width for it.
 *
 * A column per night is the only layout where "what are we doing Thursday" is
 * answered without reading. The phone gets the same seven nights as rows, for
 * the same reason in reverse.
 *
 * Presentational only: the page above owns which week is on screen and opens
 * the night editor, so both shapes edit through exactly one component and
 * cannot drift apart over what changing a night means.
 */
defineProps<{ nights: PlannedNight[], today: string }>()

defineEmits<{ open: [date: string] }>()

const people = usePeopleStore()
const attendance = useAttendanceStore()

function dayLabelOf(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'short' })
}

function dateLabelOf(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
</script>

<template>
  <div class="grid grid-cols-7 gap-2">
    <UCard
      v-for="night in nights"
      :key="night.date"
      as="button"
      variant="outline"
      :ui="{
        root: night.date === today
          ? 'flex min-h-[160px] flex-col rounded-lg bg-primary/10 ring-primary/50 text-left transition-opacity duration-[80ms] active:opacity-85'
          : 'flex min-h-[160px] flex-col rounded-lg bg-elevated text-left transition-opacity duration-[80ms] active:opacity-85',
        body: 'flex min-h-0 flex-1 flex-col gap-2 px-3.5 py-2.5 sm:p-0 sm:px-3.5 sm:py-2.5'
      }"
      @click="$emit('open', night.date)"
    >
      <span class="shrink-0">
        <span
          class="block font-mono text-xs uppercase tracking-[0.08em]"
          :class="night.date === today ? 'text-primary' : 'text-dimmed'"
        >{{ dayLabelOf(night.date) }}</span>
        <span class="block font-mono text-[11px] text-dimmed">{{ dateLabelOf(night.date) }}</span>
      </span>

      <span
        v-if="night.entries.length"
        class="min-w-0 flex-1"
      >
        <span class="line-clamp-3 text-sm font-medium text-highlighted">
          {{ night.entries[0]!.recipe?.name ?? 'Recipe deleted' }}
        </span>
        <span class="mt-0.5 block font-mono text-xs text-dimmed">
          {{ night.entries[0]!.entry.servings }} servings
        </span>
      </span>

      <!-- An empty night is an invitation, not a gap. -->
      <span
        v-else
        class="flex flex-1 items-start gap-1.5 text-dimmed"
      >
        <UIcon
          name="i-lucide-plus"
          class="size-4 shrink-0"
        />
        <span class="text-sm">Add dinner</span>
      </span>

      <!--
        Overlapped rather than laid out in a row: on a narrow column a household
        of five wraps to two lines and pushes the dish out of the card, and who
        is eating is a glance rather than a roll-call.
      -->
      <UAvatarGroup
        :max="5"
        class="shrink-0"
        :ui="{ base: 'ring-0' }"
      >
        <BoardAvatar
          v-for="person in attendance.presentOn(night.date)"
          :key="person.id"
          :initial="initialOf(person.name)"
          :hue="personHue(person.id, people.people)"
          :size="28"
        />
      </UAvatarGroup>
    </UCard>
  </div>
</template>
