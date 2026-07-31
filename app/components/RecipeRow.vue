<script setup lang="ts">
const { name, ingredientCount, servings, imageUrl } = defineProps<{
  name: string
  ingredientCount: number
  servings: number
  imageUrl?: string | null
}>()

defineEmits<{ select: [] }>()

const summary = computed(() => {
  const lines = ingredientCount === 1 ? '1 ingredient' : `${ingredientCount} ingredients`
  return `${lines} · serves ${servings}`
})
</script>

<template>
  <li class="border-b border-default last:border-b-0">
    <button
      type="button"
      class="flex min-h-12 w-full items-center gap-3 px-3 py-3 text-left active:bg-elevated/60"
      @click="$emit('select')"
    >
      <!--
        Only rows that have a picture reserve room for one. A library that is
        half imported and half typed would otherwise be a column of empty grey
        squares, which reads as broken rather than as plain.
      -->
      <span
        v-if="imageUrl"
        class="size-12 shrink-0 overflow-hidden rounded-md bg-elevated/50"
      >
        <RecipeImage
          :src="imageUrl"
          :alt="name"
        />
      </span>

      <span class="min-w-0 flex-1">
        <span class="block truncate">{{ name }}</span>
        <span class="block truncate text-sm text-dimmed">{{ summary }}</span>
      </span>
      <UIcon
        name="i-lucide-chevron-right"
        class="size-5 shrink-0 text-dimmed"
      />
    </button>
  </li>
</template>
