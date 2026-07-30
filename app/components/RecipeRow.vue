<script setup lang="ts">
const { name, ingredientCount, servings } = defineProps<{
  name: string
  ingredientCount: number
  servings: number
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
