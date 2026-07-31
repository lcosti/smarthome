<script setup lang="ts">
import { useListStore } from '../../stores/list'
import { useSyncStore } from '../../stores/sync'

/**
 * The shopping list at wall size.
 *
 * The one view that is genuinely a tool rather than a display: this is the
 * screen you stand in front of while unpacking bags, so the whole line is the
 * touch target and ticking is one press with no confirmation. Ticking is
 * idempotent and converges by last-write-wins, so two people doing it from
 * different rooms is a non-event.
 *
 * Laid out in columns rather than one long list, because the frame cannot
 * scroll: a shop's worth of items has to fit at a readable size, and three
 * columns of a 1920px frame is what makes that possible.
 */

const list = useListStore()
const sync = useSyncStore()

/**
 * Aisle groups spread over three columns, kept whole and kept in order.
 *
 * In order because the sequence is the point — the list is sorted to match the
 * walk through the shop, so it has to read down column one, then column two.
 * Whole because a group split across a column break would put half of Chilled at
 * the bottom of one column and half at the top of the next.
 *
 * The split is chosen by trying every one, rather than by filling greedily.
 * There are only ever a couple of dozen aisles, so the search is free, and
 * greedy gets this visibly wrong: it packs the first column past the fold and
 * leaves the third nearly empty, which on a frame that cannot scroll means
 * items you simply never see.
 */
const columns = computed(() => {
  const groups = list.groups
  if (!groups.length) return [] as (typeof groups)[]

  const weight = (group: typeof groups[number]) => group.entries.length + 1

  let best: number[] | null = null
  let bestMax = Infinity

  // Two cut points, i and j, giving [0,i) [i,j) [j,end).
  for (let i = 0; i <= groups.length; i++) {
    for (let j = i; j <= groups.length; j++) {
      const parts = [groups.slice(0, i), groups.slice(i, j), groups.slice(j)]
      const max = Math.max(...parts.map(part => part.reduce((sum, g) => sum + weight(g), 0)))
      if (max < bestMax) {
        bestMax = max
        best = [i, j]
      }
    }
  }

  const [i, j] = best!
  return [groups.slice(0, i), groups.slice(i, j), groups.slice(j)]
})

const remaining = computed(() => list.groups.reduce((sum, g) => sum + g.entries.length, 0))
const checked = computed(() => list.checkedItems.length)

/** Cleared before a shop, or never used at all. Only the first earns green. */
const everUsed = computed(() => sync.rowsOf('shopping_list_items').size > 0)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-[18px]">
    <div class="flex shrink-0 items-baseline gap-[18px]">
      <h2 class="text-[58px] font-semibold leading-none tracking-[-0.03em] text-highlighted">
        {{ remaining }}
      </h2>
      <p class="text-[28px] text-muted">
        {{ remaining === 1 ? 'thing' : 'things' }} to buy
      </p>
      <p
        v-if="checked"
        class="ml-auto font-mono text-[20px] text-dimmed"
      >
        {{ checked }} in the trolley
      </p>
      <p
        v-if="sync.pendingCount"
        class="font-mono text-[20px] text-dimmed"
        :class="checked ? 'ml-4' : 'ml-auto'"
      >
        {{ sync.pendingCount }} waiting to sync
      </p>
    </div>

    <!-- Nothing to buy: the same distinction the Today card makes. -->
    <UEmpty
      v-if="!remaining"
      :icon="everUsed ? 'i-lucide-circle-check-big' : 'i-lucide-shopping-cart'"
      :title="everUsed ? 'Nothing to buy' : 'Nothing on the list yet'"
      description="Add something from your phone and it shows up here."
      class="flex-1"
      :ui="{
        avatar: everUsed ? 'size-16 bg-transparent text-primary' : 'size-16 bg-transparent text-dimmed',
        title: everUsed
          ? 'text-[64px] font-semibold tracking-[-0.02em] text-primary'
          : 'text-[64px] font-semibold tracking-[-0.02em] text-muted',
        description: 'text-[26px] text-muted'
      }"
    />

    <div
      v-else
      class="grid min-h-0 flex-1 grid-cols-3 gap-[22px] overflow-hidden"
    >
      <div
        v-for="(column, index) in columns"
        :key="index"
        class="flex min-h-0 flex-col gap-[18px] overflow-hidden"
      >
        <UCard
          v-for="group in column"
          :key="group.id"
          variant="outline"
          :ui="{
            root: 'rounded-2xl bg-elevated',
            header: 'px-6 pt-4 pb-2 sm:px-6',
            body: 'px-4 pb-3 pt-0 sm:p-0 sm:px-4 sm:pb-3'
          }"
        >
          <template #header>
            <h3 class="font-mono text-[20px] uppercase tracking-[0.14em] text-dimmed">
              {{ group.name }}
            </h3>
          </template>

          <!--
            A real checkbox rather than a button that looks like one: ticking an
            item off is exactly what the control means, and it brings the
            keyboard and screen-reader behaviour with it. The label is the whole
            row, so anywhere on the line is a hit — which is what matters with a
            bag of shopping in one hand.
          -->
          <UCheckbox
            v-for="entry in group.entries"
            :key="entry.key"
            :model-value="false"
            color="primary"
            size="xl"
            :ui="{
              root: 'items-center gap-4 rounded-[12px] px-2 py-2.5 transition-opacity duration-[80ms] active:opacity-85',
              base: 'size-7 shrink-0',
              wrapper: 'min-w-0 flex-1',
              label: 'w-full text-[27px] leading-tight text-default'
            }"
            @update:model-value="list.toggleEntry(entry)"
          >
            <template #label>
              <span class="flex w-full min-w-0 items-baseline gap-3">
                <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
                <span
                  v-if="entry.quantityLabel"
                  class="shrink-0 whitespace-nowrap text-[23px] text-muted"
                >{{ entry.quantityLabel }}</span>
              </span>
            </template>
          </UCheckbox>
        </UCard>
      </div>
    </div>
  </div>
</template>
