<script setup lang="ts">
/**
 * One step of a method, on the phone.
 *
 * Deliberately the same row as IngredientLineRow: the whole body is the tap
 * target and opens the editor, reordering is two arrows at the edge. A step is
 * longer than an ingredient, so the arrows stack rather than sit side by side and
 * the text is free to wrap — nothing here truncates, because a step you can only
 * read half of is a step you have to open to use.
 */
const { body, position, canMoveUp, canMoveDown } = defineProps<{
  body: string
  position: number
  canMoveUp: boolean
  canMoveDown: boolean
}>()

defineEmits<{ edit: [], moveUp: [], moveDown: [] }>()
</script>

<template>
  <li class="flex items-start gap-1 border-b border-default px-1 last:border-b-0">
    <button
      type="button"
      class="flex min-h-12 min-w-0 flex-1 gap-3 px-2 py-3 text-left active:bg-elevated/60"
      @click="$emit('edit')"
    >
      <!--
        Numbered from the position in the list rather than from anything stored.
        Renumbering every row on every reorder is exactly what a sparse sort_order
        exists to avoid, and the number people read is a fact about the order, not
        about the step.
      -->
      <span class="shrink-0 tabular-nums text-dimmed">{{ position }}</span>
      <span class="min-w-0 flex-1 whitespace-pre-line">{{ body }}</span>
    </button>

    <div class="flex shrink-0 flex-col py-1">
      <UButton
        icon="i-lucide-chevron-up"
        size="sm"
        color="neutral"
        variant="ghost"
        :disabled="!canMoveUp"
        :aria-label="`Move step ${position} up`"
        @click="$emit('moveUp')"
      />
      <UButton
        icon="i-lucide-chevron-down"
        size="sm"
        color="neutral"
        variant="ghost"
        :disabled="!canMoveDown"
        :aria-label="`Move step ${position} down`"
        @click="$emit('moveDown')"
      />
    </div>
  </li>
</template>
