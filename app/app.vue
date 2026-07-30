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
    <NuxtPage />
    <AppTabBar v-if="showTabs" />
  </UApp>
</template>
