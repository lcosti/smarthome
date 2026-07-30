<script setup lang="ts">
import type { ItemRow } from '../utils/db'

const { item, aisleName = null } = defineProps<{
  item: ItemRow
  /** Shown only in the done list, where items are no longer grouped by aisle. */
  aisleName?: string | null
}>()

defineEmits<{
  toggle: []
  edit: []
}>()
</script>

<template>
  <li class="flex items-stretch border-b border-default last:border-b-0">
    <!-- Deliberately large: this gets tapped one-handed, in a coat, pushing a trolley. -->
    <button
      type="button"
      class="flex flex-1 items-center gap-3 py-3 pl-1 pr-2 text-left min-h-12 active:bg-elevated/60"
      @click="$emit('toggle')"
    >
      <UIcon
        :name="item.checked ? 'i-lucide-circle-check-big' : 'i-lucide-circle'"
        class="size-6 shrink-0"
        :class="item.checked ? 'text-primary' : 'text-dimmed'"
      />
      <span class="min-w-0 flex-1">
        <span
          class="block truncate"
          :class="item.checked ? 'text-muted line-through' : ''"
        >{{ item.name }}</span>
        <span
          v-if="item.quantity || aisleName"
          class="block truncate text-xs text-dimmed"
        >
          {{ [item.quantity, aisleName].filter(Boolean).join(' · ') }}
        </span>
      </span>
    </button>

    <UButton
      icon="i-lucide-pencil"
      color="neutral"
      variant="ghost"
      :aria-label="`Edit ${item.name}`"
      class="self-center"
      @click="$emit('edit')"
    />
  </li>
</template>
