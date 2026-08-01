<script setup lang="ts">
/**
 * The one field that has to beat typing into a WhatsApp group.
 *
 * Its own component only so the phone header and the wide page share one
 * implementation: two copies of this form is two places for the enter key, the
 * autocapitalisation and the disabled rule to drift apart, and this is the
 * control the whole app is judged on.
 */

const { submitLabel = null } = defineProps<{
  /** Wide screens have room to say what the button does; a phone gets the plus. */
  submitLabel?: string | null
}>()

const draft = defineModel<string>({ default: '' })

const emit = defineEmits<{ submit: [] }>()
</script>

<template>
  <UForm
    :state="{ draft }"
    class="flex gap-2"
    @submit="emit('submit')"
  >
    <UInput
      v-model="draft"
      size="xl"
      placeholder="Add an item — try &quot;2 tbsp lime juice&quot;"
      autocapitalize="sentences"
      enterkeyhint="done"
      icon="i-lucide-plus"
      class="flex-1"
    />
    <UButton
      type="submit"
      size="xl"
      icon="i-lucide-plus"
      :label="submitLabel ?? undefined"
      :disabled="!draft.trim()"
      :aria-label="submitLabel ? undefined : 'Add'"
    />
  </UForm>
</template>
