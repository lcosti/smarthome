<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import type { PlannedNight } from '../stores/plan'
import { dayLabel } from '../utils/week'

const { night, today } = defineProps<{ night: PlannedNight, today: boolean }>()

defineEmits<{ open: [] }>()

const attendance = useAttendanceStore()

const planned = computed(() => night.entries[0] ?? null)

/**
 * Only ever names who is out. Everybody being home is the normal case and needs
 * no ink; a line saying so on all seven nights would be noise to read past.
 */
const awayLabel = computed(() => {
  const away = attendance.awayOn(night.date)
  if (!away.length) return null
  const names = away.map(person => person.name)
  if (names.length === 1) return `${names[0]} away`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} away`
})
</script>

<template>
  <li class="border-b border-default last:border-b-0">
    <button
      type="button"
      class="flex min-h-14 w-full flex-col px-3 py-3 text-left active:bg-elevated/60"
      @click="$emit('open')"
    >
      <span class="flex w-full items-center gap-3">
        <span
          class="w-20 shrink-0 text-xs font-medium uppercase tracking-wide"
          :class="today ? 'text-primary' : 'text-dimmed'"
        >
          {{ dayLabel(night.date) }}
        </span>

        <template v-if="planned">
          <span class="min-w-0 flex-1">
            <span class="block truncate">
              {{ planned.recipe?.name ?? 'Recipe deleted' }}
            </span>
            <span class="block truncate text-sm text-dimmed">
              {{ planned.entry.servings }} servings
              <template v-if="night.entries.length > 1">
                · +{{ night.entries.length - 1 }} more
              </template>
            </span>
          </span>
          <span
            v-if="planned.derived"
            class="flex shrink-0 items-center gap-1 text-xs text-primary"
          >
            <UIcon
              name="i-lucide-check"
              class="size-4"
            />
            On list
          </span>
        </template>

        <!-- An unplanned night should look like an invitation, not a gap. -->
        <template v-else>
          <span class="flex flex-1 items-center gap-2 text-dimmed">
            <UIcon
              name="i-lucide-plus"
              class="size-5"
            />
            <span class="text-sm">Add dinner</span>
          </span>
        </template>
      </span>

      <span
        v-if="awayLabel"
        class="mt-1 block w-full truncate pl-[5.75rem] text-xs text-dimmed"
      >{{ awayLabel }}</span>
    </button>
  </li>
</template>
