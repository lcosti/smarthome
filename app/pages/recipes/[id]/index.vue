<script setup lang="ts">
import { useIngredientsStore } from '../../../stores/ingredients'
import { useListStore } from '../../../stores/list'
import { usePeopleStore } from '../../../stores/people'
import { useRecipesStore } from '../../../stores/recipes'
import { useSyncStore } from '../../../stores/sync'
import {
  ADAPTATION_STAGES,
  audienceLabel,
  ingredientOverrideText,
  type AdaptationStage,
  type SuggestedAdaptation
} from '../../../utils/adaptations'
import { DIET_KIND, normaliseTag } from '../../../utils/attendance'
import type { IngredientRow } from '../../../utils/db'
import { MEALS, MEAL_COLUMNS, MEAL_LABELS } from '../../../utils/meal'
import { NUTRITION_FIELDS, type NutritionKey } from '../../../utils/nutrition'
import { photoForRecipe, pictureOf } from '../../../utils/photo'

const route = useRoute()
const toast = useToast()
const store = useRecipesStore()
const list = useListStore()
const sync = useSyncStore()
const ingredients = useIngredientsStore()

const people = usePeopleStore()

const id = computed(() => String(route.params.id))
const recipe = computed(() => store.recipeById(id.value))
const lines = computed(() => store.ingredientsFor(id.value))
const steps = computed(() => store.stepsFor(id.value))
const adaptations = computed(() => store.adaptationsFor(id.value))

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

const editingAdaptationId = ref<string | null>(null)
const adaptationEditorOpen = ref(false)

/**
 * Who an adaptation could be for: the four stages, then whatever diets the
 * household actually holds — a diet nobody is on would never show, so it is
 * not offered. Audiences this recipe already has drop out; their row is above.
 */
const audienceOptions = computed(() => {
  const taken = new Set(adaptations.value.map(a => a.life_stage ?? `diet:${a.diet_tag}`))
  const stages = ADAPTATION_STAGES
    .filter(stage => !taken.has(stage))
    .map(stage => ({ label: audienceLabel({ life_stage: stage, diet_tag: null }), value: `stage:${stage}` }))
  const diets = [...new Set(
    people.constraints
      .filter(row => row.kind === DIET_KIND)
      .map(row => normaliseTag(row.tag))
  )]
    .filter(tag => !taken.has(`diet:${tag}`))
    .sort()
    .map(tag => ({ label: tag, value: `diet:${tag}` }))
  return [...stages, ...diets]
})

/** A picked audience is an adaptation: created, then straight into its editor. */
async function addAdaptation(value: string) {
  const audience = value.startsWith('stage:')
    ? { life_stage: value.slice('stage:'.length) as AdaptationStage }
    : { diet_tag: value.slice('diet:'.length) }
  const row = await store.upsertAdaptation(id.value, audience)
  if (!row) return
  editingAdaptationId.value = row.id
  adaptationEditorOpen.value = true
}

function editAdaptation(adaptationId: string) {
  editingAdaptationId.value = adaptationId
  adaptationEditorOpen.value = true
}

/** "2 changes · No salt in theirs." — enough to know which row to open. */
function adaptationSummary(adaptationId: string, note: string | null): string {
  const count = store.adaptationItemsFor(adaptationId).length
  const changes = count ? `${count} ${count === 1 ? 'change' : 'changes'}` : ''
  return [changes, note?.trim()].filter(Boolean).join(' · ') || 'Nothing written yet.'
}

const suggester = useAdaptationSuggest()

/** A proposal's overrides as the sentences the saved version will say. */
function suggestionLines(suggestion: SuggestedAdaptation): string[] {
  const overrides = suggestion.ingredient_overrides.map((override) => {
    const line = store.ingredientById(override.recipe_ingredient_id)
    return ingredientOverrideText(override.action, line?.name ?? 'ingredient', override.body)
  })
  const amendments = suggestion.step_amendments.map((amendment) => {
    const index = steps.value.findIndex(step => step.id === amendment.recipe_step_id)
    return index >= 0 ? `Step ${index + 1} — ${amendment.body}` : amendment.body
  })
  return [...overrides, ...amendments]
}

