<script setup lang="ts">
/**
 * The photograph a recipe was imported with.
 *
 * The address points at the source site's CDN rather than at anything this app
 * stores, which decides everything else here. It can 404 the day the site
 * reorganises, so a failure renders nothing at all: no broken-image glyph, no
 * empty frame holding space. A recipe without its picture is a plainer page, and
 * every surface that uses this is built to look right without one.
 *
 * Offline is the service worker's job — nuxt.config.ts caches these on first
 * view — so there is nothing to do here but let the request happen.
 */
const { src, alt } = defineProps<{
  src: string | null
  alt: string
}>()

const failed = ref(false)

// A recipe can be re-imported, or its address edited on another device. Without
// this the component would stay blank for the rest of the session on the
// strength of one dead address.
watch(() => src, () => {
  failed.value = false
})
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="alt"
    loading="lazy"
    decoding="async"
    class="size-full object-cover"
    @error="failed = true"
  >
</template>
