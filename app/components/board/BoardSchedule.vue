<script setup lang="ts">
import type { BoardModel } from '../../utils/board'

/**
 * Today, drawn to scale.
 *
 * The wall board's main card: a real clock face from the first thing on to the
 * last, with dinner sitting in it as an appointment. Drawn to scale rather than
 * listed, because the useful question in a kitchen is not "what is on today" but
 * "how long have I got" — and a list of five rows answers the first and hides
 * the second.
 *
 * A phone gets the same model as a list. Not a smaller grid: a fourteen-hour
 * clock face at 390px is mostly empty ruled lines, and a phone is read one
 * glance at a time rather than from across a room. The rows, the colours, the
 * chore ticks and the ordering are all the same objects either way — only the
 * geometry differs, so there is one answer to "what is on today" and two ways of
 * drawing it.
 *
 * The now-marker is absent when offline, and that is deliberate rather than an
 * oversight — a board that cannot reach the server cannot honestly draw a line
 * across the day and call it this moment.
 *
 * CUSTOM COMPONENT, replacing nothing in Nuxt UI. The library has no calendar
 * view: `UCalendar` is a date picker, and a day laid out by the minute needs
 * absolute offsets computed at runtime from real times, which cannot be Tailwind
 * classes. Every control inside it is stock — the tick is a `UCheckbox`, the
 * header is a `UButton` and a `UBadge`.
 */
const { schedule } = defineProps<{ schedule: BoardModel['schedule'] }>()

const emit = defineEmits<{ tick: [choreId: string, date: string] }>()

const isWide = useWide()

/** Three times that look like a day, for a card that has no day to show yet. */
const GHOST_RAILS = ['08:00', '13:00', '18:30']

/** The width of the time column, shared by the hours, the rows and the marker. */
const GUTTER = '52px'

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

/** The phone reads the day as one list, all-day things first. */
const listRows = computed(() => [...schedule.allDay, ...schedule.rows])

const grid = ref<HTMLElement | null>(null)

/**
 * Keep now on screen.
 *
 * A waking day is taller than this card on most screens, so the grid scrolls —
 * and the part worth showing is the part being lived. A third of the way down
 * leaves the morning above it and the evening below, which is the same
 * proportion the old list kept when it held two past rows.
 */
function scrollToNow() {
  const element = grid.value
  if (!element) return
  const top = schedule.nowTop * element.scrollHeight
  element.scrollTop = Math.max(0, top - element.clientHeight / 3)
}

// After a frame, not on mount: the grid has no scrollable height until it has
// been laid out, and setting scrollTop before that silently clamps to nothing.
//
// Watched on the height as well as the clock, because the first paint happens
// before Dexie has handed over the day. The grid grows when the rows arrive, and
// a scroll position set against the empty version is a scroll position of zero.
onMounted(() => requestAnimationFrame(scrollToNow))
watch(
  () => [schedule.height, schedule.nowTop],
  () => nextTick(() => requestAnimationFrame(scrollToNow))
)
</script>

