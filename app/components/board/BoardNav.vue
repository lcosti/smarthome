<script setup lang="ts">
/**
 * The board's only navigation, in the empty middle of the header.
 *
 * Four views, always all four, never a menu: on a wall the whole point is that
 * getting somewhere costs one press and no reading. Anything that hides a
 * destination behind a tap loses to walking to the fridge.
 *
 * The header itself does not change between views — it is the one thing that
 * stays put — so this sits inside it rather than above whatever is below.
 */
const route = useRoute()

const VIEWS = [
  { label: 'Today', to: '/board' },
  { label: 'List', to: '/board/list' },
  { label: 'Week', to: '/board/week' },
  { label: 'Recipes', to: '/board/recipes' }
]

// Exact for Today, prefix for the rest, so an open recipe still lights Recipes.
function isActive(to: string) {
  return to === '/board' ? route.path === '/board' : route.path.startsWith(to)
}
</script>

<template>
  <nav class="flex items-center gap-2">
    <NuxtLink
      v-for="view in VIEWS"
      :key="view.to"
      :to="view.to"
      class="rounded-full px-7 py-3 font-mono text-[21px] uppercase tracking-[0.14em]
             transition-opacity duration-[80ms] active:opacity-85"
      :class="isActive(view.to)
        ? 'bg-elevated text-highlighted ring-1 ring-default'
        : 'text-dimmed'"
    >
      {{ view.label }}
    </NuxtLink>
  </nav>
</template>
