<script setup lang="ts">
import { useListStore } from '../stores/list'
import { useSyncStore } from '../stores/sync'

const store = useListStore()
const sync = useSyncStore()

const draft = ref('')
const editingId = ref<string | null>(null)
const editorOpen = ref(false)
const showDone = ref(false)

async function add() {
  const name = draft.value.trim()
  if (!name) return
  // Clear first: the input has to be ready for the next item immediately, and the
  // write is optimistic anyway.
  draft.value = ''
  await store.addItem(name)
}

function edit(id: string) {
  editingId.value = id
  editorOpen.value = true
}

function aisleNameFor(id: string | null) {
  return id ? store.aisles.get(id)?.name ?? null : null
}

const isEmpty = computed(() => store.groups.length === 0 && store.checkedItems.length === 0)
</script>

<template>
  <div class="min-h-dvh">
    <header class="sticky top-0 z-10 border-b border-default bg-default/85 backdrop-blur">
      <div class="mx-auto max-w-xl px-3 pt-3 pb-2">
        <div class="mb-2 flex items-center gap-2">
          <h1 class="flex-1 truncate text-lg font-semibold">
            Shopping
          </h1>

          <UBadge
            v-if="sync.offline"
            color="neutral"
            variant="subtle"
            icon="i-lucide-cloud-off"
          >
            {{ sync.pendingCount > 0 ? `${sync.pendingCount} to sync` : 'Offline' }}
          </UBadge>
          <UBadge
            v-else-if="sync.pendingCount > 0"
            color="neutral"
            variant="subtle"
            icon="i-lucide-refresh-cw"
          >
            Saving
          </UBadge>

          <UButton
            to="/settings"
            icon="i-lucide-settings"
            color="neutral"
            variant="ghost"
            aria-label="Settings"
          />
        </div>

        <form
          class="flex gap-2"
          @submit.prevent="add"
        >
          <UInput
            v-model="draft"
            size="xl"
            placeholder="Add an item"
            autocapitalize="sentences"
            enterkeyhint="done"
            class="flex-1"
          />
          <UButton
            type="submit"
            size="xl"
            icon="i-lucide-plus"
            :disabled="!draft.trim()"
            aria-label="Add"
          />
        </form>
      </div>
    </header>

    <main class="mx-auto max-w-xl px-3 pb-28">
      <div
        v-if="!sync.hydrated"
        class="py-16 text-center text-sm text-muted"
      >
        Loading…
      </div>

      <div
        v-else-if="isEmpty"
        class="py-16 text-center"
      >
        <p class="text-muted">
          Nothing on the list.
        </p>
        <p class="mt-1 text-sm text-dimmed">
          Type above to add the first thing.
        </p>
      </div>

      <template v-else>
        <section
          v-for="group in store.groups"
          :key="group.id"
          class="mt-5 first:mt-3"
        >
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            {{ group.name }}
          </h2>
          <ul class="rounded-lg border border-default bg-elevated/30">
            <ItemRow
              v-for="item in group.items"
              :key="item.id"
              :item="item"
              :source-label="store.sourceLabelFor(item)"
              @toggle="store.toggleItem(item.id)"
              @edit="edit(item.id)"
            />
          </ul>
        </section>

        <section
          v-if="store.checkedItems.length"
          class="mt-8"
        >
          <div class="mb-1 flex items-center gap-2">
            <button
              type="button"
              class="flex flex-1 items-center gap-1 text-xs font-medium uppercase tracking-wide text-dimmed"
              @click="showDone = !showDone"
            >
              <UIcon
                :name="showDone ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4"
              />
              Done ({{ store.checkedItems.length }})
            </button>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              @click="store.clearChecked()"
            >
              Clear
            </UButton>
          </div>

          <ul
            v-if="showDone"
            class="rounded-lg border border-default bg-elevated/30"
          >
            <ItemRow
              v-for="item in store.checkedItems"
              :key="item.id"
              :item="item"
              :aisle-name="aisleNameFor(item.aisle_id)"
              :source-label="store.sourceLabelFor(item)"
              @toggle="store.toggleItem(item.id)"
              @edit="edit(item.id)"
            />
          </ul>
        </section>
      </template>
    </main>

    <ItemEditor
      v-model:open="editorOpen"
      :item-id="editingId"
    />
  </div>
</template>
