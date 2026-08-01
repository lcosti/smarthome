<script setup lang="ts">
import { useListStore } from '../stores/list'
import { useSyncStore } from '../stores/sync'
import type { ListEntry } from '../utils/aggregate'
import type { ItemRow } from '../utils/db'

const store = useListStore()
const sync = useSyncStore()
const toast = useToast()
const isWide = useWide()

const draft = ref('')
const editingId = ref<string | null>(null)
const editorOpen = ref(false)
const groupEntry = ref<ListEntry<ItemRow> | null>(null)
const groupOpen = ref(false)
const showChecked = ref(true)

/**
 * Which aisles are being shopped right now. Empty means all of them — there is
 * no "All" chip, because switching every chip off and meaning "show me nothing"
 * is not a thing anybody wants, and an unfiltered list is the resting state.
 */
const activeAisles = ref<string[]>([])

const filterItems = computed(() =>
  store.sections.map(section => ({ label: section.name, value: section.id }))
)

const visibleSections = computed(() => {
  const chosen = activeAisles.value.length
    ? store.sections.filter(section => activeAisles.value.includes(section.id))
    : store.sections

  // A cleared aisle with its ticked rows hidden is a header over nothing. The
  // card earns its space by having something left in it, so it goes until either
  // the checked rows come back or something new is filed there.
  return showChecked.value
    ? chosen
    : chosen.filter(section => section.entries.length > 0)
})

/**
 * An aisle emptied while it was filtered on would otherwise leave the page
 * showing nothing, with the only way back a chip that is no longer there.
 */
watch(filterItems, (items) => {
  const live = new Set(items.map(item => item.value))
  activeAisles.value = activeAisles.value.filter(id => live.has(id))
})

/**
 * Where a newly typed item gets filed.
 *
 * One chip on is somebody saying where they are standing, and what they type
 * belongs there. Two chips on says nothing about which of them, so the
 * household's usual guess is still the better answer.
 */
const filingAisle = computed(() =>
  activeAisles.value.length === 1 ? activeAisles.value[0]! : null
)

