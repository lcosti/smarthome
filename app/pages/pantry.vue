<script setup lang="ts">
import { asBaseUnit, useIngredientsStore } from '../stores/ingredients'
import { usePantryStore, type PantryEntry } from '../stores/pantry'
import { useSyncStore } from '../stores/sync'
import type { IngredientRow } from '../utils/db'
import { formatBaseAmount, parseQuantity, toBaseAmount, type BaseUnit } from '../utils/quantity'

/**
 * What is already in the house.
 *
 * The point of this page is not bookkeeping — nobody is going to run an inventory
 * on their own kitchen. It is the two onions left over from a three-pack, so that
 * next week's list stops asking for onions. Everything here is therefore built to
 * be corrected in one tap rather than maintained: steppers for the common case,
 * a typed amount for when somebody actually looks in the cupboard, and no
 * suggestion anywhere that the number is expected to be exact.
 */
const ingredients = useIngredientsStore()
const pantry = usePantryStore()
const sync = useSyncStore()

const name = ref('')
const amount = ref('')
const pasting = ref(false)
const suggest = useTemplateRef<{ focus: () => void }>('suggest')

/**
 * One press of a stepper, in base units.
 *
 * How the household buys the thing, when it has said — a tin at a time beats a
 * gram at a time. Otherwise one of something counted, or a round hundred of a
 * weight, which is a sensible size of nudge for a bag of flour.
 */
function stepFor(entry: PantryEntry): number {
  const unit = ingredients.purchaseUnitsFor(entry.ingredientId)[0]
  if (unit && unit.amount > 0 && entry.baseUnit !== 'count') return unit.amount
  return entry.baseUnit === 'count' ? 1 : 100
}

function stepLabel(entry: PantryEntry): string {
  return formatBaseAmount(stepFor(entry), entry.baseUnit)
}

/**
 * A typed amount in an ingredient's own base unit.
 *
 * Free text, read by the same parser the recipes use, so "2 tins" works wherever
 * the household has said what a tin is. A bare number means the base unit, which
 * is what somebody typing "3" into a field labelled grams means.
 */
function readAmount(text: string, ingredientId: string, baseUnit: BaseUnit): number | null {
  const parsed = parseQuantity(text)
  if (!parsed) return null
  const exact = toBaseAmount(parsed, baseUnit, ingredients.purchaseUnitsFor(ingredientId))
  if (exact !== null) return exact
  return parsed.unit ? null : parsed.amount
}

async function add(typed: string, chosen: IngredientRow | null) {
  // Created if it is new, because something being put in the pantry is an
  // ingredient by definition — unlike a name typed onto the shopping list.
  const ingredientId = await ingredients.linkFor(typed, { quantity: amount.value || null, chosen })
  if (!ingredientId) return

  const baseUnit = asBaseUnit(ingredients.ingredientById(ingredientId)?.base_unit ?? 'count')
  // No amount typed is the fast path: one of whatever it is.
  const typedAmount = amount.value.trim()
    ? readAmount(amount.value, ingredientId, baseUnit)
    : (baseUnit === 'count' ? 1 : null)
  if (typedAmount === null) return

  await pantry.setStock(ingredientId, pantry.onHandOf(ingredientId) + typedAmount)
  name.value = ''
  amount.value = ''
  suggest.value?.focus()
}

async function setTo(entry: PantryEntry, text: string) {
  const next = readAmount(text, entry.ingredientId, entry.baseUnit)
  if (next === null) return
  await pantry.setStock(entry.ingredientId, next)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <AppPageHeader
      title="Pantry"
      back="/settings"
      back-label="Back to settings"
    >
      <div class="flex gap-2">
        <IngredientSuggest
          ref="suggest"
          v-model="name"
          placeholder="What's in the cupboard"
          @submit="add"
        />
        <UInput
          v-model="amount"
          size="xl"
          placeholder="How much"
          autocapitalize="none"
          autocomplete="off"
          class="w-28 shrink-0"
          enterkeyhint="done"
        />
      </div>
    </AppPageHeader>

    <main class="mx-auto min-h-0 w-full max-w-xl flex-1 space-y-6 overflow-y-auto px-3 py-4 lg:max-w-3xl">
      <LoadingState v-if="!sync.hydrated" />

      <template v-else>
        <p
          v-if="!pantry.stocked.length"
          class="rounded-lg border border-default bg-elevated/30 px-3 py-8 text-center text-sm text-dimmed"
        >
          Nothing recorded yet. Add what is left over from a shop and the list
          will stop asking for it.
        </p>

        <ul
          v-else
          class="divide-y divide-default rounded-lg border border-default"
        >
          <li
            v-for="entry in pantry.stocked"
            :key="entry.row.id"
            class="flex items-center gap-2 px-3 py-2"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate">
                {{ entry.name }}
              </p>
              <p class="truncate text-xs text-dimmed">
                {{ entry.label }}
                <!--
                  Only worth saying when the two numbers differ. "2, all spoken
                  for" is a useful warning; "2, 2 free" is noise.
                -->
                <template v-if="entry.available < entry.onHand">
                  ·
                  {{ entry.available > 0
                    ? `${formatBaseAmount(entry.available, entry.baseUnit)} not yet planned`
                    : 'all planned in' }}
                </template>
              </p>
            </div>

            <UButton
              icon="i-lucide-minus"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="`Take ${stepLabel(entry)} of ${entry.name} out`"
              @click="pantry.adjust(entry.ingredientId, -stepFor(entry))"
            />
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="`Put ${stepLabel(entry)} more ${entry.name} in`"
              @click="pantry.adjust(entry.ingredientId, stepFor(entry))"
            />
            <!--
              Not a UInputNumber, unlike the servings steppers. This field takes
              "2 tins" as readily as "800", because the amount is in the
              ingredient's own base unit and nobody weighs a tin — see readAmount.
              A numeric input can only hold the number, which is the half of the
              answer the parser exists to avoid asking for.
            -->
            <UInput
              :model-value="String(entry.onHand)"
              size="sm"
              class="w-20 shrink-0"
              :aria-label="`How much ${entry.name} there is`"
              enterkeyhint="done"
              @change="setTo(entry, ($event.target as HTMLInputElement).value)"
            />
          </li>
        </ul>

        <section class="space-y-2">
          <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Put a shop away
          </h2>
          <p class="text-sm text-muted">
            Paste an order confirmation and everything in it goes in the cupboard.
            Nothing is saved until you have looked at what it found.
          </p>

          <UButton
            v-if="!pasting"
            color="neutral"
            variant="subtle"
            size="lg"
            block
            icon="i-lucide-clipboard-paste"
            @click="pasting = true"
          >
            Paste an order
          </UButton>
          <OrderPasteReview
            v-else
            @done="pasting = false"
          />
        </section>
      </template>
    </main>
  </div>
</template>
