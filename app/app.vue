<script setup lang="ts">
const route = useRoute()

useSync()

// Signing in and setting up a household are one-way flows; a tab bar there would
// just be three ways to get lost. The wall board is chromeless for a different
// reason: it is a display rather than an app, and it carries its own navigation
// inside the header — a phone tab bar along the bottom of a kiosk would be a
// second, smaller way to do the same thing.
const CHROMELESS = ['/login', '/welcome']
const showTabs = computed(() =>
  !CHROMELESS.includes(route.path) && !route.path.startsWith('/board')
)
</script>

<template>
  <UApp>
    <NuxtPage />
    <AppTabBar v-if="showTabs" />
  </UApp>
</template>
