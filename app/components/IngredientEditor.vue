<script setup lang="ts">
import { asBaseUnit, useIngredientsStore } from '../stores/ingredients'
import type { BaseUnit } from '../utils/quantity'

const open = defineModel<boolean>('open', { required: true })
const { ingredientId } = defineProps<{ ingredientId: string | null }>()

const store = useIngredientsStore()
const toast = useToast()

const name = ref('')
const baseUnit = ref<BaseUnit>('count')
const aisleId = ref<string | null>(null)
const newAlias = ref('')
const unitName = ref('')
const unitAmount = ref('')
const merging = ref(false)

const ingredient = computed(() => (ingredientId ? store.ingredientById(ingredientId) ?? null : null))
const aliases = computed(() => (ingredientId ? store.aliasesFor(ingredientId) : []))
const units = computed(() => (ingredientId ? store.purchaseUnitsFor(ingredientId) : []))

/** Anything else it could be folded into. */
const mergeTargets = computed(() =>
  store.ingredients.filter(i => i.id !== ingredientId)
)

const UNITS: { value: BaseUnit, label: string }[] = [
  { value: 'g', label: 'Weight (g)' },
  { value: 'ml', label: 'Volume (ml)' },
  { value: 'count', label: 'Each' }
]

watch(open, (isOpen) => {
  if (!isOpen || !ingredient.value) {
    merging.value = false
    return
  }
  name.value = ingredient.value.name
  baseUnit.value = ingredient.value.base_unit === 'g' || ingredient.value.base_unit === 'ml'
    ? ingredient.value.base_unit
    : 'count'
  aisleId.value = ingredient.value.aisle_id
  newAlias.value = ''
  unitName.value = ''
  unitAmount.value = ''
  merging.value = false
}, { immediate: true })

async function save() {
  if (!ingredientId || !name.value.trim()) return
  // A purchase unit's amount is written in the base unit, so changing the
  // measure would silently turn "1 tin = 400g" into "1 tin = 400 each" and
  // multiply every tin on the list by it. Clear them and say so instead.
  const measureChanged = ingredient.value && baseUnit.value !== asBaseUnit(ingredient.value.base_unit)
  const staleUnits = measureChanged ? [...units.value] : []
  await store.updateIngredient(ingredientId, {
    name: name.value.trim(),
    base_unit: baseUnit.value,
    aisle_id: aisleId.value
  })
  if (staleUnits.length) {
    for (const unit of staleUnits) await store.removePurchaseUnit(unit.id)
    toast.add({
      title: 'Purchase units cleared',
      description: 'Their amounts were in the old measure. Add them again in the new one.',
      icon: 'i-lucide-info',
      color: 'neutral'
    })
  }
  open.value = false
}

async function addAlias() {
  if (!ingredientId) return
  const alias = newAlias.value.trim()
  if (!alias) return
  newAlias.value = ''
  await store.recordAlias(ingredientId, alias)
}

async function addUnit() {
  if (!ingredientId) return
  const amount = Number(unitAmount.value.replace(',', '.'))
  if (!unitName.value.trim() || !(amount > 0)) return
  await store.addPurchaseUnit(ingredientId, { name: unitName.value.trim(), amount })
  unitName.value = ''
  unitAmount.value = ''
}

async function mergeInto(winnerId: string) {
  if (!ingredientId) return
  await store.mergeIngredients(ingredientId, winnerId)
  open.value = false
}

async function remove() {
  if (!ingredientId) return
  await store.deleteIngredient(ingredientId)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    :title="ingredient?.name ?? 'Ingredient'"
  >
    <template #body>
      <div
        v-if="ingredient"
        class="space-y-5"
      >
        <UFormField label="Name">
          <UInput
            v-model="name"
            size="xl"
            class="w-full"
            autocapitalize="sentences"
          />
        </UFormField>

        <UFormField
          label="Measured in"
          help="What quantities are added up in. Change it if the guess was wrong."
        >
          <URadioGroup
            v-model="baseUnit"
            :items="UNITS"
            variant="card"
            orientation="horizontal"
            :ui="{ fieldset: 'flex-wrap gap-2', item: 'flex-1 basis-32' }"
          />
        </UFormField>

        <UFormField
          label="Aisle"
          help="Where this lives in the shop, for every recipe that uses it."
        >
          <AislePicker v-model="aisleId" />
        </UFormField>

        <UFormField
          label="Also called"
          help="Other names that mean this. Recipes using them group together."
        >
          <div class="flex flex-wrap gap-2">
            <UBadge
              v-for="alias in aliases"
              :key="alias.id"
              color="neutral"
              variant="subtle"
              size="lg"
            >
              {{ alias.alias }}
              <UButton
                type="button"
                icon="i-lucide-x"
                color="neutral"
                variant="link"
                size="xs"
                :aria-label="`Remove ${alias.alias}`"
                :ui="{ base: 'p-0 ms-1' }"
                @click="store.removeAlias(alias.id)"
              />
            </UBadge>
          </div>
          <UForm
            :state="{ newAlias }"
            class="mt-2 flex gap-2"
            @submit="addAlias"
          >
            <UInput
              v-model="newAlias"
              size="lg"
              placeholder="tinned tomatoes"
              autocapitalize="none"
              class="flex-1"
            />
            <UButton
              type="submit"
              size="lg"
              icon="i-lucide-plus"
              :disabled="!newAlias.trim()"
              aria-label="Add name"
            />
          </UForm>
        </UFormField>

        <UFormField
          label="How it's bought"
          :help="`So the list can say '2 tins' as well as '800${baseUnit === 'count' ? '' : baseUnit}'.`"
        >
          <ul
            v-if="units.length"
            class="mb-2 divide-y divide-default rounded-lg border border-default"
          >
            <li
              v-for="unit in units"
              :key="unit.id"
              class="flex items-center gap-2 px-3 py-2 text-sm"
            >
              <span class="flex-1 truncate">
                1 {{ unit.name }} = {{ unit.amount }}{{ baseUnit === 'count' ? '' : baseUnit }}
              </span>
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Remove ${unit.name}`"
                @click="store.removePurchaseUnit(unit.id)"
              />
            </li>
          </ul>
          <UForm
            :state="{ unitName, unitAmount }"
            class="flex gap-2"
            @submit="addUnit"
          >
            <UInput
              v-model="unitName"
              size="lg"
              placeholder="tin"
              autocapitalize="none"
              class="flex-1"
            />
            <UInput
              v-model="unitAmount"
              size="lg"
              inputmode="decimal"
              placeholder="400"
              class="w-24"
            />
            <UButton
              type="submit"
              size="lg"
              icon="i-lucide-plus"
              :disabled="!unitName.trim() || !unitAmount.trim()"
              aria-label="Add purchase unit"
            />
          </UForm>
        </UFormField>

        <UFormField
          v-if="merging"
          label="Merge into"
          help="This one becomes another name for whichever you pick. Nothing is lost."
        >
          <div class="flex max-h-48 flex-col gap-1 overflow-y-auto">
            <UButton
              v-for="target in mergeTargets"
              :key="target.id"
              color="neutral"
              variant="subtle"
              size="lg"
              block
              @click="mergeInto(target.id)"
            >
              {{ target.name }}
            </UButton>
          </div>
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="!mergeTargets.length"
          @click="merging = !merging"
        >
          {{ merging ? 'Cancel merge' : 'Merge' }}
        </UButton>
        <UButton
          color="error"
          variant="ghost"
          @click="remove"
        >
          Delete
        </UButton>
        <div class="flex-1" />
        <UButton
          size="lg"
          :disabled="!name.trim()"
          @click="save"
        >
          Save
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
