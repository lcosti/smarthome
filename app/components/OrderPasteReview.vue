<script setup lang="ts">
import { asBaseUnit, useIngredientsStore } from '../stores/ingredients'
import { useListStore } from '../stores/list'
import { usePantryStore } from '../stores/pantry'
import type { IngredientRow } from '../utils/db'
import { matchOrderLines, parseOrderText, type OrderMatch } from '../utils/order-paste'
import { formatBaseAmount } from '../utils/quantity'

/**
 * Putting a shop away by pasting the order confirmation.
 *
 * The parser is a heuristic and this component exists because of that. Nothing is
 * written until every line has been read by a person, which is why the raw text of
 * each line stays on screen next to what the app made of it — a mis-read "1kg" is
 * obvious beside the words it came from, and invisible on its own.
 *
 * Lines the app could not match, or could not size, arrive unticked. The default
 * is always to write nothing.
 */
const emit = defineEmits<{ done: [count: number] }>()

const ingredients = useIngredientsStore()
const list = useListStore()
const pantry = usePantryStore()
const toast = useToast()

const text = ref('')
const matches = ref<OrderMatch[]>([])
const reviewing = ref(false)
const saving = ref(false)

function baseUnitOf(ingredientId: string) {
  return asBaseUnit(ingredients.ingredientById(ingredientId)?.base_unit ?? 'count')
}

function read() {
  const lines = parseOrderText(text.value)
  matches.value = matchOrderLines(lines, {
    // Resolve only, never create. An order confirmation is full of things that
    // are not ingredients, and inventing a canonical row for "carrier bag" would
    // quietly fill the library with rubbish.
    resolve: name => ingredients.resolve(name) ?? null,
    baseUnitOf,
    purchaseUnitsOf: id => ingredients.purchaseUnitsFor(id),
    neededOf: id => list.neededByIngredient.get(id) ?? 0
  })
  reviewing.value = true
}

/** Pointing a line at the right thing also teaches the app the shop's wording. */
async function match(index: number, typed: string, chosen: IngredientRow | null) {
  const current = matches.value[index]
  if (!current) return
  const ingredient = chosen ?? ingredients.resolve(typed)
  if (!ingredient) return

  await ingredients.recordAlias(ingredient.id, current.line.name)

  const [remapped] = matchOrderLines([current.line], {
    resolve: () => ({ id: ingredient.id, name: ingredient.name }),
    baseUnitOf,
    purchaseUnitsOf: id => ingredients.purchaseUnitsFor(id),
    neededOf: id => list.neededByIngredient.get(id) ?? 0
  })
  if (remapped) matches.value[index] = remapped
}

const included = computed(() => matches.value.filter(m => m.include && m.ingredientId && m.deposit > 0))

async function save() {
  saving.value = true
  try {
    const saved = await pantry.deposit(
      included.value.map(m => ({ ingredientId: m.ingredientId!, baseAmount: m.deposit }))
    )
    toast.add({
      title: saved ? `Put ${saved} thing${saved === 1 ? '' : 's'} away` : 'Nothing to put away',
      icon: 'i-lucide-package-check'
    })
    text.value = ''
    matches.value = []
    reviewing.value = false
    emit('done', saved)
  } finally {
    saving.value = false
  }
}

function cancel() {
  matches.value = []
  reviewing.value = false
}

function amountLabel(amount: number, ingredientId: string | null) {
  return formatBaseAmount(amount, ingredientId ? baseUnitOf(ingredientId) : 'count')
}
</script>

<template>
  <div class="space-y-3">
    <template v-if="!reviewing">
      <UTextarea
        v-model="text"
        :rows="5"
        placeholder="Paste an order confirmation here"
        autocapitalize="none"
        class="w-full"
      />
      <UButton
        color="neutral"
        variant="subtle"
        block
        size="lg"
        :disabled="!text.trim()"
        @click="read()"
      >
        Read the order
      </UButton>
    </template>

    <template v-else>
      <UEmpty
        v-if="!matches.length"
        icon="i-lucide-search-x"
        title="Nothing in that looked like shopping."
      />

      <ul
        v-else
        class="divide-y divide-default rounded-lg border border-default"
      >
        <li
          v-for="(entry, index) in matches"
          :key="entry.line.raw + index"
          class="space-y-2 px-3 py-3"
        >
          <div class="flex items-start gap-3">
            <UCheckbox
              v-model="matches[index]!.include"
              :disabled="!entry.ingredientId"
              class="mt-1"
            />
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm">
                {{ entry.ingredientName ?? entry.line.name }}
              </p>
              <!--
                Always visible, never a tooltip. It is the only way to tell a good
                match from a plausible one.
              -->
              <p class="truncate text-xs text-dimmed">
                {{ entry.line.raw }}
              </p>
            </div>
          </div>

          <div
            v-if="entry.ingredientId"
            class="flex items-center gap-2 pl-7"
          >
            <UInput
              v-model.number="matches[index]!.deposit"
              type="number"
              size="sm"
              min="0"
              class="w-28"
            />
            <span class="text-xs text-dimmed">
              {{ baseUnitOf(entry.ingredientId) === 'count' ? 'to add' : `${baseUnitOf(entry.ingredientId)} to add` }}
              <template v-if="entry.needed > 0">
                · list wanted {{ amountLabel(entry.needed, entry.ingredientId) }}
              </template>
            </span>
          </div>

          <div
            v-else
            class="pl-7"
          >
            <IngredientSuggest
              :model-value="entry.line.name"
              size="md"
              placeholder="Match to an ingredient"
              @submit="(typed, chosen) => match(index, typed, chosen)"
            />
          </div>
        </li>
      </ul>

      <div class="flex gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          size="lg"
          @click="cancel()"
        >
          Cancel
        </UButton>
        <UButton
          class="flex-1"
          size="lg"
          block
          :loading="saving"
          :disabled="!included.length"
          @click="save()"
        >
          Put {{ included.length }} away
        </UButton>
      </div>
    </template>
  </div>
</template>
