<script setup lang="ts">
import type { ListEntry } from '../../utils/aggregate'
import type { BoardModel } from '../../utils/board'
import type { ItemRow } from '../../utils/db'
import { useListStore } from '../../stores/list'

/**
 * The list itself, not a summary of it.
 *
 * This card used to show a count and the next three lines, and send you to the
 * full view to do anything. Standing at a tablet in the kitchen that was one
 * press too many for the commonest action in the whole app — somebody unpacking
 * a bag ticking things off. The rows are here now, and ticking is idempotent, so
 * two people doing it from different rooms is a non-event.
 *
 * Unchecked first in aisle order and aggregated, so the milk two recipes asked
 * for is one line with one total rather than two saying half the truth each;
 * checked ones fall to the bottom as evidence rather than disappearing, which is
 * what makes "Clear done" a decision rather than a surprise.
 *
 * The only thing on this card that is *not* live state is the empty copy, which
 * still comes from the view model — a list cleared before a shop and one nobody
 * has ever used are different results and only the first is worth celebrating.
 */
const { shopping } = defineProps<{ shopping: BoardModel['shopping'] }>()

const list = useListStore()

const open = ref(false)

/**
 * The three things about an item a person actually decides. The rest of the row
 * — source, plan entry, ingredient, who added it — is provenance the app works
 * out, and offering it as a field would be asking a question with one answer.
 */
const draftName = ref('')
const draftQuantity = ref('')
const draftAisle = ref<string | null>(null)

/** Set once somebody taps a chip, after which the guess stops overruling them. */
const aisleChosen = ref(false)

/**
 * Follow the name with the aisle the app would have picked anyway, so the guess
 * arrives as a highlighted chip you can correct rather than as a decision made
 * behind your back. Stops the moment anyone disagrees with it.
 */
watch(draftName, (name) => {
  if (aisleChosen.value) return
  draftAisle.value = list.suggestedAisle(name)
})

// Reset on close rather than on open, so the next person finds an empty form
// however the last one left — submitted, cancelled, or pressed escape.
watch(open, (isOpen) => {
  if (isOpen) return
  draftName.value = ''
  draftQuantity.value = ''
  draftAisle.value = null
  aisleChosen.value = false
})

/** Aggregated unchecked lines, in the order the shop is actually walked. */
const outstanding = computed<ListEntry<ItemRow>[]>(() =>
  list.groups.flatMap(group => group.entries)
)

const doneCount = computed(() => list.checkedItems.length)

async function add() {
  const name = draftName.value.trim()
  if (!name) return
  const fields = { quantity: draftQuantity.value, aisleId: draftAisle.value }
  // Read and closed before the await, not after: the board is a shared surface
  // and the next person should be able to start typing immediately.
  open.value = false
  await list.addItem(name, fields)
}
</script>

