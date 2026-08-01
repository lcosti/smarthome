<script setup lang="ts">
/**
 * A recipe's photograph, from either of the two places one can come from — see
 * `pictureOf` in utils/photo.ts, which every caller resolves through.
 *
 * A picture somebody took here arrives as a data URL out of the row itself and
 * cannot fail. An imported one is an address on the source site's CDN, and that
 * can 404 the day the site reorganises, which decides everything else here: a
 * failure renders nothing at all — no broken-image glyph, no empty frame holding
 * space. A recipe without its picture is a plainer page, and every surface that
 * uses this is built to look right without one.
 *
 * Offline is the service worker's job for the imported ones — nuxt.config.ts
 * caches those on first view — and no job at all for the household's own, which
 * are already in IndexedDB. So there is nothing to do here but let the request
 * happen.
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
