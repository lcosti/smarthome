<script setup lang="ts">
import { useListStore } from '../stores/list'
import type { PlannedNight } from '../stores/plan'

/**
 * The week in four numbers, in the eighth cell of a seven-night grid.
 *
 * Not a dashboard — four answers to questions a plan raises and cannot answer
 * from any single night: is it finished, how much cooking did I just sign up
 * for, is one night going to ambush me, and what does it cost at the shop.
 *
 * The two counts deliberately measure different things. "To buy" is what is
 * outstanding on the list right now; the button above says what pressing it
 * would change. A week can be fully shopped and still have items to buy.
 */
const { nights } = defineProps<{ nights: PlannedNight[] }>()

const list = useListStore()

/** Cooking minutes per night. A leftovers night is reheating, and costs nothing. */
const efforts = computed(() =>
  nights
    .map((night) => {
      const planned = night.entries[0]
      if (!planned || planned.leftover) return null
      const minutes = (planned.recipe?.prep_minutes ?? 0) + (planned.recipe?.cook_minutes ?? 0)
      return minutes > 0 ? { date: night.date, minutes } : null
    })
    .filter(effort => effort !== null)
)

const plannedCount = computed(() => nights.filter(night => night.entries.length).length)

/** "4 hr 20 min", "45 min" — hours only once there are any. */
function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

const totalMinutes = computed(() => efforts.value.reduce((sum, effort) => sum + effort.minutes, 0))

const longest = computed(() =>
  efforts.value.reduce<{ date: string, minutes: number } | null>(
    (worst, effort) => (!worst || effort.minutes > worst.minutes ? effort : worst),
    null
  )
)

const longestDay = computed(() => {
  if (!longest.value) return null
  const [year, month, day] = longest.value.date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'long' })
})

/**
 * What is still outstanding at the shop for this week's nights.
 *
 * Only items the plan itself put there, and only the ones nobody has ticked —
 * an ad-hoc "bin bags" is a real errand but it is not something this week's
 * dinners are waiting on.
 */
const toBuy = computed(() => {
  const entryIds = new Set(
    nights.flatMap(night => night.entries.map(planned => planned.entry.id))
  )
  const items = list.liveItems.filter(
    item => !item.checked && item.plan_entry_id && entryIds.has(item.plan_entry_id)
  )
  return {
    count: items.length,
    meals: new Set(items.map(item => item.plan_entry_id)).size
  }
})

const blocks = computed(() => [
  {
    label: 'Nights planned',
    value: `${plannedCount.value}/7`,
    note: plannedCount.value === 7
      ? 'the week is done'
      : `${7 - plannedCount.value} still open`
  },
  {
    label: 'Time at the stove',
    value: totalMinutes.value ? duration(totalMinutes.value) : '—',
    note: `${efforts.value.length} cooking night${efforts.value.length === 1 ? '' : 's'}`
  },
  {
    label: 'Longest cook',
    value: longest.value ? duration(longest.value.minutes) : '—',
    note: longestDay.value ?? 'nothing long this week'
  },
  {
    label: 'To buy',
    value: `${toBuy.value.count}`,
    note: toBuy.value.count
      ? `across ${toBuy.value.meals} meal${toBuy.value.meals === 1 ? '' : 's'}`
      : 'nothing outstanding'
  }
])
</script>

<template>
  <div class="flex min-h-0 flex-col justify-between gap-2 overflow-hidden rounded-lg bg-elevated/50 px-3.5 py-3 ring ring-default">
    <div
      v-for="block in blocks"
      :key="block.label"
      class="min-h-0"
    >
      <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-dimmed">
        {{ block.label }}
      </p>
      <p class="mt-0.5 truncate text-xl font-semibold leading-none tracking-[-0.02em] text-primary">
        {{ block.value }}
      </p>
      <p class="mt-1 truncate text-xs text-dimmed">
        {{ block.note }}
      </p>
    </div>
  </div>
</template>
