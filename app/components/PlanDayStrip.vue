<script setup lang="ts">
import type { PlannedNight } from '../stores/plan'

/**
 * The week as seven pills, above a page that shows one night at a time.
 *
 * Two jobs at once, which is why it earns the width: it is how you get to a
 * night out of order — Thursday is the one you had a thought about — and it is
 * the only place the whole week is visible while you are deep in the middle of
 * it. The dot is the second job. Filled means the night is dealt with, which
 * includes a night somebody said they were not cooking on, because a takeaway is
 * a decision and not a hole.
 *
 * A night nobody is eating on is faded rather than filled: there is no dinner on
 * it, so the dot would be claiming one, and it is the fade that says the week is
 * not waiting on that day. The card under it wears the same fade.
 *
 * The tile is a stock `UButton` with its content stacked, the same shape the
 * wall board's week strip uses — a day is a thing you press, and the selected
 * one wears the accent everything else on this page is wearing.
 */
const { nights, noOneEating, selected, today } = defineProps<{
  nights: PlannedNight[]
  /**
   * The nights nobody is eating on, passed in rather than looked up, so the
   * pills and the cards under them cannot disagree about which day is away.
   */
  noOneEating: Set<string>
  selected: string
  today: string
}>()

const emit = defineEmits<{ select: [date: string] }>()

const days = computed(() =>
  nights.map((night) => {
    const [year, month, day] = night.date.split('-').map(Number)
    const date = new Date(year!, month! - 1, day!)
    return {
      date: night.date,
      // 'short' rather than 'narrow': narrow gives one letter, and one letter
      // makes Tuesday, Thursday and Saturday, Sunday two pairs you have to
      // count along the row to tell apart.
      weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
      day: date.getDate(),
      planned: night.entries.length > 0,
      // Faded like the card it stands for. Not "planned", though — that dot
      // means a dinner exists, and there isn't one.
      away: noOneEating.has(night.date) && !night.entries.length,
      isToday: night.date === today,
      isSelected: night.date === selected
    }
  })
)

/** Read out in full, because "M 11" is not a date anybody can hear. */
function labelOf(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
    .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}
</script>

<template>
  <div class="flex items-stretch gap-1.5">
    <UButton
      v-for="entry in days"
      :key="entry.date"
      color="neutral"
      :variant="entry.isSelected ? 'soft' : 'ghost'"
      :aria-label="labelOf(entry.date)"
      :aria-current="entry.isSelected ? 'true' : undefined"
      class="flex-1 flex-col gap-1 px-0 py-2 ring ring-inset transition-colors"
      :class="[
        entry.isSelected
          ? 'bg-primary/10 ring-primary/50 hover:bg-primary/15'
          : 'bg-elevated/50 ring-default',
        entry.away && !entry.isSelected ? 'opacity-60' : ''
      ]"
      @click="emit('select', entry.date)"
    >
      <span
        class="text-[11px] font-semibold"
        :class="entry.isSelected ? 'text-primary' : 'text-dimmed'"
      >{{ entry.weekday }}</span>

      <!--
        Today is underlined rather than filled. The fill means "this is the night
        on screen", and a Monday wearing both would be saying two things with one
        mark.
      -->
      <span
        class="text-sm font-semibold tabular-nums"
        :class="[
          entry.isSelected ? 'text-primary' : 'text-highlighted',
          entry.isToday && !entry.isSelected ? 'underline decoration-primary decoration-2 underline-offset-4' : ''
        ]"
      >{{ entry.day }}</span>

      <!--
        Dealt with, or still to decide. Filled and hollow rather than two
        colours, because at this size a colour is a smudge and a hole is a hole.
      -->
      <span
        class="size-1.5 rounded-full"
        :class="entry.planned ? 'bg-primary' : 'ring ring-inset ring-accented'"
      />
    </UButton>
  </div>
</template>
