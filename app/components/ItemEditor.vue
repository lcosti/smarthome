<script setup lang="ts">
import { useListStore } from '../stores/list'

const open = defineModel<boolean>('open', { required: true })
const { itemId } = defineProps<{ itemId: string | null }>()

const store = useListStore()

const name = ref('')
const quantity = ref('')
const aisleId = ref<string | null>(null)

const item = computed(() => (itemId ? store.items.get(itemId) ?? null : null))

// Load the form when the slideover opens, not on every keystroke of local state.
watch(open, (isOpen) => {
  if (!isOpen || !item.value) return
  name.value = item.value.name
  quantity.value = item.value.quantity ?? ''
  aisleId.value = item.value.aisle_id
}, { immediate: true })

async function save() {
  if (!itemId || !name.value.trim()) return
  await store.updateItem(itemId, {
    name: name.value.trim(),
    quantity: quantity.value.trim() || null,
    aisle_id: aisleId.value
  })
  open.value = false
}

async function remove() {
  if (!itemId) return
  await store.deleteItem(itemId)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    title="Edit item"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Item">
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
          <AislePicker v-model="aisleId" />
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
