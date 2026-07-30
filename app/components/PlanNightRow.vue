<script setup lang="ts">
import type { PlannedNight } from '../stores/plan'
import { dayLabel } from '../utils/week'

const { night, today } = defineProps<{ night: PlannedNight, today: boolean }>()

defineEmits<{ open: [] }>()

const planned = computed(() => night.entries[0] ?? null)
</script>

<template>
  <li class="border-b border-default last:border-b-0">
    <button
      type="button"
      class="flex min-h-14 w-full items-center gap-3 px-3 py-3 text-left active:bg-elevated/60"
      @click="$emit('open')"
    >
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
    </button>
  </li>
</template>
