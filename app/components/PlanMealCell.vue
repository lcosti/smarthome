<script setup lang="ts">
import { dishLabel, type PlannedEntry } from '../stores/plan'
import { MEAL_ICONS, MEAL_LABELS, type Meal } from '../utils/meal'

/**
 * Breakfast or lunch on one day — the day's other two slots.
 *
 * One component at both widths, for the reason `PlanNightCard` is: the wide
 * grid's small cells and the two rows under the phone's dinner are the same
 * question asked in two layouts, and two components would drift over what
 * tapping one does.
 *
 * A stock `UButton` rather than a card, and that is a claim about breakfast
 * rather than a shortcut. A dinner is a block — a photograph, a name, minutes at
 * the stove, what it costs at the shop — and needs its own grid, which is what
 * puts `PlanNightCard` under the card-and-row exception in CLAUDE.md. Porridge
 * is a name. Nothing here needs a layout a label cannot do, so nothing here
 * needs an exception.
 *
 * There is no way to take a meal off from here. Removal lives in the editor,
 * which is one tap away and already has the button — a cross on a cell this
 * small would be most of the cell.
 */
const { date, meal, planned = null, tall = false } = defineProps<{
  date: string
  meal: Meal
  /** The slot's entry, or null when it is empty. */
  planned?: PlannedEntry | null
  /**
   * Fill the cell rather than being one row high.
   *
   * For the wide grid, where a day is a band of equal height and a button one
   * line tall floating in the top of a cell reads as something that failed to
   * load. An empty cell drops its label there as well — the column heading two
   * inches above it already says "Breakfast", and the cell repeating it is the
   * same word twice.
   *
   * False on the phone, where these are two rows under the dinner with no
   * headings over them and no band to fill.
   */
  tall?: boolean
}>()

defineEmits<{ open: [] }>()

/**
 * Somewhere a dish can be dropped, and — when it has one — something that can be
 * picked up and carried to another day's cell of the same slot.
 */
const drag = usePlanDrag()
const root = useTemplateRef<{ $el?: HTMLElement } | HTMLElement>('root')

const slot = computed(() => drag.slotKey(date, meal))
const isOver = computed(() => drag.overSlot.value === slot.value)
const isSource = computed(() =>
  drag.payload.value?.kind === 'night' && drag.payload.value.entryId === planned?.entry.id
)

/** `UButton` is a component, so the element to hit-test against is its root node. */
function elementOf(instance: unknown): HTMLElement | null {
  if (!instance) return null
  const el = (instance as { $el?: unknown }).$el ?? instance
  return el instanceof HTMLElement ? el : null
}

watchEffect(() => drag.registerTarget(slot.value, elementOf(root.value)))
onBeforeUnmount(() => drag.registerTarget(slot.value, null))

function pickUp(event: PointerEvent) {
  if (!planned) return
  drag.press(event, {
    kind: 'night',
    entryId: planned.entry.id,
    date,
    meal,
    label: dishLabel(planned),
    image: null
  })
}
</script>

<template>
  <!--
    Empty says which slot it is, because that is the only thing an empty cell
    knows and the column heading is not always above it — on a phone these two
    are a pair of rows under a dinner, with no table around them. In the grid,
    where there is a heading, it is a plus and a space to put something in.

    `outline` is the dashed variant in this app's theme, which is the shape an
    empty cell wants: an outline around somewhere a meal goes, rather than a
    filled box pretending something is already there.

    Planned says the dish, and the slot becomes the icon: the name is the fact
    worth the width, and a cell reading "Lunch · Leftovers · Chilli" spends half
    of itself on the label of the box it is already in.
  -->
  <UButton
    ref="root"
    color="neutral"
    :variant="planned ? 'soft' : (tall ? 'outline' : 'ghost')"
    :icon="planned ? MEAL_ICONS[meal] : 'i-lucide-plus'"
    :label="planned || !tall ? (planned ? dishLabel(planned) : MEAL_LABELS[meal]) : undefined"
    block
    class="touch-manipulation select-none transition-colors"
    :class="[
      tall && 'h-full',
      planned ? 'items-start justify-start' : 'justify-center text-dimmed',
      isOver && 'ring-2 ring-primary bg-primary/5',
      isSource && 'opacity-40'
    ]"
    :ui="{ label: 'truncate' }"
    @pointerdown="pickUp"
    @click="$emit('open')"
  >
    <template
      v-if="planned?.derived"
      #trailing
    >
      <!--
        Shopped-for, in the one place a cell this size has for a second fact.
        Same badge the night card carries, so "on the list" looks the same
        wherever the plan says it.
      -->
      <UBadge
        color="primary"
        variant="soft"
        size="sm"
        icon="i-lucide-check"
        label="On list"
        class="ms-auto shrink-0"
      />
    </template>
  </UButton>
</template>
