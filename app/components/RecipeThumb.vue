<script setup lang="ts">
/**
 * A recipe's picture at the size everything that lists recipes shows one — the
 * library rows, a night on the plan, a meal being offered.
 *
 * Only a recipe that has a picture reserves room for one. A library that is half
 * imported and half typed would otherwise be a column of empty grey squares,
 * which reads as broken rather than as plain — so this renders nothing at all
 * without a source, and every caller is laid out to look right that way.
 *
 * One size. If a surface wants a different one, widen this rather than passing
 * classes in, or the answer to "what does a recipe thumbnail look like" stops
 * being one answer.
 */
defineProps<{
  src: string | null
  alt: string
}>()
</script>

<template>
  <span
    v-if="src"
    class="size-12 shrink-0 overflow-hidden rounded-md bg-elevated/50"
  >
    <RecipeImage
      :src="src"
      :alt="alt"
    />
  </span>
</template>
