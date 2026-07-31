<script setup lang="ts">
import type { WeekSlot } from '../../utils/board'

/**
 * Six days of context under the hero, so the board answers "and then what" as
 * well as "what tonight".
 *
 * A night with nothing planned is an em-dash on a dimmer surface rather than a
 * gap: the week has seven nights whether or not somebody has decided about them,
 * and a missing tile would read as a rendering fault from across the room.
 */
defineProps<{ week: WeekSlot[] }>()
</script>

<template>
  <section class="flex flex-col gap-4 rounded-2xl border border-default bg-elevated px-[30px] py-[22px]">
    <h2 class="font-mono text-[20px] uppercase tracking-[0.14em] text-dimmed">
      The rest of the week
    </h2>

    <div class="grid grid-cols-6 gap-3.5">
      <div
        v-for="slot in week"
        :key="slot.date"
        class="flex min-w-0 flex-col gap-2 rounded-xl border px-[18px] py-3.5"
        :class="slot.highlighted
          ? 'border-warning/50 bg-warning/10'
          : slot.empty
            ? 'border-default/60 bg-default/40'
            : 'border-default bg-default'"
      >
        <span
          class="font-mono text-[19px] uppercase tracking-[0.08em]"
          :class="slot.highlighted ? 'text-warning' : 'text-dimmed'"
        >{{ slot.day }}</span>
        <span
          class="truncate text-[26px] font-medium"
          :class="slot.highlighted
            ? 'text-highlighted'
            : slot.empty ? 'text-dimmed' : 'text-default'"
        >{{ slot.dish }}</span>
      </div>
    </div>
  </section>
</template>
