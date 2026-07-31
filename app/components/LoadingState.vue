<script setup lang="ts">
/**
 * The gap between opening the app and IndexedDB handing over its rows.
 *
 * Rows rather than the word "Loading", because on a phone in a shop this is
 * usually over in a frame or two and a skeleton the shape of the list reads as
 * the list arriving rather than as the app stopping to think.
 */
const { rows = 4 } = defineProps<{ rows?: number }>()
</script>

<template>
  <div
    class="flex flex-col gap-2 py-4"
    aria-busy="true"
    aria-label="Loading"
  >
    <USkeleton
      v-for="row in rows"
      :key="row"
      class="h-12 w-full"
    />
  </div>
</template>