<template>
  <UCard
    variant="subtle"
    :ui="{
      header: 'flex flex-none items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4',
      body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0'
    }"
    class="flex flex-none flex-col transition-opacity duration-300 lg:min-h-0"
    :style="{ opacity: schedule.dim ? '0.62' : '1' }"
  >
    <template #header>
      <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed sm:text-base sm:font-semibold sm:normal-case sm:tracking-normal sm:text-highlighted">
        Today
      </h2>
      <div class="flex items-center gap-2">
        <UBadge
          color="neutral"
          variant="subtle"
          :label="schedule.badge"
        />
        <UButton
          v-if="isWide"
          color="primary"
          variant="subtle"
          icon="i-lucide-calendar-cog"
          label="Manage calendar"
          to="/settings"
        />
      </div>
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

    <!--
      Wide: the day to scale. One band across the top for everything that has no
      hour of its own, then a ruled grid holding the rest at their real offsets.
    -->
    <div
      v-else-if="isWide"
      class="flex min-h-0 flex-1 flex-col px-6 pb-6"
    >
      <div
        v-if="schedule.allDay.length"
        class="flex flex-none items-start gap-3 border-b border-default py-3"
      >
        <span
          class="shrink-0 pt-0.5 font-mono text-xs text-dimmed"
          :style="{ width: GUTTER }"
        >All day</span>
        <div class="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-2">
          <div
            v-for="row in schedule.allDay"
            :key="row.id"
            class="flex items-start gap-2.5"
          >
            <span
              class="w-0.5 shrink-0 self-stretch rounded-sm bg-accented"
              :style="railStyle(row.hue)"
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span
                class="truncate text-sm font-medium text-highlighted"
                :class="row.chore?.done ? 'line-through opacity-60' : ''"
              >{{ row.title }}</span>
              <span
                v-if="row.meta"
                class="truncate text-xs text-dimmed"
              >{{ row.meta }}</span>
            </span>
            <UCheckbox
              v-if="row.chore"
              :model-value="row.chore.done"
              :aria-label="`${row.chore.done ? 'Undo' : 'Done'}: ${row.title}`"
              @update:model-value="emit('tick', row.chore.choreId, row.chore.date)"
            />
          </div>
        </div>
      </div>

      <!--
        Only the hours scroll. The all-day band above stays put, because a trip
        that covers today is true at every hour of it and should not be
        scrollable out of the answer.
      -->
      <div
        ref="grid"
        class="relative mt-1 min-h-0 flex-1 overflow-y-auto py-2.5"
      >
        <div
          class="relative h-full"
          :style="{ minHeight: `${schedule.height}px` }"
        >
          <!-- The hours, ruled across the card. -->
          <div
            v-for="hour in schedule.hours"
            :key="hour.top"
            class="absolute inset-x-0"
            :style="{ top: `${hour.top * 100}%` }"
          >
            <span
              v-if="hour.label"
              class="absolute left-0 top-0 -translate-y-1/2 font-mono text-xs text-dimmed"
              :style="{ width: GUTTER }"
            >{{ hour.label }}</span>
            <span
              class="absolute right-0 top-0 h-px bg-default"
              :style="{ left: `calc(${GUTTER} + 0.75rem)` }"
            />
          </div>

          <!--
          Each thing at its own minute, the rail carrying the colour and the
          checkbox the only part of a chore row anybody can press.
        -->
          <div
            v-for="row in schedule.rows"
            :key="row.id"
            class="absolute inset-x-0 flex items-start gap-2.5"
            :style="{ top: `${row.top * 100}%`, opacity: row.past ? '0.5' : '1' }"
          >
            <span
              class="shrink-0 pt-px font-mono text-xs"
              :class="row.meal ? 'text-primary' : 'text-muted'"
              :style="{ width: GUTTER }"
            >{{ row.time }}</span>
            <span
              class="w-0.5 shrink-0 self-stretch rounded-sm"
              :class="row.meal ? 'bg-primary' : 'bg-accented'"
              :style="row.meal ? undefined : railStyle(row.hue)"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                class="truncate text-sm font-medium"
                :class="[
                  row.meal ? 'text-primary' : 'text-highlighted',
                  row.chore?.done ? 'line-through' : ''
                ]"
              >{{ row.title }}</span>
              <span
                v-if="row.meta"
                class="truncate text-xs text-dimmed"
              >{{ row.meta }}</span>
            </span>
            <UCheckbox
              v-if="row.chore"
              :model-value="row.chore.done"
              :aria-label="`${row.chore.done ? 'Undo' : 'Done'}: ${row.title}`"
              @update:model-value="emit('tick', row.chore.choreId, row.chore.date)"
            />
          </div>

          <!--
          The marker keeps the grid's own geometry — a time in the same column, a
          rule where the hours are — so it reads as a moment in the day rather
          than a widget dropped on top of it.
        -->
          <div
            v-if="schedule.nowAt"
            class="absolute inset-x-0 z-10"
            :style="{ top: `${schedule.nowTop * 100}%` }"
          >
            <span
              class="absolute left-0 top-0 -translate-y-1/2 font-mono text-xs font-medium text-primary"
              :style="{ width: GUTTER }"
            >{{ schedule.nowAt }}</span>
            <span
              class="absolute right-0 top-0 h-px bg-primary/70"
              :style="{ left: `calc(${GUTTER} + 0.75rem)` }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Phone: the same day as a list. -->
    <div
      v-else
      class="flex flex-col px-4 pb-3 pt-1"
    >
      <div
        v-for="row in listRows"
        :key="row.id"
        class="flex items-start gap-3 border-b border-default py-3 last:border-b-0"
        :style="{ opacity: row.past ? '0.5' : '1' }"
      >
        <span
          class="w-[42px] shrink-0 pt-px font-mono text-xs leading-[1.3]"
          :class="row.meal ? 'text-primary' : 'text-muted'"
        >{{ row.time }}</span>

        <span
          class="w-0.5 shrink-0 self-stretch rounded-sm"
          :class="row.meal ? 'bg-primary' : 'bg-accented'"
          :style="row.meal ? undefined : railStyle(row.hue)"
        />

        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            class="truncate text-sm font-medium"
            :class="[
              row.meal ? 'text-primary' : 'text-highlighted',
              row.chore?.done ? 'line-through' : ''
            ]"
          >{{ row.title }}</span>
          <span
            v-if="row.meta"
            class="truncate text-xs text-dimmed"
          >{{ row.meta }}</span>
        </span>

        <UCheckbox
          v-if="row.chore"
          :model-value="row.chore.done"
          :aria-label="`${row.chore.done ? 'Undo' : 'Done'}: ${row.title}`"
          @update:model-value="emit('tick', row.chore.choreId, row.chore.date)"
        />
      </div>
    </div>
  </UCard>
</template>
