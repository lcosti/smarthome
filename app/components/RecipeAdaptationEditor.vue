<script setup lang="ts">
import { useRecipesStore } from '../stores/recipes'
import {
  OVERRIDE_ACTIONS,
  audienceLabel,
  ingredientOverrideText,
  type OverrideAction
} from '../utils/adaptations'

/**
 * Editing one adaptation, on the same terms as the step and line editors: a
 * bottom slideover, load on open, Remove on the left and Save on the right.
 *
 * The audience is shown, not edited — it is the adaptation's identity, minted
 * into its id, and "the weaning version is now the toddler version" is a new
 * adaptation, not a rename. Two speeds inside one sheet, the PersonEditor
 * split: overrides are chips, added and removed as their own decisions and
 * written immediately, while the note is a form the footer saves.
 */
const open = defineModel<boolean>('open', { required: true })
const { adaptationId } = defineProps<{ adaptationId: string | null }>()

const store = useRecipesStore()

const adaptation = computed(() => (adaptationId ? store.adaptationById(adaptationId) ?? null : null))
const items = computed(() => (adaptationId ? store.adaptationItemsFor(adaptationId) : []))

const lines = computed(() => (adaptation.value ? store.ingredientsFor(adaptation.value.recipe_id) : []))
const steps = computed(() => (adaptation.value ? store.stepsFor(adaptation.value.recipe_id) : []))

const note = ref('')
const kind = ref<'ingredient' | 'step'>('ingredient')
const targetId = ref<string | undefined>(undefined)
const action = ref<OverrideAction>('swap')
const body = ref('')

watch(open, (isOpen) => {
  if (!isOpen || !adaptation.value) return
  note.value = adaptation.value.note ?? ''
  kind.value = 'ingredient'
  targetId.value = undefined
  action.value = 'swap'
  body.value = ''
}, { immediate: true })

// The two halves of the add form share a body box; what was typed about a
// yoghurt is not about step three, so changing lanes clears it and the target.
watch(kind, () => {
  targetId.value = undefined
  body.value = ''
})

const KINDS = [
  { value: 'ingredient', label: 'Ingredient' },
  { value: 'step', label: 'Step' }
]

const lineItems = computed(() =>
  lines.value.map(line => ({ label: line.name, value: line.id })))

const stepItems = computed(() =>
  steps.value.map((step, index) => ({
    label: `Step ${index + 1} — ${step.body}`,
    value: step.id
  })))

/** Skip and Less stand alone; a swap without a replacement says nothing. */
const canAdd = computed(() => Boolean(targetId.value)
  && (kind.value === 'ingredient' ? (action.value !== 'swap' || body.value.trim() !== '') : body.value.trim() !== ''))

function itemText(item: typeof items.value[number]): string {
  if (item.kind === 'ingredient') {
    const line = store.ingredientById(item.recipe_ingredient_id ?? '')
    return ingredientOverrideText(item.action, line?.name ?? 'ingredient', item.body)
  }
  const index = steps.value.findIndex(step => step.id === item.recipe_step_id)
  return index >= 0 ? `Step ${index + 1} — ${item.body}` : item.body
}

async function addItem() {
  if (!adaptationId || !targetId.value || !canAdd.value) return
  if (kind.value === 'ingredient') {
    await store.addAdaptationItem(adaptationId, {
      kind: 'ingredient',
      recipe_ingredient_id: targetId.value,
      action: action.value,
      body: body.value
    })
  } else {
    await store.addAdaptationItem(adaptationId, {
      kind: 'step',
      recipe_step_id: targetId.value,
      body: body.value
    })
  }
  targetId.value = undefined
  body.value = ''
}

async function save() {
  if (!adaptationId) return
  await store.updateAdaptation(adaptationId, { note: note.value.trim() || null })
  open.value = false
}

async function remove() {
  if (!adaptationId) return
  await store.deleteAdaptation(adaptationId)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    title="Edit adaptation"
    :description="adaptation ? `The ${audienceLabel(adaptation)} version of this recipe.` : undefined"
  >
    <template #body>
      <div
        v-if="adaptation"
        class="space-y-5"
      >
        <div>
          <p class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Changes
          </p>

          <ul
            v-if="items.length"
            class="space-y-1"
          >
            <li
              v-for="item in items"
              :key="item.id"
              class="flex items-center gap-2"
            >
              <span class="min-w-0 flex-1 truncate text-sm text-default">
                {{ itemText(item) }}
              </span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Remove: ${itemText(item)}`"
                @click="store.deleteAdaptationItem(item.id)"
              />
            </li>
          </ul>

          <p
            v-else
            class="text-sm text-dimmed"
          >
            Nothing changed yet — the note below may be all it needs.
          </p>
        </div>

        <div class="space-y-2 rounded-lg border border-default p-3">
          <UTabs
            v-model="kind"
            :items="KINDS"
            :content="false"
            size="sm"
            aria-label="What to change"
          />

          <div
            v-if="kind === 'ingredient'"
            class="space-y-2"
          >
            <div class="flex gap-2">
              <USelect
                v-model="action"
                :items="[...OVERRIDE_ACTIONS]"
                size="lg"
                class="w-28"
                aria-label="How it changes"
              />
              <USelectMenu
                v-model="targetId"
                :items="lineItems"
                value-key="value"
                size="lg"
                class="min-w-0 flex-1"
                placeholder="Which ingredient"
                aria-label="Which ingredient"
              />
            </div>
            <UInput
              v-model="body"
              size="lg"
              class="w-full"
              :placeholder="action === 'swap' ? 'Swap it for what' : 'Anything worth adding (optional)'"
              :aria-label="action === 'swap' ? 'The replacement' : 'Detail'"
            />
          </div>

          <div
            v-else
            class="space-y-2"
          >
            <USelectMenu
              v-model="targetId"
              :items="stepItems"
              value-key="value"
              size="lg"
              class="w-full"
              placeholder="Which step"
              aria-label="Which step"
            />
            <UTextarea
              v-model="body"
              :rows="2"
              autoresize
              size="lg"
              class="w-full"
              placeholder="What to do differently at that step"
              aria-label="The amendment"
            />
          </div>

          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="subtle"
            label="Add change"
            :disabled="!canAdd"
            @click="addItem"
          />
        </div>

        <UFormField label="Note">
          <UTextarea
            v-model="note"
            :rows="3"
            autoresize
            size="lg"
            class="w-full"
            placeholder="Anything that isn't about one line or step."
          />
        </UFormField>
      </div>
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
        <UButton @click="save">
          Save
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
