<script setup lang="ts">
import type { BoardHeader } from '../../utils/board'

/**
 * Day, date, weather, and how much of this the board still believes.
 *
 * The staleness pill is the only place the board admits to a problem, and it
 * says it in words rather than with an icon on its own — "Offline · last synced
 * 15:58" tells you how much to trust the rest of the frame, which a red dot does
 * not.
 *
 * This strip is the constant: it stays put while the view beneath it changes,
 * which is why the navigation lives in its middle rather than above the content
 * it switches between.
 */
const { header } = defineProps<{ header: BoardHeader }>()
</script>

<template>
  <header class="flex items-end justify-between border-b border-default pb-[18px]">
    <div class="flex items-baseline gap-[26px]">
      <h1 class="text-[82px] font-semibold leading-none tracking-[-0.025em] text-highlighted">
        {{ header.dayName }}
      </h1>
      <p class="text-[34px] leading-none text-muted">
        {{ header.dateLine }}
      </p>
    </div>

    <!-- The middle was dead space; it is where the navigation goes. -->
    <div class="flex flex-1 justify-center px-10">
      <slot name="nav" />
    </div>

    <div class="flex items-center gap-10">
      <div
        v-if="header.weather"
        class="flex items-center gap-[14px]"
      >
        <UIcon
          :name="header.weather.icon"
          class="size-10 text-warning"
        />
        <span class="text-[38px] font-medium leading-none text-highlighted">
          {{ header.weather.temperature }}°
        </span>
      </div>

      <div class="flex flex-col items-end gap-[10px]">
        <p class="font-mono text-[20px] text-dimmed">
          {{ header.generatedAt }}
        </p>
        <UBadge
          v-if="header.stale"
          color="warning"
          variant="soft"
          :ui="{ base: 'rounded-full gap-3 px-5 py-[9px] font-mono text-[19px] ring-1 ring-warning/50' }"
        >
          <span class="size-3 rounded-full bg-warning" />
          {{ header.staleLabel }}
        </UBadge>
      </div>
    </div>
  </header>
</template>
