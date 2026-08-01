<script setup lang="ts">
import type { WeekSlot } from '../../utils/board'

/**
 * Six days of context under today, so the page answers "and then what" as well
 * as "what tonight".
 *
 * Bare tiles rather than a card: on a wide screen this sits under the day it
 * belongs to, inside the same column, and wrapping it in a second frame would
 * put a border between the week and the day it is the rest of. The phone keeps a
 * label, because there it follows the calendar down a scroll and needs saying.
 *
 * A night with nothing planned says "No meal" on a recessed tile rather than
 * leaving a gap: the week has seven nights whether or not somebody has decided
 * about them, and a missing tile would read as a rendering fault from across the
 * room.
 *
 * Each day also names what else it is spoken for by, because the calendar is why
 * a night gets moved. A week that shows the meals alone makes somebody check two
 * screens against each other to notice that Wednesday's roast is the evening
 * half the house is out.
 *
 * A strip on a wide screen, a stack on a phone. Fixed track counts at each
 * width, never `repeat(auto-fit, …)` — that orphaned a single tile onto its own
 * row at some widths. Six divides evenly by two and three, so no row is short.
 */
defineProps<{ week: WeekSlot[] }>()

const isWide = useWide()

/** The rail beside an event, in whoever's colour it is. Neutral for the house. */
function railStyle(hue: number | null) {
  return hue === null ? undefined : { background: `oklch(0.72 0.13 ${hue})` }
}
</script>

<template>
  <section class="flex flex-none flex-col gap-2">
    <div
      v-if="!isWide"
      class="flex items-center justify-between gap-3 px-1"
    >
      <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
        Rest of the week
      </h2>
      <UButton
        color="primary"
        variant="link"
        size="sm"
        label="Plan"
        to="/plan"
        :ui="{ base: 'p-0' }"
      />
    </div>

    <!--
      One tile per night. On a phone it lies down — the day beside the meal
      rather than above it — because six stacked tiles of centred text is a lot
      of scrolling for six short facts.
    -->
    <div class="flex flex-col gap-2 lg:grid lg:grid-cols-6 lg:gap-3">
      <div
        v-for="slot in week"
        :key="slot.date"
        class="flex min-w-0 gap-3 rounded-lg p-3 transition-colors sm:p-4 lg:flex-col lg:gap-0"
        :class="slot.highlighted
          ? 'bg-primary/10 ring ring-primary/25'
          : 'bg-elevated/40 ring ring-default hover:bg-elevated'"
      >
        <div
          class="flex shrink-0 flex-col lg:w-full lg:flex-row lg:items-baseline lg:justify-between lg:gap-2"
          :class="isWide ? '' : 'w-11'"
        >
          <span
            class="text-sm font-medium"
            :class="slot.highlighted ? 'text-primary' : 'text-muted'"
          >{{ slot.day }}</span>
          <span class="font-mono text-xs text-dimmed">{{ slot.dateLabel }}</span>
        </div>

        <div class="flex min-w-0 flex-1 flex-col lg:mt-3">
          <p
            class="text-pretty text-sm leading-[1.4]"
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

          <div
            v-if="slot.events.length"
            class="mt-auto flex min-w-0 flex-col gap-1 pt-2"
          >
            <span
              v-for="event in slot.events"
              :key="event.id"
              class="flex min-w-0 items-center gap-1.5"
            >
              <span
                class="h-3 w-0.5 shrink-0 rounded-sm bg-accented"
                :style="railStyle(event.hue)"
              />
              <span class="truncate text-[11px] text-dimmed">{{ event.title }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
