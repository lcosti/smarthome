<script setup lang="ts">
import type { BoardHeader } from '../../utils/board'

/**
 * Day, date, week, weather, and how much of this the board still believes.
 *
 * The staleness pill is the only place the board admits to a problem, and it
 * says it in words rather than with an icon on its own — "Offline · last synced
 * 15:58" tells you how much to trust the rest of the frame, which a red dot does
 * not. It sits beside the plan badge rather than replacing it: the two answer
 * different questions and both can be true at once.
 *
 * This strip is the constant: it stays put while the view beneath it changes,
 * which is why the navigation lives in its middle rather than above the content
 * it switches between.
 *
 * Three groups, and the outer two must not shrink. Letting them do so was a real
 * bug — at narrow widths the bar clipped the date and the temperature instead of
 * wrapping, and a wall display that silently loses half its header looks broken
 * rather than tight.
 */
const { header } = defineProps<{ header: BoardHeader }>()
</script>

<template>
  <header
    class="flex min-h-16 flex-none flex-wrap items-center justify-between gap-x-6 gap-y-3
           border-b border-default px-6 py-3"
  >
    <div class="flex flex-none items-center gap-3 whitespace-nowrap">
      <h1 class="text-xl font-semibold leading-none tracking-[-0.02em] text-highlighted">
        {{ header.dayName }}
      </h1>
      <span class="h-5 w-px bg-elevated" />
      <p class="text-sm text-muted">
        {{ header.dateLine }}
      </p>
      <UBadge
        color="primary"
        variant="subtle"
        :label="header.weekLabel"
        :ui="{ base: 'rounded-md px-2 py-1 text-xs font-medium leading-none' }"
      />
    </div>

    <!-- The middle was dead space; it is where the navigation goes. -->
    <slot name="nav" />

    <div class="ml-auto flex flex-none items-center gap-3 whitespace-nowrap">
      <div
        v-if="header.weather"
        class="flex items-center gap-2"
      >
        <UIcon
          :name="header.weather.icon"
          class="size-4 text-primary"
        />
        <span class="text-base font-medium leading-none text-highlighted tabular-nums">
          {{ header.weather.temperature }}°
        </span>
      </div>

      <UBadge
        :color="header.plan.generated ? 'primary' : 'neutral'"
        variant="subtle"
        :ui="{ base: 'gap-1.5 rounded-md px-2 py-1 text-xs font-medium leading-none' }"
      >
        <span
          class="size-1.5 rounded-full"
          :class="header.plan.generated ? 'bg-primary' : 'bg-[var(--ui-text-dimmed)]'"
        />
        {{ header.plan.label }}
      </UBadge>

      <!--
        Neutral with an amber dot, not an amber badge: this is a note about how
        old the frame is, not a second plan badge, and the two sitting side by
        side in the same colour would read as one sentence.
      -->
      <UBadge
        v-if="header.stale"
        color="neutral"
        variant="subtle"
        :ui="{ base: 'gap-1.5 rounded-md px-2 py-1 text-xs font-medium leading-none' }"
      >
        <span class="size-1.5 rounded-full bg-primary" />
        {{ header.staleLabel }}
      </UBadge>

      <UButton
        color="neutral"
        variant="ghost"
        to="/settings"
        label="Settings"
        :ui="{ base: 'px-2.5 py-1.5 text-sm font-medium' }"
      />
    </div>
  </header>
</template>
