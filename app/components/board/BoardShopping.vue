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

function chooseAisle(id: string | null) {
  draftAisle.value = id
  aisleChosen.value = true
}

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
      header: 'flex flex-none items-center justify-between gap-3 px-6 py-4 sm:px-6',
      body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0'
    }"
  >
    <template #header>
      <div class="flex items-center gap-2.5">
        <h2 class="text-base font-semibold text-highlighted">
          Shopping
        </h2>
        <UBadge
          v-if="!shopping.empty"
          color="neutral"
          variant="subtle"
          :label="shopping.countLabel"
        />
      </div>

      <!--
        The whole of an ad-hoc item, not just its name. Quantity and aisle are
        what make a line actionable in a shop — "Feta, 200 g, Chilled" is walked
        past once, "Feta" is walked past twice — and a modal has room to ask for
        them. The list page keeps its one-field quick add, because there the
        thing being beaten is a WhatsApp message.

        Both are still optional: name alone submits, and the aisle already has a
        sensible answer in it.
      -->
      <UModal
        v-model:open="open"
        title="Add an item"
        :ui="{ content: 'max-w-md' }"
      >
        <UButton
          color="neutral"
          variant="subtle"
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
              <!--
                Chips rather than a select, as everywhere else: one tap. They
                need `type="button"` because UButton leaves the attribute unset
                and these sit inside a form, where the browser default is submit
                — picking an aisle would otherwise add the item.
              -->
              <div class="flex flex-wrap gap-2">
                <UButton
                  type="button"
                  size="sm"
                  color="neutral"
                  :variant="draftAisle === null ? 'solid' : 'outline'"
                  label="Other"
                  @click="chooseAisle(null)"
                />
                <UButton
                  v-for="aisle in list.sortedAisles"
                  :key="aisle.id"
                  type="button"
                  size="sm"
                  :color="draftAisle === aisle.id ? 'primary' : 'neutral'"
                  :variant="draftAisle === aisle.id ? 'solid' : 'outline'"
                  :label="aisle.name"
                  @click="chooseAisle(aisle.id)"
                />
              </div>
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
      <button
        v-for="entry in outstanding"
        :key="entry.key"
        type="button"
        class="flex items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-default/60"
        @click="list.toggleEntry(entry)"
      >
        <span class="size-4 shrink-0 rounded bg-transparent ring ring-accented" />
        <span class="min-w-0 truncate text-sm text-default">{{ entry.name }}</span>
        <span
          v-if="entry.quantityLabel"
          class="ml-auto shrink-0 font-mono text-xs text-dimmed"
        >{{ entry.quantityLabel }}</span>
      </button>

      <button
        v-for="item in list.checkedItems"
        :key="item.id"
        type="button"
        class="flex items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-default/60"
        @click="list.toggleItem(item.id)"
      >
        <span class="flex size-4 shrink-0 items-center justify-center rounded bg-primary">
          <UIcon
            name="i-lucide-check"
            class="size-3 text-inverted"
          />
        </span>
        <span class="min-w-0 truncate text-sm text-dimmed line-through">{{ item.name }}</span>
        <span
          v-if="item.quantity"
          class="ml-auto shrink-0 font-mono text-xs text-dimmed"
        >{{ item.quantity }}</span>
      </button>

      <!--
        Inside the scroll container and pushed down by mt-auto, so on a short
        list it sits under the last row rather than floating at the bottom of an
        empty card.
      -->
      <div class="mt-auto flex items-center justify-between border-t border-default px-2 pt-3">
        <p class="text-xs text-dimmed">
          {{ doneCount }} done · {{ shopping.count }} to buy
        </p>

        <!--
          A plain button, not a UButton: the design calls for a 12px text link
          and the component's own padding, label span and link variant were three
          things to override to get there. It is also a simpler hit target, which
          matters on a wall.
        -->
        <button
          v-if="doneCount"
          type="button"
          class="text-xs font-medium text-muted transition-colors hover:text-default"
          @click="list.clearChecked()"
        >
          Clear done
        </button>
      </div>
    </div>
  </UCard>
</template>
