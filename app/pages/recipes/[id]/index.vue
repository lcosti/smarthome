<script setup lang="ts">
import { useIngredientsStore } from '../../../stores/ingredients'
import { useListStore } from '../../../stores/list'
import { useRecipesStore } from '../../../stores/recipes'
import { useSyncStore } from '../../../stores/sync'
import type { IngredientRow } from '../../../utils/db'

const route = useRoute()
const store = useRecipesStore()
const list = useListStore()
const sync = useSyncStore()
const ingredients = useIngredientsStore()

const id = computed(() => String(route.params.id))
const recipe = computed(() => store.recipeById(id.value))
const lines = computed(() => store.ingredientsFor(id.value))
const steps = computed(() => store.stepsFor(id.value))

const draftName = ref('')
const draftIngredient = ref('')
const draftStep = ref('')
const editingLineId = ref<string | null>(null)
const editorOpen = ref(false)
const editingStepId = ref<string | null>(null)
const stepEditorOpen = ref(false)
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

function editStep(stepId: string) {
  editingStepId.value = stepId
  stepEditorOpen.value = true
}

async function addStep() {
  const body = draftStep.value.trim()
  if (!body) return
  // Cleared first, like the ingredient box above: a method is typed one step
  // after another and waiting on a write between them is the whole friction.
  draftStep.value = ''
  await store.addStep(id.value, body)
}

async function setServings(next: number) {
  if (!recipe.value || !Number.isFinite(next)) return
  await store.updateRecipe(id.value, { base_servings: Math.max(1, next) })
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
    <AppPageHeader
      back="/recipes"
      back-label="Back to recipes"
    >
      <template #title>
        <UInput
          v-if="recipe"
          v-model="draftName"
          variant="ghost"
          size="xl"
          class="min-w-0 flex-1 font-semibold"
          aria-label="Recipe name"
          @blur="renameOnBlur"
          @keydown.enter="renameOnBlur"
        />
      </template>

      <template #actions>
        <!-- This page is for editing a recipe; cook mode is for standing at the
             hob with it. One press between them, from either direction. -->
        <UButton
          v-if="recipe"
          :to="`/recipes/${recipe.id}/cook`"
          icon="i-lucide-chef-hat"
          color="neutral"
          variant="ghost"
          aria-label="Cook this recipe"
        />
        <!-- Imported recipes keep their address: the page has the photographs,
             the comments and whatever the method left out. -->
        <UButton
          v-if="recipe?.source_url"
          :to="recipe.source_url"
          target="_blank"
          rel="noopener"
          icon="i-lucide-external-link"
          color="neutral"
          variant="ghost"
          aria-label="View the original page"
        />
      </template>
    </AppPageHeader>

    <main class="mx-auto min-h-0 w-full max-w-xl flex-1 space-y-8 overflow-y-auto px-3 py-5 lg:max-w-3xl lg:px-6 lg:pb-12">
      <LoadingState v-if="!sync.hydrated" />

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
        <!--
          No placeholder when there is no picture: the page simply starts at the
          ingredients, which is what a hand-typed recipe has always looked like.
          The wrapper collapses with the image, so nothing reserves the space.
        -->
        <div
          v-if="recipe.image_url"
          class="-mt-1 aspect-video overflow-hidden rounded-lg bg-elevated/30"
        >
          <RecipeImage
            :src="recipe.image_url"
            :alt="recipe.name"
          />
        </div>

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

          <UForm
            :state="{ draftIngredient }"
            class="mt-2 flex gap-2"
            @submit="addIngredient(draftIngredient.trim(), null)"
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
          </UForm>
        </section>

        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Serves
          </h2>
          <div class="flex items-center gap-2">
            <UInputNumber
              :model-value="recipe.base_servings"
              :min="1"
              size="xl"
              class="w-36"
              aria-label="Servings"
              @update:model-value="setServings"
            />
            <p class="ml-2 flex-1 text-sm text-dimmed">
              What the quantities above are written for.
            </p>
          </div>
        </section>

        <!--
          The method, as the ordered thing it is. It used to live in the Notes
          box below, which meant an imported recipe buried its own notes under a
          wall of instructions and the board had to guess where one step ended.
        -->
        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Steps
          </h2>

          <ol
            v-if="steps.length"
            class="rounded-lg border border-default bg-elevated/30"
          >
            <RecipeStepRow
              v-for="(step, index) in steps"
              :key="step.id"
              :body="step.body"
              :position="index + 1"
              :can-move-up="index > 0"
              :can-move-down="index < steps.length - 1"
              @edit="editStep(step.id)"
              @move-up="store.moveStep(step.id, -1)"
              @move-down="store.moveStep(step.id, 1)"
            />
          </ol>

          <p
            v-else
            class="rounded-lg border border-default bg-elevated/30 px-3 py-6 text-center text-sm text-dimmed"
          >
            No method yet. Add the first step below.
          </p>

          <UForm
            :state="{ draftStep }"
            class="mt-2 flex items-end gap-2"
            @submit="addStep"
          >
            <!--
              A textarea, so enter means a new line the way it does everywhere
              else you write a paragraph. That costs enter-to-submit, which is
              why the button is beside it rather than implied.
            -->
            <UTextarea
              v-model="draftStep"
              :rows="2"
              autoresize
              size="xl"
              class="flex-1"
              placeholder="Add a step"
              aria-label="Add a step"
            />
            <UButton
              type="submit"
              size="xl"
              icon="i-lucide-plus"
              :disabled="!draftStep.trim()"
              aria-label="Add step"
            />
          </UForm>
        </section>

        <!-- Notes is notes again: what the method left out, not the method. -->
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

    <RecipeStepEditor
      v-model:open="stepEditorOpen"
      :step-id="editingStepId"
    />
  </div>
</template>
