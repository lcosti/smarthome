<script setup lang="ts">
import { useListStore, type AisleSection } from '../stores/list'
import type { ListEntry } from '../utils/aggregate'
import { aisleIcon } from '../utils/aisles'
import type { ItemRow } from '../utils/db'

/**
 * One aisle, as a card you can walk down.
 *
 * The card is the unit the shop is actually organised in, and the count in the
 * corner is the question you ask standing at the end of it: is there anything
 * left down here. Ticked rows stay in place, struck through, rather than moving
 * to a pile at the bottom of the page — where something was is how you check you
 * did not miss it.
 *
 * The rows are a `UCheckboxGroup`. What the group models is exactly what an
 * aisle is — a set of things, any of them ticked — so it brings the fieldset,
 * the roles and the keyboard handling with it, and the box is the checkbox
 * theme's own rather than a drawing of one.
 *
 * Ticking goes straight to the store, as it does on the board: it is idempotent
 * and needs nothing from the page. Editing is emitted, because which overlay
 * opens is the page's decision.
 */
const { section, showChecked = true } = defineProps<{
  section: AisleSection
  showChecked?: boolean
}>()

const emit = defineEmits<{
  editEntry: [entry: ListEntry<ItemRow>]
  editItem: [id: string]
}>()

const store = useListStore()

interface Row {
  value: string
  label: string
  /** How much to get, and which recipes asked — chips rather than a sentence. */
  quantity: string | null
  source: string | null
  /** The pantry already has all of it. Not ticked, but nothing to buy either. */
  covered: boolean
  checked: boolean
  /** Several rows behind one line means editing has to pick one of them first. */
  grouped: boolean
  toggle: () => void
  edit: () => void
}

/**
 * Unchecked lines first, then what is already in the trolley.
 *
 * The unchecked ones are aggregated — two recipes wanting milk is one line —
 * while the ticked ones are the raw rows, because once something is in the
 * trolley the question is no longer "how much" and un-ticking half a merged line
 * would have to guess which half.
 */
const rows = computed<Row[]>(() => {
  const list: Row[] = section.entries.map(entry => ({
    value: entry.key,
    label: entry.name,
    quantity: entry.quantityLabel,
    source: store.sourceLabelForEntry(entry),
    covered: entry.pantry !== null && entry.pantry.toBuy === 0,
    checked: false,
    grouped: entry.items.length > 1,
    toggle: () => store.toggleEntry(entry),
    edit: () => emit('editEntry', entry)
  }))

  if (!showChecked) return list

  for (const item of section.checked) {
    list.push({
      value: item.id,
      label: item.name,
      quantity: item.quantity,
      source: store.sourceLabelFor(item),
      covered: false,
      checked: true,
      grouped: false,
      toggle: () => store.toggleItem(item.id),
      edit: () => emit('editItem', item.id)
    })
  }

  return list
})

const byValue = computed(() => new Map(rows.value.map(row => [row.value, row])))

const items = computed(() => rows.value.map(row => ({ value: row.value, label: row.label })))

const checkedValues = computed(() => rows.value.filter(row => row.checked).map(row => row.value))

/**
 * The group hands back the whole set, so what actually moved is the difference.
 *
 * Written this way rather than one handler per row because that is the shape
 * `UCheckboxGroup` speaks in, and a set difference cannot miss a row the way a
 * per-row index can when the list re-sorts underneath it.
 */
function onUpdate(next: unknown) {
  const after = new Set((next as string[]) ?? [])
  const before = new Set(checkedValues.value)
  for (const row of rows.value) {
    if (after.has(row.value) !== before.has(row.value)) row.toggle()
  }
}

const icon = computed(() => aisleIcon(section.name))
const cleared = computed(() => section.total > 0 && section.done === section.total)
</script>

<template>
  <!--
    `subtle` rather than a hand-mixed background: it is the variant that already
    means "lifted off the page and outlined", and the divider between the header
    and the rows comes with it.
  -->
  <UCard
    variant="subtle"
    :ui="{
      header: 'px-3.5 py-3 sm:px-3.5',
      body: 'p-0 sm:p-0'
    }"
  >
    <template #header>
      <div class="flex items-center gap-2.5">
        <UIcon
          :name="icon"
          class="size-5 shrink-0 text-dimmed"
        />
        <h2 class="min-w-0 flex-1 truncate font-semibold text-highlighted">
          {{ section.name }}
        </h2>
        <UBadge
          :color="cleared ? 'primary' : 'neutral'"
          variant="subtle"
          size="sm"
          class="font-mono"
        >
          {{ section.done }}/{{ section.total }}
        </UBadge>
      </div>
    </template>

    <!--
      `list` and not `card`: the card variant makes the whole row a <label>, and
      a label wrapping the edit button double-fires on iOS. As a list the root is
      a plain element and only the text is the label, so the row is still a full
      tap target and the button beside it is not.
    -->
    <UCheckboxGroup
      :model-value="checkedValues"
      :items="items"
      variant="list"
      size="lg"
      color="primary"
      :ui="{
        fieldset: 'flex-col gap-0',
        item: 'items-center gap-3 px-3 py-3 border-b border-default last:border-b-0 transition-colors hover:bg-elevated/40',
        wrapper: 'min-w-0 flex-1',
        base: 'size-5'
      }"
      @update:model-value="onUpdate"
    >
      <template #label="{ item }">
        <ShoppingItemLabel
          v-if="byValue.has(item.value)"
          :label="byValue.get(item.value)!.label"
          :quantity="byValue.get(item.value)!.quantity"
          :source="byValue.get(item.value)!.source"
          :covered="byValue.get(item.value)!.covered"
          :checked="byValue.get(item.value)!.checked"
          :grouped="byValue.get(item.value)!.grouped"
          @edit="byValue.get(item.value)!.edit()"
        />
      </template>
    </UCheckboxGroup>
  </UCard>
</template>
