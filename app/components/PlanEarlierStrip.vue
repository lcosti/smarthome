<script setup lang="ts">
import { dishLabel, type PlannedNight } from '../stores/plan'

/**
 * What has already been cooked this week, one line each.
 *
 * Still openable — a plan is a record as much as an intention, and Tuesday's
 * dinner is sometimes remembered on Thursday — but no longer taking a card's
 * worth of screen to say something nobody can act on.
 *
 * The date is dropped on a phone. There is only so much width, and "Mon" beside
 * a dish is enough to place it in a week you are standing in the middle of; the
 * full date earns its space on a screen that has the room.
 */
const { nights } = defineProps<{ nights: PlannedNight[] }>()

defineEmits<{ open: [date: string] }>()

function dayOf(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

function dayOnly(date: string): string {
  return dayOf(date).toLocaleDateString(undefined, { weekday: 'short' })
}

function dateOnly(date: string): string {
  return dayOf(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function label(night: PlannedNight): string {
  const planned = night.entries[0]
  return planned ? dishLabel(planned) : 'Nothing cooked'
}
</script>

<template>
  <div>
    <h3 class="text-xs text-dimmed">
      Earlier this week
    </h3>

    <div class="mt-2 flex flex-wrap gap-2">
      <UButton
        v-for="night in nights"
        :key="night.date"
        color="neutral"
        variant="subtle"
        size="sm"
        class="gap-2.5"
        @click="$emit('open', night.date)"
      >
        <span class="font-medium text-muted">{{ dayOnly(night.date) }}</span>
        <span class="hidden text-dimmed tabular-nums lg:inline">{{ dateOnly(night.date) }}</span>
        <span
          class="max-w-48 truncate"
          :class="night.entries.length ? 'text-default' : 'text-dimmed'"
        >{{ label(night) }}</span>
      </UButton>
    </div>
  </div>
</template>
