<script setup lang="ts">
import { useIngredientsStore } from '../../../stores/ingredients'
import { useListStore } from '../../../stores/list'
import { useRecipesStore } from '../../../stores/recipes'
import { useSyncStore } from '../../../stores/sync'
import type { IngredientRow } from '../../../utils/db'
import { MEALS, MEAL_COLUMNS, MEAL_LABELS } from '../../../utils/meal'
import { NUTRITION_FIELDS, type NutritionKey } from '../../../utils/nutrition'
import { photoForRecipe, pictureOf } from '../../../utils/photo'
import { tidyBook, tidyPage } from '../../../utils/recipe-source'

const route = useRoute()
const toast = useToast()
const store = useRecipesStore()
const list = useListStore()
const sync = useSyncStore()
const ingredients = useIngredientsStore()

const id = computed(() => String(route.params.id))
const recipe = computed(() => store.recipeById(id.value))
const lines = computed(() => store.ingredientsFor(id.value))
const steps = computed(() => store.stepsFor(id.value))

const estimator = useNutritionEstimate()
/** The estimator only fills blanks, so a full panel gives it nothing to do. */
const nutritionBlanks = computed(() =>
  Boolean(recipe.value && NUTRITION_FIELDS.some(field => recipe.value![field.key] == null))
)

const draftName = ref('')
const draftIngredient = ref('')
const draftStep = ref('')
const editingLineId = ref<string | null>(null)
const editorOpen = ref(false)
const confirmDelete = ref(false)
const editingStepId = ref<string | null>(null)
const stepEditorOpen = ref(false)
const ingredientInput = useTemplateRef<{ focus: () => void }>('ingredientInput')
const photoInput = useTemplateRef<HTMLInputElement>('photoInput')
const savingPhoto = ref(false)

const picture = computed(() => pictureOf(recipe.value))

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

/**
 * Which meals this is one of, as three independent yes/nos.
 *
 * The group hands back the whole set, and the row is upserted whole anyway, so
 * the patch is built from what came back rather than by working out which box
 * moved. Written per change like every other field on this page — there is no
 * save button here and never has been.
 */
const suitsMeals = computed(() =>
  recipe.value ? MEALS.filter(meal => recipe.value![MEAL_COLUMNS[meal]]) : []
)

const mealItems = MEALS.map(meal => ({ label: MEAL_LABELS[meal], value: meal }))

async function setMeals(next: (string | number)[]) {
  if (!recipe.value) return
  const chosen = new Set(next.map(String))
  await store.updateRecipe(id.value, {
    suits_breakfast: chosen.has('breakfast'),
    suits_lunch: chosen.has('lunch'),
    suits_dinner: chosen.has('dinner')
  })
}

async function setNutrition(key: NutritionKey, next: number | null | undefined) {
  const value = typeof next === 'number' && Number.isFinite(next) && next >= 0 ? next : null
  if (!recipe.value || value === recipe.value[key]) return
  await store.updateRecipe(id.value, { [key]: value })
}

/**
 * Where it came from, when it came off a shelf rather than out of a browser.
 *
 * Filled in at the moment the photographs are taken (see `RecipeBookSheet`), and
 * here for everything else: the recipe typed in by hand, the one photographed
 * before this existed, and the page number somebody got wrong. Written on blur
 * like the notes below, because there is no save button on this page.
 *
 * `updateRecipe` does the tidying, so "p. 82" typed into the page box is stored
 * as the page it is — which is also why the comparison below tidies before
 * deciding nothing changed.
 */
async function saveBook(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!recipe.value || tidyBook(value) === recipe.value.source_book) return
  await store.updateRecipe(id.value, { source_book: value })
}

async function savePage(event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (!recipe.value || tidyPage(value) === recipe.value.source_page) return
  await store.updateRecipe(id.value, { source_page: value })
}

async function saveMethod(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value.trim()
  if (!recipe.value || value === (recipe.value.method ?? '')) return
  await store.updateRecipe(id.value, { method: value || null })
}

/**
 * Give the recipe a photograph of the dish.
 *
 * Written the moment it is chosen, like the avatar on a person and unlike the
 * name field above: picking a picture reads as done as soon as it appears, and
 * there is no form here to submit.
 *
 * Shrunk on this device rather than anywhere else — a phone hands over three to
 * twelve megabytes, and the row it is going into is replicated to every device
 * in the house.
 */
async function onPhotoPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Cleared straight away so picking the same file twice in a row still fires.
  input.value = ''
  if (!file || savingPhoto.value) return

  savingPhoto.value = true
  try {
    await store.updateRecipe(id.value, { photo: await photoForRecipe(file) })
  } catch {
    toast.add({
      title: 'That photo could not be read',
      description: 'Try another one, or take a new picture.',
      color: 'warning',
      icon: 'i-lucide-image-off'
    })
  } finally {
    savingPhoto.value = false
  }
}

