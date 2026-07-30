<script setup lang="ts">
const route = useRoute()

useSync()

// Signing in and setting up a household are one-way flows; a tab bar there would
// just be three ways to get lost.
const CHROMELESS = ['/login', '/welcome']
const showTabs = computed(() => !CHROMELESS.includes(route.path))
</script>

<template>
  <UApp>
    <!--
      The app shell is exactly one viewport tall and never scrolls. Each page puts
      its header and its scrolling <main> inside this column, so the tab bar stays
      on screen no matter how long the list gets — a fixed bar would be pushed out
      of the visual viewport the moment anything scrolled sideways.
    -->
    <div class="flex h-dvh flex-col overflow-hidden">
      <div class="flex min-h-0 flex-1 flex-col">
        <NuxtPage />
      </div>
      <AppTabBar v-if="showTabs" />
    </div>
  </UApp>
</template>