async function add() {
  const name = draft.value.trim()
  if (!name) return
  // Clear first: the input has to be ready for the next item immediately, and the
  // write is optimistic anyway — offline is not a failure here, it queues.
  draft.value = ''
  // Filed into the aisle being filtered on, or it lands somewhere the filter is
  // hiding. `other` is the bucket for no aisle at all, which is an explicit null
  // rather than an id — see addItem.
  const added = await store.addItem(
    name,
    filingAisle.value === null
      ? {}
      : { aisleId: filingAisle.value === 'other' ? null : filingAisle.value }
  )
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

const isEmpty = computed(() => store.sections.length === 0)

const countLabel = computed(() => {
  const items = store.progress.total
  const aisles = store.sections.length
  return `${items} ${items === 1 ? 'item' : 'items'} · ${aisles} ${aisles === 1 ? 'aisle' : 'aisles'}`
})

const checkedCount = computed(() => store.progress.done)
</script>

<template>
  <div class="flex h-full flex-col">
    <!--
      Phone only. On a wide screen the app header already says where you are, and
      two bars stacked on top of each other say it twice — the same call plan.vue
      makes.
    -->
    <AppPageHeader
      v-if="!isWide"
      title="Shopping"
      content-class="max-w-xl"
    >
      <template #actions>
        <UButton
          v-if="checkedCount"
          :icon="showChecked ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          color="neutral"
          variant="ghost"
          :aria-label="showChecked ? 'Hide checked' : 'Show checked'"
          @click="showChecked = !showChecked"
        />
        <UButton
          v-if="checkedCount"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          aria-label="Clear checked"
          @click="store.clearChecked()"
        />
      </template>

      <ShoppingAddForm
        v-model="draft"
        @submit="add"
      />
    </AppPageHeader>

    <main class="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
      <!--
        The wide stack is deliberately tighter than the phone's: title, add form
        and aisle chips are one block of controls above the list, and the list is
        the thing worth the vertical space.
      -->
      <div class="mx-auto flex min-h-full w-full max-w-xl flex-col gap-3 px-3 pb-6 lg:h-full lg:max-w-none lg:gap-2.5 lg:px-6 lg:py-3">
        <!-- The header the wide layout does not get from AppPageHeader. -->
        <div
          v-if="isWide"
          class="flex shrink-0 items-center gap-3"
        >
          <h1 class="text-2xl font-semibold tracking-[-0.025em] text-highlighted">
            Shopping
          </h1>
          <p
            v-if="!isEmpty"
            class="text-sm text-dimmed"
          >
            {{ countLabel }}
          </p>

          <div class="ml-auto flex items-center gap-2">
            <UButton
              v-if="checkedCount"
              color="neutral"
              variant="outline"
              :icon="showChecked ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              :label="showChecked ? 'Hide checked' : 'Show checked'"
              @click="showChecked = !showChecked"
            />
            <!--
              No confirmation: clearing is a soft delete of things already in the
              trolley, and ConfirmModal is deliberately reserved for the three
              actions that cannot be undone. The board clears the same way.
            -->
            <UButton
              v-if="checkedCount"
              color="neutral"
              variant="outline"
              icon="i-lucide-trash-2"
              label="Clear checked"
              @click="store.clearChecked()"
            />
          </div>
        </div>

        <ShoppingAddForm
          v-if="isWide"
          v-model="draft"
          submit-label="Add item"
          class="shrink-0"
          @submit="add"
        />

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
          class="flex-1"
        />

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-shopping-cart"
          title="Nothing on the list."
          description="Type above to add the first thing."
          class="flex-1"
        />

        <template v-else>
          <!--
            A filter rather than a jump: on a phone it is "I am standing in
            Chilled and Bakery, show me those", and one chip on doubles as where
            the next thing typed gets filed.

            Toggle chips are a checkbox group, not a row of buttons (CLAUDE.md
            rule 6): several can be on at once, which is exactly what a checkbox
            models, and it brings the roles and the keyboard handling with it.
            `card` with the indicator hidden is the theme's own chip — the
            selected border comes from the variant, not from us. What a chip
            overrides on top of that lives in `app.config.ts`, under sm + card,
            and is shared with the recipe library's facets.

            `horizontal` is load-bearing: the group defaults to vertical, and a
            column flex stretches its items to full width and ignores the
            flex-wrap below. The row axis is what makes these read as chips.
          -->
          <UCheckboxGroup
            v-model="activeAisles"
            :items="filterItems"
            variant="card"
            indicator="hidden"
            orientation="horizontal"
            size="sm"
            color="primary"
            class="shrink-0"
            :ui="{ fieldset: 'flex-wrap gap-1.5' }"
          />

          <!--
            CSS columns rather than a grid: aisles are wildly different
            lengths — two things in Bakery, nine in Cupboard — and a grid row
            is as tall as its tallest cell, so a long aisle leaves a column of
            dead space beside it. Masonry packs them, which is what makes the
            whole shop fit on one screen.

            The trade is reading order: columns flow top-to-bottom then across,
            so aisle order runs down each column rather than across the page.
            That is the right way round anyway — a column is walked, and on a
            phone there is only one of them.

            The height constraint is lg-only, and that is load-bearing: per
            spec, multicol with a definite height fragments at that height and
            puts what is left into overflow columns off-screen to the right —
            one aisle visible, nothing to scroll. Older Chromium overflowed
            downward instead, which is how a pinned height ever looked fine on
            a phone. On a phone the block must size to its content so <main>
            scrolls; only the wide layout, where this div is its own scroll
            region, may pin it.
          -->
          <div class="columns-1 gap-3 lg:min-h-0 lg:flex-1 lg:columns-2 lg:overflow-y-auto lg:pr-1 2xl:columns-3">
            <ShoppingAisleCard
              v-for="section in visibleSections"
              :key="section.id"
              :section="section"
              :show-checked="showChecked"
              class="mb-3 break-inside-avoid"
              @edit-entry="openEntry"
              @edit-item="edit"
            />
          </div>
        </template>
      </div>
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
