<script setup lang="ts">
/**
 * The things you do to a week rather than with it.
 *
 * Filling the week and putting it on the list are the errands the page exists
 * for and stay as buttons. Emptying one is rare and destructive, and a third
 * button beside those two would compete with them for the same glance — so it
 * goes behind a kebab, where an action you want once a month belongs.
 *
 * One component for both shapes: the phone header and the wide toolbar ask the
 * same question, and the confirmation lives in here so neither layout has to
 * carry modal state to answer it.
 */
const { canClear, canFill = false, showFill = false, size = 'md' } = defineProps<{
  /** Whether any night still ahead has a meal on it. */
  canClear: boolean
  /** Whether there is an empty night ahead that somebody is eating on. */
  canFill?: boolean
  /**
   * Carry "fill the empty nights" in here too.
   *
   * True on the phone, where the bar along the top is already a title, a week
   * stepper and the way to Settings, and a fourth control would leave none of
   * them room. The wide toolbar has the width for a labelled button and keeps
   * it — filling a week is the kind of thing that should be visible before you
   * know to look for it.
   */
  showFill?: boolean
  /** `lg` beside the wide toolbar's buttons, so the three sit level. */
  size?: 'md' | 'lg'
}>()

const emit = defineEmits<{ clear: [], fill: [] }>()

const confirming = ref(false)

const items = computed(() => {
  const groups: Record<string, unknown>[][] = []

  if (showFill && canFill) {
    groups.push([{
      label: 'Fill empty nights',
      icon: 'i-lucide-wand-sparkles',
      onSelect: () => emit('fill')
    }])
  }

  if (canClear) {
    groups.push([{
      label: 'Clear week',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => {
        confirming.value = true
      }
    }])
  }

  return groups
})
</script>

<template>
  <!--
    Gone rather than greyed when there is nothing in it, which is how the fill
    button beside it already behaves. A disabled item was the first attempt and
    read wrong: an error-coloured row does not stop looking live.
  -->
  <UDropdownMenu
    v-if="items.length"
    :items="items"
    :ui="{ content: 'p-1.5' }"
  >
    <UButton
      icon="i-lucide-ellipsis-vertical"
      color="neutral"
      variant="ghost"
      :size="size"
      aria-label="Week actions"
    />
  </UDropdownMenu>

  <!--
    A sibling of the menu rather than a child of it, and outliving it: the
    trigger slot is rendered `as-child` onto one element, and a modal unmounted
    by the very clear it just confirmed loses its way out.

    Several dinners at once and no tap that puts them back, which is the bar
    `ConfirmModal` sets. Its description says what a clear does not touch,
    because that is the part that surprises — the shopping list is reconciled by
    deriving the week, never by editing it.
  -->
  <ConfirmModal
    v-model:open="confirming"
    title="Clear this week?"
    description="Takes the meals off the nights still to come. Nights already cooked stay, and their ingredients stay on the shopping list until you add the week to it again."
    confirm-label="Clear week"
    @confirm="emit('clear')"
  />
</template>
