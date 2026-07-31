<script setup lang="ts">
/**
 * A confirmation, for the three things in the app that cannot be undone.
 *
 * Deliberately rare. Ticking, planning and editing all commit straight away
 * because they are cheap to reverse; this exists only where the alternative is
 * losing a recipe, an aisle order, or a session with unsent changes in it.
 *
 * The trigger goes in the default slot, so the caller keeps its own button.
 */
const open = defineModel<boolean>('open', { default: false })

const { title, description = null, confirmLabel = 'Delete', color = 'error' } = defineProps<{
  title: string
  description?: string | null
  confirmLabel?: string
  color?: 'error' | 'primary' | 'neutral'
}>()

const emit = defineEmits<{ confirm: [] }>()

function confirm() {
  open.value = false
  emit('confirm')
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description ?? undefined"
    :ui="{ content: 'max-w-sm' }"
  >
    <slot />

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="open = false"
        />
        <UButton
          :color="color"
          :label="confirmLabel"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
