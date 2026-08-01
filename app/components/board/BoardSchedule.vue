<script setup lang="ts">
import type { BoardModel } from '../../utils/board'

/**
 * The rest of today, with dinner sitting in it as an appointment.
 *
 * The view model has already decided how many rows fit and counted what it left
 * out, so nothing here reflows and the card never grows past its share of the
 * column. The dinner row is the one amber line on the card, and it is what ties
 * this card to the one beside it.
 *
 * The now-marker is absent when offline, and that is deliberate rather than an
 * oversight — a board that cannot reach the server cannot honestly draw a line
 * across the day and call it this moment.
 *
 * An unconnected calendar gets ghost rails rather than nothing at all, so the
 * card reads as a timeline waiting for content instead of a void.
 */
const { schedule } = defineProps<{ schedule: BoardModel['schedule'] }>()

/** Three times that look like a day, for a card that has no day to show yet. */
const GHOST_RAILS = ['08:00', '13:00', '18:30']

/**
 * The rail beside an event, in whoever's colour it is.
 *
 * Nothing when the event belongs to no one in particular — the neutral rail the
 * class already gives it is the right answer, and inventing a colour for a
 * household event would make the colours mean less everywhere else.
 */
function railStyle(hue: number | null) {
  return hue === null ? undefined : { background: `oklch(0.72 0.13 ${hue})` }
}
</script>

<template>
  <UCard
    variant="subtle"
    :ui="{
      header: 'flex flex-none items-center justify-between gap-3 px-6 py-4 sm:px-6',
      body: 'flex flex-col p-0 sm:p-0'
    }"
    class="flex flex-none flex-col transition-opacity duration-300"
    :style="{ opacity: schedule.dim ? '0.62' : '1' }"
  >
    <template #header>
      <h2 class="text-base font-semibold text-highlighted">
        Today
      </h2>
      <UBadge
        color="neutral"
        variant="subtle"
        :label="schedule.badge"
      />
    </template>

    <!-- Waiting for a calendar -->
    <div
      v-if="schedule.empty"
      class="flex flex-col"
    >
      <div class="flex flex-col gap-3 px-6 py-4">
        <div
          v-for="rail in GHOST_RAILS"
          :key="rail"
          class="flex items-center gap-3"
        >
          <span class="w-[42px] shrink-0 font-mono text-xs text-dimmed">{{ rail }}</span>
          <span class="h-px flex-1 bg-elevated" />
        </div>
      </div>
      <div class="px-6 pb-4">
        <UButton
          color="primary"
          variant="ghost"
          to="/settings"
          label="Connect a calendar"
          trailing-icon="i-lucide-arrow-right"
        />
      </div>
    </div>

    <div
      v-else
      class="flex flex-col px-6 pb-4 pt-2"
    >
      <template
        v-for="(row, index) in schedule.rows"
        :key="row.id"
      >
        <!--
          The marker keeps the rows' own geometry — a time in the same 42px
          column, a rule where the rail would be — so it reads as a moment in
          the list rather than a widget dropped into it.
        -->
        <div
          v-if="schedule.nowAt && index === schedule.nowIndex"
          class="flex items-center gap-3 py-1.5"
        >
          <span class="w-[42px] shrink-0 font-mono text-xs font-medium text-primary">{{ schedule.nowAt }}</span>
          <span class="h-px flex-1 bg-primary/70" />
        </div>

        <div
          class="flex items-start gap-3.5 border-b border-default py-3 last:border-b-0"
          :style="{ opacity: row.past ? '0.5' : '1' }"
        >
          <span
            class="w-[42px] shrink-0 pt-px font-mono text-xs"
            :class="row.meal ? 'text-primary' : 'text-muted'"
          >{{ row.time }}</span>

          <span
            class="w-0.5 shrink-0 self-stretch rounded-sm"
            :class="row.meal ? 'bg-primary' : 'bg-accented'"
            :style="row.meal ? undefined : railStyle(row.hue)"
          />

          <span class="flex min-w-0 flex-col gap-0.5">
            <span
              class="truncate text-sm font-medium"
              :class="row.meal ? 'text-primary' : 'text-highlighted'"
            >{{ row.title }}</span>
            <span
              v-if="row.meta"
              class="truncate text-xs text-dimmed"
            >{{ row.meta }}</span>
          </span>
        </div>
      </template>

      <!-- Marker after the last row, when everything today has been and gone. -->
      <div
        v-if="schedule.nowAt && schedule.nowIndex >= schedule.rows.length"
        class="flex items-center gap-3 py-1.5"
      >
        <span class="w-[42px] shrink-0 font-mono text-xs font-medium text-primary">{{ schedule.nowAt }}</span>
        <span class="h-px flex-1 bg-primary/70" />
      </div>

      <p
        v-if="schedule.overflow"
        class="mt-3 border-t border-default pt-3 font-mono text-xs text-dimmed"
      >
        {{ schedule.overflow }}
      </p>
    </div>
  </UCard>
</template>
