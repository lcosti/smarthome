<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { useSyncStore } from '../stores/sync'
import { buildHeader } from '../utils/board'

/**
 * The desktop header: day, date, week, weather, navigation, and how much of
 * this the app still believes.
 *
 * The wide layout's equivalent of the phone's bottom tab bar. It stays put
 * while the view beneath it changes, which is why the navigation lives in its
 * middle rather than above the content it switches between.
 *
 * The staleness pill is the only place the app admits to a problem, and it says
 * it in words rather than with an icon on its own — "Offline · last synced
 * 15:58" tells you how much to trust the rest of the screen, which a red dot
 * does not. It sits beside the plan badge rather than replacing it: the two
 * answer different questions and both can be true at once.
 *
 * Three groups, and the outer two must not shrink. Letting them do so was a
 * real bug — at narrow widths the bar clipped the date and the temperature
 * instead of wrapping.
 */

const sync = useSyncStore()

const now = useBoardClock()
const nights = useBoardNights(now)
const { weather } = useWeather()

const header = computed(() =>
  buildHeader({
    now: now.value,
    nights: nights.value,
    offline: sync.offline,
    lastSyncedAt: sync.lastSyncedAt,
    weather: weather.value
  })
)

/**
 * Four destinations, always all four, never a menu: getting somewhere should
 * cost one press and no reading.
 *
 * `exact` on the list only, so an open recipe lights Recipes rather than
 * lighting both it and the list.
 */
const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Today', to: '/today' },
  { label: 'List', to: '/', exact: true },
  { label: 'Plan', to: '/plan' },
  { label: 'Recipes', to: '/recipes' }
])
</script>

<template>
  <header
    class="sticky top-0 z-20 flex min-h-16 flex-none flex-wrap items-center justify-between
           gap-x-6 gap-y-3 border-b border-default bg-default/85 px-6 py-3 backdrop-blur"
  >
    <div class="flex flex-none items-center gap-3 whitespace-nowrap">
      <h1 class="text-xl font-semibold leading-none tracking-[-0.02em] text-highlighted">
        {{ header.dayName }}
      </h1>
      <span class="h-5 w-px bg-elevated" />
      <p class="text-sm text-muted">
        {{ header.dateLine }}
      </p>
      <UBadge
        color="primary"
        variant="subtle"
        :label="header.weekLabel"
        :ui="{ base: 'rounded-md px-2 py-1 text-xs font-medium leading-none' }"
      />

      <!--
        Weather sits with the day and the date rather than over with the badges:
        it is another fact about today, not a status of the app.
      -->
      <div
        v-if="header.weather"
        class="flex items-center gap-2"
      >
        <UIcon
          :name="header.weather.icon"
          class="size-4 text-primary"
        />
        <span class="text-base font-medium leading-none text-highlighted tabular-nums">
          {{ header.weather.temperature }}°
        </span>
      </div>
    </div>

    <!--
      A segmented control rather than a row of links: the four views are one
      choice, and the recessed pill around them says so before anything is read.

      The active state is styled off `data-active`, which reka-ui puts on the
      anchor. `before:hidden` removes the theme's own hover pill, which would
      otherwise sit under this one at a different radius, and `py-0` on the item
      removes the theme's `py-2`, which reserves room for a highlight underline
      this nav does not use.
    -->
    <UNavigationMenu
      :items="items"
      color="neutral"
      :ui="{
        root: 'w-auto',
        list: 'gap-1 rounded-lg bg-elevated/50 p-1 ring ring-default',
        item: 'py-0',
        link: `rounded-md px-3 py-1.5 text-sm font-medium text-muted transition-colors
               before:hidden hover:bg-elevated/60 hover:text-default
               data-[active]:bg-default data-[active]:text-highlighted
               data-[active]:ring data-[active]:ring-accented`,
        linkLabel: 'truncate'
      }"
    />

    <div class="ml-auto flex flex-none items-center gap-3 whitespace-nowrap">
      <UBadge
        :color="header.plan.generated ? 'primary' : 'neutral'"
        variant="subtle"
        :ui="{ base: 'gap-1.5 rounded-md px-2 py-1 text-xs font-medium leading-none' }"
      >
        <span
          class="size-1.5 rounded-full"
          :class="header.plan.generated ? 'bg-primary' : 'bg-[var(--ui-text-dimmed)]'"
        />
        {{ header.plan.label }}
      </UBadge>

      <!--
        Neutral with an amber dot, not an amber badge: this is a note about how
        old the screen is, not a second plan badge, and the two sitting side by
        side in the same colour would read as one sentence.
      -->
      <UBadge
        v-if="header.stale"
        color="neutral"
        variant="subtle"
        :ui="{ base: 'gap-1.5 rounded-md px-2 py-1 text-xs font-medium leading-none' }"
      >
        <span class="size-1.5 rounded-full bg-primary" />
        {{ header.staleLabel }}
      </UBadge>

      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-settings"
        to="/settings"
        aria-label="Settings"
        :ui="{ base: 'p-1.5' }"
      />
    </div>
  </header>
</template>
