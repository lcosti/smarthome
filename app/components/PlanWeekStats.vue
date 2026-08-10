<script setup lang="ts">
import { useListStore } from '../stores/list'
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { duration, weekStats } from '../utils/plan-stats'

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
const plan = usePlanStore()

// The same arithmetic the phone's progress bar and the review summary run, so
// none of the three can quietly disagree about how full the week is — including
// which nights it is counting: a week the house is away for four nights of is
// "3 of 3", not "3 of 7" with four holes nobody is going to fill.
const stats = computed(() => weekStats(nights, date => plan.nobodyEatingOn(date)))
const plannedCount = computed(() => stats.value.plannedCount)

/**
 * "Chicken · 55m" — the dish, not the day.
 *
 * Which night the long cook falls on is on the card; which dish it is is the
 * thing you would change your mind about. One word of it is enough to recognise
 * it in a column this narrow.
 */
const longestLabel = computed(() => {
  const longest = stats.value.longest
  if (!longest) return '—'
  const name = longest.name?.split(' ')[0]
  const time = duration(longest.minutes)
  return name ? `${name} · ${time}` : time
})

/** What is still outstanding at the shop for this week's nights. */
const toBuy = computed(() =>
  list.outstandingForEntries(
    new Set(nights.flatMap(night => night.entries.map(planned => planned.entry.id)))
  )
)

const blocks = computed(() => [
  {
    label: 'Time at the stove',
    value: stats.value.totalMinutes ? duration(stats.value.totalMinutes) : '—'
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
    value: `${stats.value.emptyCount}`
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
          {{ plannedCount }} of {{ stats.total }}
        </p>
      </div>
      <!-- `|| 1` for the week the whole house is away for: nothing to divide by. -->
      <UProgress
        :model-value="plannedCount"
        :max="stats.total || 1"
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
