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
  <!--
    A segmented control rather than a row of links: the four views are one
    choice, and the recessed pill around them says so before anything is read.

    The active state is styled off `data-active`, which reka-ui puts on the
    anchor. `before:hidden` removes the theme's own hover pill, which would
    otherwise sit under this one at a different radius, and `py-0` on the item
    removes the theme's `py-2`, which reserves room for a highlight underline
    this nav does not use and otherwise leaves the pill three times looser
    above and below the tabs than it is beside them.
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
</template>
