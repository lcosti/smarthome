<script setup lang="ts">
import { useRecipesStore } from '../stores/recipes'

/**
 * Editing one step, on the same terms as IngredientLineEditor: a bottom
 * slideover, load on open, Remove on the left and Save on the right.
 *
 * A textarea rather than an input because a step is a sentence or three, and
 * enter inside it has to mean a new line — so unlike the ingredient editor there
 * is no save-on-enter here. Save is the button.
 */
const open = defineModel<boolean>('open', { required: true })
const { stepId } = defineProps<{ stepId: string | null }>()

const store = useRecipesStore()

const body = ref('')

const step = computed(() => (stepId ? store.stepById(stepId) ?? null : null))

// Load the form when the slideover opens, not on every keystroke of local state.
watch(open, (isOpen) => {
  if (!isOpen || !step.value) return
  body.value = step.value.body
}, { immediate: true })

async function save() {
  if (!stepId || !body.value.trim()) return
  await store.updateStep(stepId, body.value)
  open.value = false
}

async function remove() {
  if (!stepId) return
  await store.deleteStep(stepId)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    title="Edit step"
  >
    <template #body>
      <UFormField label="Step">
        <UTextarea
          v-model="body"
          :rows="5"
          autoresize
          size="xl"
          class="w-full"
        />
      </UFormField>
    </template>

    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="subtle"
          @click="remove"
        >
          Remove
        </UButton>
        <div class="flex-1" />
        <UButton
          color="neutral"
          variant="ghost"
          @click="open = false"
        >
          Cancel
        </UButton>
        <UButton
          :disabled="!body.trim()"
          @click="save"
        >
          Save
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
