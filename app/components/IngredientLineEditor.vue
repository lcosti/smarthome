<script setup lang="ts">
import { useListStore } from '../stores/list'
import { useRecipesStore } from '../stores/recipes'

const open = defineModel<boolean>('open', { required: true })
const { lineId } = defineProps<{ lineId: string | null }>()

const store = useRecipesStore()
const list = useListStore()

const name = ref('')
const quantity = ref('')
const aisleId = ref<string | null>(null)

const line = computed(() => (lineId ? store.ingredientById(lineId) ?? null : null))

// Load the form when the slideover opens, not on every keystroke of local state.
watch(open, (isOpen) => {
  if (!isOpen || !line.value) return
  name.value = line.value.name
  quantity.value = line.value.quantity ?? ''
  aisleId.value = line.value.aisle_id
}, { immediate: true })

async function save() {
  if (!lineId || !name.value.trim()) return
  await store.updateIngredient(lineId, {
    name: name.value.trim(),
    quantity: quantity.value.trim() || null,
    aisle_id: aisleId.value
  })
  open.value = false
}

async function remove() {
  if (!lineId) return
  await store.deleteIngredient(lineId)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    title="Edit ingredient"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Ingredient">
          <UInput
            v-model="name"
            size="xl"
            class="w-full"
            @keydown.enter="save"
          />
        </UFormField>

        <UFormField
          label="Quantity"
          help="Whatever is useful in the aisle: 2, 1 tin, a bunch."
        >
          <UInput
            v-model="quantity"
            size="xl"
            class="w-full"
            @keydown.enter="save"
          />
        </UFormField>

        <UFormField label="Aisle">
          <!-- Chips rather than a select: one tap instead of open-then-tap. -->
          <div class="flex flex-wrap gap-2">
            <UButton
              size="sm"
              color="neutral"
              :variant="aisleId === null ? 'solid' : 'outline'"
              @click="aisleId = null"
            >
              Other
            </UButton>
            <UButton
              v-for="aisle in list.sortedAisles"
              :key="aisle.id"
              size="sm"
              :color="aisleId === aisle.id ? 'primary' : 'neutral'"
              :variant="aisleId === aisle.id ? 'solid' : 'outline'"
              @click="aisleId = aisle.id"
            >
              {{ aisle.name }}
            </UButton>
          </div>
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
        <UButton
          :disabled="!name.trim()"
          @click="save"
        >
          Save
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