async function removePhoto() {
  await store.updateRecipe(id.value, { photo: null })
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
        <!-- In the header rather than beside the picture, so it is in the same
             place whether or not there is one to change. -->
        <UButton
          v-if="recipe"
          icon="i-lucide-camera"
          color="neutral"
          variant="ghost"
          :loading="savingPhoto"
          :aria-label="recipe.photo ? 'Change the photo' : 'Add a photo'"
          @click="photoInput?.click()"
        />
        <UButton
          v-if="recipe?.photo"
          icon="i-lucide-image-off"
          color="neutral"
          variant="ghost"
          aria-label="Remove the photo"
          @click="removePhoto"
        />
        <!--
          A bare input rather than UFileUpload, exactly as on the recipe import
          and the person editor: nothing here is visible, the control people see
          is the button beside it, and UFileUpload brings a dropzone this has no
          use for. No `capture`, so the phone offers the camera and the library
          rather than forcing the camera.
        -->
        <input
          ref="photoInput"
          type="file"
          accept="image/*"
          class="hidden"
          data-testid="recipe-photo-input"
          @change="onPhotoPicked"
        >
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

      <UEmpty
        v-else-if="!recipe"
        icon="i-lucide-book-open"
        title="That recipe is gone."
        description="It may have been deleted on another device."
        :actions="[{ label: 'Back to recipes', to: '/recipes', color: 'neutral', variant: 'subtle' }]"
      />

      <template v-else>
        <!--
          No placeholder when there is no picture: the page simply starts at the
          ingredients, which is what a hand-typed recipe has always looked like.
          The wrapper collapses with the image, so nothing reserves the space.
        -->
        <div
          v-if="picture"
          class="-mt-1 aspect-video overflow-hidden rounded-lg bg-elevated/30"
        >
          <RecipeImage
            :src="picture"
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

          <UEmpty
            v-else
            icon="i-lucide-carrot"
            title="Nothing yet."
            description="Add the first ingredient below."
          />

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
          Which meals this is one of. Nothing ticked is the honest default and
          means no opinion rather than "suits nothing" — the plan goes on
          offering it at every slot, and the description says so, because a row
          of empty boxes otherwise reads as a question you have failed to answer.

          Checkboxes because these are three independent yes/nos: a soup is a
          lunch and a dinner, and porridge is only ever one thing.
        -->
        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Meals
          </h2>
          <p class="mb-2 text-sm text-dimmed">
            {{ suitsMeals.length
              ? 'Offered first when you plan one of these.'
              : 'Nothing chosen, so it is offered at every meal.' }}
          </p>
          <UCheckboxGroup
            :model-value="suitsMeals"
            :items="mealItems"
            value-key="value"
            variant="card"
            orientation="horizontal"
            :ui="{ fieldset: 'flex-wrap gap-2', item: 'flex-1 basis-32' }"
            @update:model-value="setMeals"
          />
        </section>

        <!--
          What the source printed, kept as printed. Imports fill these in when
          the page or photo carried a panel; anything else is typed by hand or
          left empty — empty is the honest state, never zero. Nothing sums or
          tracks these; they are facts about one serving of one recipe.
        -->
        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Nutrition
          </h2>
          <p class="mb-2 text-sm text-dimmed">
            Per serving, as the source states it.
          </p>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <UFormField
              v-for="field in NUTRITION_FIELDS"
              :key="field.key"
              :label="field.unit === 'g' ? `${field.label} (g)` : field.label"
            >
              <UInputNumber
                :model-value="recipe[field.key] ?? undefined"
                :min="0"
                :step="field.key === 'kcal' ? 1 : 0.01"
                :format-options="{ maximumFractionDigits: 2 }"
                size="lg"
                class="w-full"
                :aria-label="field.label"
                @update:model-value="setNutrition(field.key, $event)"
              />
            </UFormField>
          </div>

          <!--
            The one deliberate exception to "as the source states it": estimated
            figures land in the same editable boxes, but only the empty ones —
            an estimate never overwrites what a source printed or a person typed.
            Clearing a field is how you ask for it to be re-estimated.
          -->
          <div class="mt-3 flex items-center gap-3">
            <UButton
              icon="i-lucide-sparkles"
              color="neutral"
              variant="subtle"
              label="Estimate the blanks"
              :loading="estimator.busy.value"
              :disabled="!lines.length || !nutritionBlanks"
              @click="estimator.estimate(id)"
            />
            <p
              v-if="estimator.error.value"
              class="text-sm text-error"
            >
              {{ estimator.error.value }}
            </p>
            <p
              v-else
              class="text-sm text-dimmed"
            >
              A model's guess from the ingredients — it fills only what's empty.
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

          <UEmpty
            v-else
            icon="i-lucide-list-ordered"
            title="No method yet."
            description="Add the first step below."
          />

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

        <!--
          The shelf this came off. Empty for a recipe that came from a link —
          the address is the button in the header — and for one somebody typed
          in, which is the honest state rather than a missing field.
        -->
        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Book
          </h2>
          <p class="mb-2 text-sm text-dimmed">
            The photos have the recipe; this is how to find the rest of the page again.
          </p>
          <div class="grid grid-cols-3 gap-3">
            <UFormField
              label="Title"
              class="col-span-2"
            >
              <UInput
                :model-value="recipe.source_book ?? ''"
                size="lg"
                class="w-full"
                placeholder="Ottolenghi Simple"
                autocapitalize="words"
                data-testid="recipe-book"
                @blur="saveBook"
              />
            </UFormField>
            <UFormField label="Page">
              <UInput
                :model-value="recipe.source_page ?? ''"
                size="lg"
                class="w-full"
                placeholder="82"
                data-testid="recipe-page"
                @blur="savePage"
              />
            </UFormField>
          </div>
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
          <ConfirmModal
            v-model:open="confirmDelete"
            :title="`Delete ${recipe.name}?`"
            description="The recipe, its ingredients and its method go with it. Nights already planned from it keep their name but lose the link."
            confirm-label="Delete recipe"
            @confirm="removeRecipe"
          >
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="subtle"
              label="Delete recipe"
            />
          </ConfirmModal>
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
