<script setup lang="ts">
const route = useRoute()

const tabs = [
  { to: '/', icon: 'i-lucide-home', label: 'Today' },
  { to: '/shopping', icon: 'i-lucide-shopping-cart', label: 'List' },
  { to: '/plan', icon: 'i-lucide-calendar-days', label: 'Plan' },
  { to: '/recipes', icon: 'i-lucide-book-open', label: 'Recipes' }
]

// Prefix match on everything but Today, so /recipes/some-id keeps Recipes lit.
// Today is '/', which prefixes every route, so it has to match exactly.
function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <!--
    Hand-rolled rather than UNavigationMenu: this is four links and a safe-area
    inset, and fighting a menu component's layout costs more than it saves.
    pb-[env(safe-area-inset-bottom)] keeps the labels off the iPhone home
    indicator — the only place in the app that needs it.

    A plain flex child of the shell, not fixed: it is the bottom of a column that
    is exactly one viewport tall, so nothing can scroll it away.
  -->
  <nav class="shrink-0 border-t border-default bg-default pb-[env(safe-area-inset-bottom)]">
    <div class="mx-auto flex max-w-xl">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        :aria-current="isActive(tab.to) ? 'page' : undefined"
        class="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 active:bg-elevated/60"
        :class="isActive(tab.to) ? 'text-primary' : 'text-dimmed'"
      >
        <UIcon
          :name="tab.icon"
          class="size-6"
        />
        <span class="text-[11px] font-medium">{{ tab.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
