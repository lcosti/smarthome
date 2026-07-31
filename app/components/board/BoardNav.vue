<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/**
 * The board's only navigation, in the empty middle of the header.
 *
 * Four views, always all four, never a menu: on a wall the whole point is that
 * getting somewhere costs one press and no reading. Anything that hides a
 * destination behind a tap loses to walking to the fridge.
 *
 * The header itself does not change between views — it is the one thing that
 * stays put — so this sits inside it rather than above whatever it switches.
 *
 * `exact` on Today only, so an open recipe still lights Recipes rather than
 * lighting both it and the home view.
 */
const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Today', to: '/board', exact: true },
  { label: 'List', to: '/board/list' },
  { label: 'Week', to: '/board/week' },
  { label: 'Recipes', to: '/board/recipes' }
])
</script>

<template>
  <UNavigationMenu
    :items="items"
    highlight
    highlight-color="warning"
    color="neutral"
    :ui="{
      root: 'w-auto',
      list: 'gap-2',
      link: 'px-7 py-3 font-mono text-[21px] uppercase tracking-[0.14em] rounded-full transition-opacity duration-[80ms] active:opacity-85',
      linkLabel: 'truncate'
    }"
  />
</template>
