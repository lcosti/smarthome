<script setup lang="ts">
/**
 * What else a day is already spoken for by.
 *
 * The calendar is the reason a night gets moved, so it is read where the night
 * is decided rather than on a screen of its own. One component because two
 * surfaces show it — the card in the week grid, and the night the phone is
 * planning — and "whose is this" should not be answered two different ways.
 *
 * Each entry carries its owner's colour on the same little rail the board's week
 * strip uses. Neutral for the household's own.
 */
const { events, max = 2 } = defineProps<{
  events: PlanEvent[]
  /**
   * How many to show before the rest become a count.
   *
   * Two on a card that is a quarter of a screen: enough to know the evening is
   * spoken for. The phone plans one night at a time and has the room for all of
   * it, so it asks for more.
   */
  max?: number
}>()

const shown = computed(() => events.slice(0, max))
const more = computed(() => Math.max(0, events.length - max))

function railStyle(hue: number | null) {
  return hue === null ? undefined : { background: `oklch(0.72 0.13 ${hue})` }
}
</script>

<template>
  <div
    v-if="shown.length"
    class="flex min-w-0 flex-col gap-1"
  >
    <span
      v-for="event in shown"
      :key="event.id"
      class="flex min-w-0 items-center gap-1.5"
    >
      <span
        class="h-3 w-0.5 shrink-0 rounded-sm bg-accented"
        :style="railStyle(event.hue)"
      />
      <span
        v-if="event.time"
        class="shrink-0 font-mono text-[11px] text-dimmed tabular-nums"
      >{{ event.time }}</span>
      <span class="truncate text-[11px] text-dimmed">{{ event.title }}</span>
    </span>

    <span
      v-if="more"
      class="pl-2 text-[11px] text-dimmed"
    >+{{ more }} more</span>
  </div>
</template>