async function acceptSuggestion(suggestion: SuggestedAdaptation) {
  const row = await suggester.accept(id.value, suggestion)
  // Straight into the editor, which is where accepting ends anyway: the point
  // of review is reading what landed with the power to prune it.
  if (row) editAdaptation(row.id)
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
          Versions of this meal for whoever needs one — the weaning baby, the
          toddler, an adult on a named diet. Every stored adaptation is listed,
          matching or not: you write for next month's audience, and the panels
          elsewhere decide what currently shows. Stored as overrides on the
          base, never folded into the ingredients or steps above.
        -->
        <section>
          <h2 class="mb-1 text-xs font-medium uppercase tracking-wide text-dimmed">
            Adaptations
          </h2>

          <ul
            v-if="adaptations.length"
            class="divide-y divide-default rounded-lg border border-default bg-elevated/30"
          >
            <li
              v-for="adaptation in adaptations"
              :key="adaptation.id"
            >
              <UButton
                color="neutral"
                variant="ghost"
                block
                class="min-h-12 min-w-0 gap-2 px-3 py-3 text-left font-normal"
                @click="editAdaptation(adaptation.id)"
              >
                <UBadge
                  variant="subtle"
                  size="sm"
                  class="shrink-0"
                >
                  {{ audienceLabel(adaptation) }}
                </UBadge>
                <span class="min-w-0 flex-1 truncate text-sm text-dimmed">
                  {{ adaptationSummary(adaptation.id, adaptation.note) }}
                </span>
              </UButton>
            </li>
          </ul>

          <!-- Choosing an audience is the whole decision, so picking one
               creates the adaptation and opens it — no second button. -->
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <USelectMenu
              :model-value="undefined"
              :items="audienceOptions"
              value-key="value"
              size="lg"
              class="w-full sm:w-64"
              placeholder="Add an adaptation for…"
              aria-label="Add an adaptation"
              @update:model-value="addAdaptation"
            />
            <UButton
              icon="i-lucide-sparkles"
              color="neutral"
              variant="subtle"
              size="lg"
              label="Suggest adaptations"
              :loading="suggester.busy.value"
              :disabled="!lines.length"
              @click="suggester.suggest(id)"
            />
          </div>

          <p
            v-if="suggester.error.value"
            class="mt-2 text-sm text-error"
          >
            {{ suggester.error.value }}
          </p>

          <!--
            Proposals, not writes: a model's suggestions for whoever is at the
            table, each waiting on Add or the cross. Generated weaning guidance
            gets read by the person who knows the child — the brief's safety
            note, kept by making review the only path in.
          -->
          <ul
            v-if="suggester.suggestions.value.length"
            class="mt-3 space-y-3"
          >
            <li
              v-for="(suggestion, index) in suggester.suggestions.value"
              :key="index"
              class="rounded-lg border border-dashed border-default px-4 py-3.5"
            >
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <p class="flex items-baseline gap-2">
                    <UBadge
                      variant="subtle"
                      size="sm"
                    >
                      {{ audienceLabel(suggestion) }}
                    </UBadge>
                    <span class="text-xs text-dimmed">suggested</span>
                  </p>
                  <p
                    v-if="suggestion.note"
                    class="mt-2 text-sm leading-relaxed text-default"
                  >
                    {{ suggestion.note }}
                  </p>
                  <ul
                    v-if="suggestionLines(suggestion).length"
                    class="mt-2 space-y-1"
                  >
                    <li
                      v-for="line in suggestionLines(suggestion)"
                      :key="line"
                      class="text-sm leading-relaxed text-muted"
                    >
                      {{ line }}
                    </li>
                  </ul>
                </div>
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Dismiss this suggestion"
                  @click="suggester.dismiss(suggestion)"
                />
              </div>
              <UButton
                color="neutral"
                variant="subtle"
                size="sm"
                label="Add to the recipe"
                class="mt-3"
                @click="acceptSuggestion(suggestion)"
              />
            </li>
          </ul>
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

    <RecipeAdaptationEditor
      v-model:open="adaptationEditorOpen"
      :adaptation-id="editingAdaptationId"
    />
  </div>
</template>
