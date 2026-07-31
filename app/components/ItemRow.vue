<script setup lang="ts">
import type { ItemRow } from '../utils/db'

/** One list item as a tickable line. The row itself is `ChecklistRow`. */
const { item, aisleName = null, sourceLabel = null } = defineProps<{
  item: ItemRow
  /** Shown only in the done list, where items are no longer grouped by aisle. */
  aisleName?: string | null
  /** The recipe a derived item came from, so "why is this here?" has an answer. */
  sourceLabel?: string | null
}>()

defineEmits<{
  toggle: []
  edit: []
}>()

const meta = computed(() =>
  [item.quantity, aisleName, sourceLabel].filter(Boolean).join(' · ') || null
)
</script>

<template>
  <ChecklistRow
    :state="item.checked ? 'checked' : 'unchecked'"
    :label="item.name"
    :meta="meta"
    action-icon="i-lucide-pencil"
    :action-label="`Edit ${item.name}`"
    @toggle="$emit('toggle')"
    @action="$emit('edit')"
  />
</template>
