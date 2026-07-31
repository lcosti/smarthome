<script setup lang="ts">
import type { ListEntry } from '../utils/aggregate'
import type { ItemRow } from '../utils/db'

/** One aggregated list line as a tickable row. The row itself is `ChecklistRow`. */
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

/**
 * Nothing to buy: the cupboard has all of it.
 *
 * The line stays on the list rather than disappearing, because a plan that put
 * something here and then hid it is a plan nobody can check. Ticking it still
 * means what ticking always meant — it is in the trolley — and taking it out of
 * the cupboard is exactly that.
 */
const covered = computed(() => entry.pantry !== null && entry.pantry.toBuy === 0)

const meta = computed(() =>
  [entry.quantityLabel, sourceLabel].filter(Boolean).join(' · ') || null
)
</script>

<template>
  <ChecklistRow
    :state="covered ? 'covered' : 'unchecked'"
    :label="entry.name"
    :meta="meta"
    :action-icon="grouped ? 'i-lucide-layers' : 'i-lucide-pencil'"
    :action-label="grouped ? `Show what makes up ${entry.name}` : `Edit ${entry.name}`"
    @toggle="$emit('toggle')"
    @action="$emit('edit')"
  />
</template>
