<script setup lang="ts">
const { name, quantity = null, aisleName = null, canMoveUp, canMoveDown } = defineProps<{
  name: string
  quantity?: string | null
  aisleName?: string | null
  canMoveUp: boolean
  canMoveDown: boolean
}>()

defineEmits<{ edit: [], moveUp: [], moveDown: [] }>()

const detail = computed(() => [quantity, aisleName].filter(Boolean).join(' · '))
</script>

<template>
  <li class="flex items-center gap-1 border-b border-default px-1 last:border-b-0">
    <button
      type="button"
      class="min-h-12 min-w-0 flex-1 px-2 py-3 text-left active:bg-elevated/60"
      @click="$emit('edit')"
    >
      <span class="block truncate">{{ name }}</span>
      <span
        v-if="detail"
        class="block truncate text-sm text-dimmed"
      >{{ detail }}</span>
    </button>

    <UButton
      icon="i-lucide-chevron-up"
      size="sm"
      color="neutral"
      variant="ghost"
      :disabled="!canMoveUp"
      :aria-label="`Move ${name} up`"
      @click="$emit('moveUp')"
    />
    <UButton
      icon="i-lucide-chevron-down"
      size="sm"
      color="neutral"
      variant="ghost"
      :disabled="!canMoveDown"
      :aria-label="`Move ${name} down`"
      @click="$emit('moveDown')"
    />
  </li>
</template>
