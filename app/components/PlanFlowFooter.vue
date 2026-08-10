<script setup lang="ts">
/**
 * The one press that goes on.
 *
 * Parked above the tab bar where a thumb already is.
 *
 * No progress bar. It used to sit along the left of this row, on the argument
 * that planning a week one night at a time is seven decisions with no natural
 * end. Seven turns out to be small enough to see: the strip at the top of the
 * page is the same seven nights with a filled or hollow dot on each, so how
 * much is left is already countable at a glance, and the chip beside the title
 * says "5 of 7 planned" in words. A bar was a third telling of one fact, and
 * the widest thing in the row.
 *
 * The button always names where it is going — the next night still open, or the
 * review once there is none — because "Next ›" on its own is a press into the
 * dark, and on this page the next night is frequently not tomorrow.
 */
defineProps<{
  label: string
  loading?: boolean
}>()

defineEmits<{ next: [] }>()
</script>

<template>
  <div class="shrink-0 border-t border-default bg-default/85 px-3 py-3 backdrop-blur">
    <!-- One control, on the side the thumb holding the phone is already on. -->
    <div class="mx-auto flex max-w-xl justify-end">
      <UButton
        color="primary"
        size="lg"
        trailing-icon="i-lucide-chevron-right"
        :label="label"
        :loading="loading"
        @click="$emit('next')"
      />
    </div>
  </div>
</template>