<template>
  <UCard
    variant="subtle"
    data-board-card="shopping"
    class="flex min-h-0 flex-1 flex-col"
    :ui="{
      header: 'flex flex-none flex-col gap-2.5 px-6 py-3 sm:px-6',
      body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0',
      footer: 'flex-none px-4 py-3 sm:px-6'
    }"
  >
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Shopping
        </h2>
        <p
          v-if="!shopping.empty"
          class="text-xs text-dimmed"
        >
          {{ shopping.countLabel }}
        </p>
      </div>

      <!--
        How much of the shop is behind you. `UProgress` is exactly this shape —
        one value against a track — and the number above it is the part still to
        do, so the bar and the label never say the same thing twice.

        Inside the header rather than under it: as a sibling of this template it
        landed in the card's default slot, which put it flush against the header's
        bottom border and made the pair read as one doubled rule. It belongs to
        the heading, so it lives in the heading.
      -->
      <UProgress
        v-if="!shopping.empty"
        :model-value="doneCount"
        :max="doneCount + shopping.count"
        size="sm"
      />
    </template>

    <!--
      The whole of an ad-hoc item, not just its name. Quantity and aisle are
      what make a line actionable in a shop — "Feta, 200 g, Chilled" is walked
      past once, "Feta" is walked past twice — and a modal has room to ask for
      them. The list page keeps its one-field quick add, because there the
      thing being beaten is a WhatsApp message.

      Both are still optional: name alone submits, and the aisle already has a
      sensible answer in it.
    -->
    <template #footer>
      <UModal
        v-model:open="open"
        title="Add an item"
        :ui="{ content: 'max-w-md' }"
      >
        <UButton
          color="neutral"
          variant="subtle"
          size="lg"
          block
          icon="i-lucide-plus"
          label="Add item"
        />

        <template #body>
          <UForm
            :state="{ draftName, draftQuantity, draftAisle }"
            class="space-y-4"
            @submit="add"
          >
            <UFormField label="Item">
              <UInput
                v-model="draftName"
                autofocus
                placeholder="Bin bags"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Quantity"
              help="Whatever is useful in the aisle: 2, 1 tin, a bunch."
            >
              <UInput
                v-model="draftQuantity"
                placeholder="Optional"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Aisle">
              <AislePicker
                v-model="draftAisle"
                @update:model-value="aisleChosen = true"
              />
            </UFormField>
          </UForm>
        </template>

        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="open = false"
            />
            <UButton
              color="primary"
              label="Add"
              :disabled="!draftName.trim()"
              @click="add"
            />
          </div>
        </template>
      </UModal>
    </template>

    <!-- Green only when the list was cleared, never when it was never used. -->
    <div
      v-if="shopping.empty"
      class="flex flex-1 p-6"
    >
      <div class="flex flex-1 flex-col items-start justify-center gap-1.5 rounded-lg border border-dashed border-accented p-6">
        <p
          class="text-base font-semibold"
          :class="shopping.resolved ? 'text-success' : 'text-highlighted'"
        >
          {{ shopping.emptyTitle }}
        </p>
        <p class="max-w-[320px] text-pretty text-sm leading-[1.6] text-muted">
          {{ shopping.emptyBody }}
        </p>
      </div>
    </div>

    <!--
      The rows scroll inside the card rather than growing it. On a phone the page
      itself scrolls, so the cap is what stops a forty-item list pushing the week
      strip a screen and a half down. On a wide screen the board is fixed and the
      row hands this card a height, so the cap comes off and the list takes
      whatever is left.
    -->
    <div
      v-else
      class="flex max-h-[420px] min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-4 pb-4 pt-2 lg:max-h-none"
    >
      <!--
        Real checkboxes, unlike the list page's rows: there is no second control
        on a board row, so nothing here needs a label wrapping a button, and the
        board's main interaction gets to announce itself as a checklist.
      -->
      <UCheckbox
        v-for="entry in outstanding"
        :key="entry.key"
        :model-value="false"
        :ui="{ root: 'items-center rounded-md px-2 py-2.5 transition-colors hover:bg-default/60', wrapper: 'ms-3' }"
        @update:model-value="list.toggleEntry(entry)"
      >
        <template #label>
          <span class="flex items-center gap-3">
            <span class="min-w-0 truncate text-sm font-normal text-default">{{ entry.name }}</span>
            <span
              v-if="entry.quantityLabel"
              class="ml-auto shrink-0 font-mono text-xs text-dimmed"
            >{{ entry.quantityLabel }}</span>
          </span>
        </template>
      </UCheckbox>

      <UCheckbox
        v-for="item in list.checkedItems"
        :key="item.id"
        :model-value="true"
        :ui="{ root: 'items-center rounded-md px-2 py-2.5 transition-colors hover:bg-default/60', wrapper: 'ms-3' }"
        @update:model-value="list.toggleItem(item.id)"
      >
        <template #label>
          <span class="flex items-center gap-3">
            <span class="min-w-0 truncate text-sm font-normal text-dimmed line-through">{{ item.name }}</span>
            <span
              v-if="item.quantity"
              class="ml-auto shrink-0 font-mono text-xs text-dimmed"
            >{{ item.quantity }}</span>
          </span>
        </template>
      </UCheckbox>

      <!--
        Only the action. The tally that used to sit beside it said what the
        header and the bar above already say — the count of what is left, and
        how much of the shop is behind you — a third time, in a third format.
        The row appears when there is something to clear and is not there at all
        when there is not.

        Inside the scroll container and pushed down by mt-auto, so on a short
        list it sits under the last row rather than floating at the bottom of an
        empty card.
      -->
      <div
        v-if="doneCount"
        class="mt-auto flex items-center justify-end border-t border-default px-2 pt-3"
      >
        <UButton
          color="neutral"
          variant="link"
          size="xs"
          label="Clear done"
          :ui="{ base: 'p-0' }"
          @click="list.clearChecked()"
        />
      </div>
    </div>
  </UCard>
</template>
