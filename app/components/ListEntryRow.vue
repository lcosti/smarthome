<script setup lang="ts">
import type { ListEntry } from '../utils/aggregate'
import type { ItemRow } from '../utils/db'

const { entry, sourceLabel = null } = defineProps<{
  entry: ListEntry<ItemRow>
  /** The recipes behind this line, so "why is this here?" has an answer. */
  sourceLabel?: string | null
}>()

defineEmits<{
  toggle: []
  edit: []
}>()

/** More than one row behind this line, so editing means picking one of them. */
const grouped = computed(() => entry.items.length > 1)
</script>

<template>
  <li class="flex items-stretch border-b border-default last:border-b-0">
    <!--
      Deliberately large: this gets tapped one-handed, in a coat, pushing a trolley.

      min-w-0 is load-bearing — see the note in ItemRow. Without it a long
      ingredient name widens the row past the viewport instead of truncating.
    -->
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-3 py-3 pl-1 pr-2 text-left min-h-12 active:bg-elevated/60"
      @click="$emit('toggle')"
    >
      <UIcon
        name="i-lucide-circle"
        class="size-6 shrink-0 text-dimmed"
      />
      <span class="min-w-0 flex-1">
        <span class="block truncate">{{ entry.name }}</span>
        <span
          v-if="entry.quantityLabel || sourceLabel"
          class="block truncate text-xs text-dimmed"
        >
          {{ [entry.quantityLabel, sourceLabel].filter(Boolean).join(' · ') }}
        </span>
      </span>
    </button>

    <UButton
      :icon="grouped ? 'i-lucide-layers' : 'i-lucide-pencil'"
      color="neutral"
      variant="ghost"
      :aria-label="grouped ? `Show what makes up ${entry.name}` : `Edit ${entry.name}`"
      class="self-center"
      @click="$emit('edit')"
    />
  </li>
</template>
