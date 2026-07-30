<script setup lang="ts">
import type { ItemRow } from '../utils/db'

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
</script>

<template>
  <li class="flex items-stretch border-b border-default last:border-b-0">
    <!--
      Deliberately large: this gets tapped one-handed, in a coat, pushing a trolley.

      min-w-0 is load-bearing. A flex item defaults to min-width:auto, which floors
      it at its content's width, so a long ingredient name ("skinless, boneless
      chicken thighs, each cut into 3 pieces") pushes the row wider than the screen
      and the truncate inside never gets to do anything. The whole page then scrolls
      sideways.
    -->
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-3 py-3 pl-1 pr-2 text-left min-h-12 active:bg-elevated/60"
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
          v-if="item.quantity || aisleName || sourceLabel"
          class="block truncate text-xs text-dimmed"
        >
          {{ [item.quantity, aisleName, sourceLabel].filter(Boolean).join(' · ') }}
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
