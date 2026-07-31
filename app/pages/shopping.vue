<script setup lang="ts">
import { useListStore } from '../stores/list'
import { useSyncStore } from '../stores/sync'
import type { ListEntry } from '../utils/aggregate'
import type { ItemRow } from '../utils/db'

const store = useListStore()
const sync = useSyncStore()
const toast = useToast()

const draft = ref('')
const editingId = ref<string | null>(null)
const editorOpen = ref(false)
const groupEntry = ref<ListEntry<ItemRow> | null>(null)
const groupOpen = ref(false)
const showDone = ref(false)

async function add() {
  const name = draft.value.trim()
  if (!name) return
  // Clear first: the input has to be ready for the next item immediately, and the
  // write is optimistic anyway — offline is not a failure here, it queues.
  draft.value = ''
  const added = await store.addItem(name)
  if (added) return

  // It genuinely did not go anywhere. Give the typing back rather than swallowing
  // it, and say why.
  draft.value = draft.value || name
  toast.add({
    title: 'Not added',
    description: 'This device is not set up with a household yet.',
    color: 'warning',
    icon: 'i-lucide-cloud-alert'
  })
}

function edit(id: string) {
  editingId.value = id
  editorOpen.value = true
}

/**
 * One row behind the line means edit it. Several means show what they are first —
 * a summed quantity is not a thing that can be edited, only the rows under it.
 */
function openEntry(entry: ListEntry<ItemRow>) {
  if (entry.items.length === 1) {
    edit(entry.items[0]!.id)
    return
  }
  groupEntry.value = entry
  groupOpen.value = true
}

function aisleNameFor(id: string | null) {
  return id ? store.aisles.get(id)?.name ?? null : null
}

const isEmpty = computed(() => store.groups.length === 0 && store.checkedItems.length === 0)
</script>

<template>
  <div class="flex h-full flex-col">
    <AppPageHeader
      title="Shopping"
      content-class="max-w-xl lg:max-w-5xl"
    >
      <UForm
        :state="{ draft }"
        class="flex gap-2"
        @submit="add"
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
      </UForm>
    </AppPageHeader>

    <main class="mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto px-3 pb-6 lg:max-w-5xl lg:px-6 lg:pb-12">
      <LoadingState v-if="!sync.hydrated" />

      <!--
        The redirect in useSync handles this when it can. This is the fallback for
        when it cannot — no signal, or mid-load — so nobody is ever left staring at
        an input that quietly does nothing.
      -->
      <UEmpty
        v-else-if="!sync.householdId"
        icon="i-lucide-home"
        title="This device isn't set up yet."
        description="Create a household, or join the one you already have."
        :actions="[{ label: 'Set up', to: '/welcome', size: 'lg' }]"
      />

      <UEmpty
        v-else-if="isEmpty"
        icon="i-lucide-shopping-cart"
        title="Nothing on the list."
        description="Type above to add the first thing."
      />

      <template v-else>
        <!--
          One column on a phone, walked top to bottom in aisle order. Three on a
          wide screen, where the whole shop fits on one screen and reading order
          matters less than seeing all of it at once. `items-start` so a short
          aisle does not stretch to the height of the longest one beside it.
        -->
        <div class="lg:grid lg:grid-cols-3 lg:items-start lg:gap-x-4">
          <section
            v-for="group in store.groups"
            :key="group.id"
            class="mt-5 first:mt-3 lg:mt-4 lg:first:mt-4"
          >
            <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
              {{ group.name }}
            </h2>
            <ul class="rounded-lg border border-default bg-elevated/30">
              <ListEntryRow
                v-for="entry in group.entries"
                :key="entry.key"
                :entry="entry"
                :source-label="store.sourceLabelForEntry(entry)"
                @toggle="store.toggleEntry(entry)"
                @edit="openEntry(entry)"
              />
            </ul>
          </section>
        </div>

        <section
          v-if="store.checkedItems.length"
          class="mt-8"
        >
          <div class="mb-1 flex items-center gap-2">
            <UButton
              color="neutral"
              variant="link"
              size="xs"
              :icon="showDone ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              :label="`Done (${store.checkedItems.length})`"
              :aria-expanded="showDone"
              class="flex-1 justify-start p-0 uppercase tracking-wide text-dimmed"
              @click="showDone = !showDone"
            />
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

    <ItemGroupSheet
      v-model:open="groupOpen"
      :entry="groupEntry"
      @edit="edit"
    />
  </div>
</template>
