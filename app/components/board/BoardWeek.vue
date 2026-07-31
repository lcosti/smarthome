<script setup lang="ts">
import type { WeekSlot } from '../../utils/board'

/**
 * Six days of context under the hero, so the page answers "and then what" as
 * well as "what tonight".
 *
 * A night with nothing planned says "No meal" on a recessed tile rather than
 * leaving a gap: the week has seven nights whether or not somebody has decided
 * about them, and a missing tile would read as a rendering fault from across the
 * room.
 *
 * Generating lives here rather than only in the hero, because this is the card
 * the empty nights are on. Fixed track counts at each width, never
 * `repeat(auto-fit, …)` — that orphaned a single card onto its own row at some
 * widths. Six divides evenly by two and three, so no row is ever short.
 */
defineProps<{ week: WeekSlot[], generating?: boolean }>()

defineEmits<{ generate: [] }>()
</script>

<template>
  <UCard
    variant="subtle"
    class="flex-none"
    :ui="{
      header: 'flex items-center justify-between gap-3 px-6 py-4 sm:px-6',
      body: 'grid grid-cols-2 gap-3 px-4 pb-4 pt-3 sm:grid-cols-3 sm:p-6 sm:pb-6 sm:pt-5 lg:grid-cols-6'
    }"
  >
    <template #header>
      <h2 class="text-base font-semibold text-highlighted">
        The rest of the week
      </h2>
      <UButton
        color="neutral"
        variant="ghost"
        :label="generating ? 'Generating…' : 'Generate'"
        @click="$emit('generate')"
      />
    </template>

    <div
      v-for="slot in week"
      :key="slot.date"
      class="min-w-0 rounded-lg p-4 transition-colors"
      :class="slot.highlighted
        ? 'bg-primary/10 ring ring-primary/25'
        : 'bg-default ring ring-default hover:bg-elevated'"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span
          class="text-xs font-semibold uppercase tracking-[0.06em]"
          :class="slot.highlighted ? 'text-primary' : 'text-muted'"
        >{{ slot.day }}</span>
        <span class="font-mono text-xs text-dimmed">{{ slot.dateLabel }}</span>
      </div>

      <p
        class="mt-3.5 text-pretty text-sm leading-[1.4]"
        :class="slot.highlighted
          ? 'text-highlighted'
          : slot.empty ? 'text-dimmed/70' : 'text-default'"
      >
        {{ slot.dish }}
      </p>

      <p
        v-if="slot.meta"
        class="mt-1.5 font-mono text-[11px] text-dimmed"
      >
        {{ slot.meta }}
      </p>
    </div>
  </UCard>
</template>
