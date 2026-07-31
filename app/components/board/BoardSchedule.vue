<script setup lang="ts">
import type { BoardModel } from '../../utils/board'

/**
 * The rest of today, with dinner sitting in it as an appointment.
 *
 * Fixed height and hidden overflow: this card must never grow, so the view model
 * has already decided how many rows fit and counted what it left out. Nothing
 * here reflows.
 *
 * The now-marker is absent when offline, and that is deliberate rather than an
 * oversight — a board that cannot reach the server cannot honestly draw a line
 * across the day and call it this moment.
 */
const { schedule } = defineProps<{ schedule: BoardModel['schedule'] }>()

function dotStyle(hue: number | null, meal: boolean) {
  if (meal) return { background: 'var(--ui-warning)' }
  return { background: hue === null ? 'var(--ui-text-dimmed)' : `oklch(0.72 0.13 ${hue})` }
}
</script>

<template>
  <UCard
    variant="outline"
    :ui="{
      root: 'flex h-[382px] shrink-0 flex-col overflow-hidden rounded-2xl bg-elevated',
      body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0'
    }"
    class="px-8 py-6 transition-opacity duration-300"
    :style="{ opacity: schedule.dim ? '0.62' : '1' }"
  >
    <div class="mb-4 flex items-center justify-between">
      <p class="font-mono text-[21px] uppercase tracking-[0.14em] text-muted">
        Today
      </p>
      <p class="font-mono text-[20px] text-dimmed">
        {{ schedule.meta }}
      </p>
    </div>

    <!--
      Clipped rather than allowed to push: the card is a fixed 382px, and the
      view model has already decided how many rows fit. If a long day ever
      outgrows that, the last row is cut off — never the footer that says how
      much was left out.
    -->
    <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
      <template
        v-for="(row, index) in schedule.rows"
        :key="row.id"
      >
        <div
          v-if="schedule.nowAt && index === schedule.nowIndex"
          class="my-1 grid shrink-0 grid-cols-[104px_22px_1fr] items-center"
        >
          <span class="font-mono text-[24px] font-medium text-warning">{{ schedule.nowAt }}</span>
          <span class="flex justify-center">
            <span class="size-[18px] rounded-full bg-warning" />
          </span>
          <span class="ml-2 h-0.5 bg-warning/70" />
        </div>

        <div
          class="grid shrink-0 grid-cols-[104px_22px_1fr] items-center py-[5px]"
          :style="{ opacity: row.past ? '0.4' : '1' }"
        >
          <span
            class="font-mono text-[24px] leading-tight"
            :class="row.next ? 'text-highlighted' : 'text-muted'"
          >{{ row.time }}</span>

          <span class="flex justify-center">
            <span
              class="size-3 rounded-full"
              :style="{
                ...dotStyle(row.hue, row.meal),
                boxShadow: row.next || row.meal
                  ? `0 0 0 6px ${row.meal ? 'oklch(0.34 0.06 62)' : 'oklch(0.30 0.02 62)'}`
                  : 'none'
              }"
            />
          </span>

          <span class="flex min-w-0 items-center gap-[14px] pl-5">
            <span
              class="truncate leading-tight"
              :class="row.next || row.meal
                ? 'text-[28px] font-semibold text-highlighted'
                : 'text-[24px] text-default'"
            >{{ row.title }}</span>
            <UBadge
              v-if="row.badge"
              :color="row.meal ? 'warning' : 'neutral'"
              variant="soft"
              :ui="{ base: 'shrink-0 rounded-full px-3.5 py-1 font-mono text-[17px] leading-tight uppercase tracking-[0.06em] ring-1 ring-default' }"
            >
              {{ row.badge }}
            </UBadge>
          </span>
        </div>
      </template>

      <!-- Marker after the last row, when everything today has been and gone. -->
      <div
        v-if="schedule.nowAt && schedule.nowIndex >= schedule.rows.length"
        class="my-1 grid grid-cols-[104px_22px_1fr] items-center"
      >
        <span class="font-mono text-[24px] font-medium text-warning">{{ schedule.nowAt }}</span>
        <span class="flex justify-center">
          <span class="size-[18px] rounded-full bg-warning" />
        </span>
        <span class="ml-2 h-0.5 bg-warning/70" />
      </div>
    </div>

    <p
      v-if="schedule.overflow"
      class="mt-3.5 shrink-0 border-t border-default pt-3.5 text-[22px] text-dimmed"
    >
      {{ schedule.overflow }}
    </p>
  </UCard>
</template>
