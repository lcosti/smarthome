<script setup lang="ts">
import { useListStore } from '../stores/list'
import type { PlannedNight } from '../stores/plan'

/**
 * The week in five numbers, at the top of the aside.
 *
 * Not a dashboard — answers to questions a plan raises and cannot answer from
 * any single night: is it finished, how much cooking did I just sign up for, is
 * one night going to ambush me, and what does it cost at the shop.
 *
 * How full the week is leads, because it is the one the buttons above act on,
 * and it is a bar as well as a fraction: "3 of 7" is a number to read, a bar
 * that is half empty is a week you can see is half empty. The other four sit
 * under it in a grid, plain label over value.
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
      return minutes > 0 ? { date: night.date, minutes, name: planned.recipe?.name ?? null } : null
    })
    .filter(effort => effort !== null)
)

const plannedCount = computed(() => nights.filter(night => night.entries.length).length)

/** "2h 10m", "45m" — hours only once there are any. */
function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

const totalMinutes = computed(() => efforts.value.reduce((sum, effort) => sum + effort.minutes, 0))

const longest = computed(() =>
  efforts.value.reduce<{ date: string, minutes: number, name: string | null } | null>(
    (worst, effort) => (!worst || effort.minutes > worst.minutes ? effort : worst),
    null
  )
)

/**
 * "Chicken · 55m" — the dish, not the day.
 *
 * Which night the long cook falls on is on the card; which dish it is is the
 * thing you would change your mind about. One word of it is enough to recognise
 * it in a column this narrow.
 */
const longestLabel = computed(() => {
  if (!longest.value) return '—'
  const name = longest.value.name?.split(' ')[0]
  const time = duration(longest.value.minutes)
  return name ? `${name} · ${time}` : time
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
  return list.liveItems.filter(
    item => !item.checked && item.plan_entry_id && entryIds.has(item.plan_entry_id)
  ).length
})

const blocks = computed(() => [
  {
    label: 'Time at the stove',
    value: totalMinutes.value ? duration(totalMinutes.value) : '—'
  },
  {
    label: 'Longest cook',
    value: longestLabel.value
  },
  {
    label: 'To buy',
    value: toBuy.value ? `${toBuy.value} items` : 'nothing'
  },
  {
    label: 'Empty nights',
    value: `${nights.length - plannedCount.value}`
  }
])
</script>

<template>
  <UCard
    variant="subtle"
    :ui="{ body: 'flex flex-col gap-4 px-4 py-3.5 sm:p-4' }"
  >
    <div>
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="text-sm font-medium text-highlighted">
          Nights planned
        </h3>
        <p class="text-sm text-dimmed tabular-nums">
          {{ plannedCount }} of {{ nights.length }}
        </p>
      </div>
      <UProgress
        :model-value="plannedCount"
        :max="nights.length"
        size="sm"
        class="mt-2.5"
      />
    </div>

    <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
      <div
        v-for="block in blocks"
        :key="block.label"
        class="min-w-0"
      >
        <dt class="truncate text-xs text-dimmed">
          {{ block.label }}
        </dt>
        <dd class="mt-0.5 truncate text-sm font-medium text-highlighted">
          {{ block.value }}
        </dd>
      </div>
    </dl>
  </UCard>
</template>
