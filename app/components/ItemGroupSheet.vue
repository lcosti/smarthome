<script setup lang="ts">
import { useListStore } from '../stores/list'
import type { ListEntry } from '../utils/aggregate'
import type { ItemRow } from '../utils/db'

/**
 * What makes up a grouped line, so a total is never something you have to take on
 * trust. Each row opens the ordinary item editor, because a quantity belongs to
 * the recipe that asked for it — editing the sum would mean editing nothing real.
 */
const open = defineModel<boolean>('open', { required: true })
const { entry } = defineProps<{ entry: ListEntry<ItemRow> | null }>()

const emit = defineEmits<{ edit: [itemId: string] }>()

const store = useListStore()

function edit(itemId: string) {
  open.value = false
  emit('edit', itemId)
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    :title="entry?.name ?? 'Line'"
    :description="entry?.quantityLabel ?? undefined"
  >
    <template #body>
      <ul
        v-if="entry"
        class="rounded-lg border border-default bg-elevated/30"
      >
        <li
          v-for="item in entry.items"
          :key="item.id"
          class="flex items-center gap-2 border-b border-default px-3 py-2.5 last:border-b-0"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm">{{ item.name }}</span>
            <span class="block truncate text-xs text-dimmed">
              {{ [item.quantity, store.sourceLabelFor(item)].filter(Boolean).join(' · ') || 'No quantity' }}
            </span>
          </span>
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            :aria-label="`Edit ${item.name}`"
            @click="edit(item.id)"
          />
        </li>
      </ul>
    </template>
  </USlideover>
</template>
