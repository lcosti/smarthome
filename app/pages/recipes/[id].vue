<script setup lang="ts">
import { useIngredientsStore } from '../../stores/ingredients'
import { useListStore } from '../../stores/list'
import { useRecipesStore } from '../../stores/recipes'
import { useSyncStore } from '../../stores/sync'
import type { IngredientRow } from '../../utils/db'

const route = useRoute()
const store = useRecipesStore()
const list = useListStore()
const sync = useSyncStore()
const ingredients = useIngredientsStore()

const id = computed(() => String(route.params.id))
const recipe = computed(() => store.recipeById(id.value))
const lines = computed(() => store.ingredientsFor(id.value))

const draftName = ref('')
const draftIngredient = ref('')
const editingLineId = ref<string | null>(null)
const editorOpen = ref(false)
const ingredientInput = useTemplateRef<{ focus: () => void }>('ingredientInput')

watch(recipe, (value) => {
  if (value && document.activeElement?.tagName !== 'INPUT') draftName.value = value.name
}, { immediate: true })

function aisleNameFor(aisleId: string | null) {
  return aisleId ? list.aisles.get(aisleId)?.name ?? null : null
}

async function renameOnBlur() {
  const name = draftName.value.trim()
  if (!recipe.value || !name || name === recipe.value.name) return
  await store.updateRecipe(id.value, { name })
}

async function addIngredient(name: string, chosen: IngredientRow | null) {
  // Clear first so the next one can be typed straight away. Quantity and aisle
  // are one tap away in the editor; asking for them here would turn eight
  // ingredients into twenty-four decisions.
  draftIngredient.value = ''
  // Everything on a recipe is an ingredient by definition, so an unknown name is
  // worth a canonical row. Picking a suggestion instead records what was typed as
  // an alias, so next time this resolves without anybody choosing.
  const ingredientId = await ingredients.linkFor(name, { chosen })
  const line = chosen ? { name: chosen.name } : { name }
  await store.addIngredient(id.value, { ...line, ingredient_id: ingredientId })
  ingredientInput.value?.focus()
}

function editLine(lineId: string) {
  editingLineId.value = lineId
  editorOpen.value = true
}

async function setServings(delta: number) {
  if (!recipe.value) return
  const next = Math.max(1, recipe.value.base_servings + delta)
  await store.updateRecipe(id.value, { base_servings: next })
}

async function saveMethod(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value.trim()
  if (!recipe.value || value === (recipe.value.method ?? '')) return
  await store.updateRecipe(id.value, { method: value || null })
}

async function removeRecipe() {
  await store.deleteRecipe(id.value)
  await navigateTo('/recipes')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="shrink-0 border-b border-default bg-default">
      <div class="mx-auto flex max-w-xl items-center gap-1 px-3 py-2">
        <UButton
          to="/recipes"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to recipes"
        />
        <UInput
          v-if="recipe"
          v-model="draftName"
          variant="ghost"
          size="xl"
          class="flex-1 font-semibold"
          aria-label="Recipe name"
          @blur="renameOnBlur"
          @keydown.enter="renameOnBlur"
        />
      </div>
    </header>

    <main class="mx-auto w-full max-w-xl min-h-0 flex-1 space-y-8 overflow-y-auto px-3 py-5">
      <div
        v-if="!sync.hydrated"
        class="py-16 text-center text-sm text-muted"
      >
        Loading…
      </div>

      <div
        v-else-if="!recipe"
        class="py-16 text-center"
      >
        <p class="text-muted">
          That recipe is gone.
        </p>
        <p class="mt-1 text-sm text-dimmed">
          It may have been deleted on another device.
        </p>
        <UButton
          to="/recipes"
          class="mt-4"
          color="neutral"
          variant="subtle"
        >
          Back to recipes
        </UButton>
      </div>

      <template v-else>
        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Ingredients
          </h2>

          <ul
            v-if="lines.length"
            class="rounded-lg border border-default bg-elevated/30"
          >
            <IngredientLineRow
              v-for="(item, index) in lines"
              :key="item.id"
              :name="item.name"
              :quantity="item.quantity"
              :aisle-name="aisleNameFor(item.aisle_id)"
              :can-move-up="index > 0"
              :can-move-down="index < lines.length - 1"
              @edit="editLine(item.id)"
              @move-up="store.moveIngredient(item.id, -1)"
              @move-down="store.moveIngredient(item.id, 1)"
            />
          </ul>

          <p
            v-else
            class="rounded-lg border border-default bg-elevated/30 px-3 py-6 text-center text-sm text-dimmed"
          >
            Nothing yet. Add the first ingredient below.
          </p>

          <form
            class="mt-2 flex gap-2"
            @submit.prevent="addIngredient(draftIngredient.trim(), null)"
          >
            <IngredientSuggest
              ref="ingredientInput"
              v-model="draftIngredient"
              placeholder="Add an ingredient"
              @submit="addIngredient"
            />
            <UButton
              type="submit"
              size="xl"
              icon="i-lucide-plus"
              :disabled="!draftIngredient.trim()"
              aria-label="Add ingredient"
            />
          </form>
        </section>

        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Serves
          </h2>
          <div class="flex items-center gap-2">
            <UButton
              icon="i-lucide-minus"
              size="xl"
              color="neutral"
              variant="subtle"
              :disabled="recipe.base_servings <= 1"
              aria-label="Fewer servings"
              @click="setServings(-1)"
            />
            <span class="w-10 text-center text-lg tabular-nums">{{ recipe.base_servings }}</span>
            <UButton
              icon="i-lucide-plus"
              size="xl"
              color="neutral"
              variant="subtle"
              aria-label="More servings"
              @click="setServings(1)"
            />
            <p class="ml-2 flex-1 text-sm text-dimmed">
              What the quantities above are written for.
            </p>
          </div>
        </section>

        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Notes
          </h2>
          <UTextarea
            :model-value="recipe.method ?? ''"
            :rows="4"
            size="xl"
            class="w-full"
            placeholder="Anything worth remembering next time."
            aria-label="Notes"
            @blur="saveMethod"
          />
        </section>

        <section>
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="subtle"
            @click="removeRecipe"
          >
            Delete recipe
          </UButton>
        </section>
      </template>
    </main>

    <IngredientLineEditor
      v-model:open="editorOpen"
      :line-id="editingLineId"
    />
  </div>
</template>
