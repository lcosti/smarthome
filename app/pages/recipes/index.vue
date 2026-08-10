<script setup lang="ts">
import { usePlanStore } from '../../stores/plan'
import { useRecipesStore } from '../../stores/recipes'
import { useSyncStore } from '../../stores/sync'
import { pictureOf } from '../../utils/photo'
import { looksLikeUrl } from '../../utils/recipe-import'
import { dayLabel } from '../../utils/week'

const store = useRecipesStore()
const sync = useSyncStore()
const plan = usePlanStore()
const route = useRoute()

// A wide screen gets master and detail, which is a different tree with a
// different script rather than the same one at another width.
const isWide = useWide()

/**
 * `?swap=YYYY-MM-DD` turns the library into a picker for that night, which is
 * what Tonight's "Swap meal" opens. Handled at both widths, because Tonight is
 * at both widths.
 */
const swapDate = computed(() => {
  const value = route.query.swap
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
})

/**
 * What a tap opens: the recipe, to read.
 *
 * The route behind a row is the editor, which is the wrong screen for deciding
 * what to cook — so a tap opens the sheet, and the sheet offers the editor. The
 * wide tree has answered this with its detail pane all along.
 *
 * Swap mode is the exception and stays a straight assignment: that errand
 * arrived with its answer already chosen, and a sheet in front of it is a tap
 * spent confirming something nobody was unsure about.
 */
const sheetOpen = ref(false)
const sheetId = ref<string | null>(null)

async function pick(recipeId: string) {
  const date = swapDate.value
  if (!date) {
    sheetId.value = recipeId
    sheetOpen.value = true
    return
  }
  await plan.setNight(date, recipeId)
  // Back where the errand started, rather than leaving somebody on the library
  // to find their own way home.
  await navigateTo('/')
}

// One box does three jobs. Typing narrows the library; pressing add turns what
// you typed into a recipe; and a pasted link is fetched rather than made the
// name of an empty one. Separate inputs would mean choosing before you start.
const draft = ref('')

const pasted = computed(() => looksLikeUrl(draft.value))

const matches = computed(() => {
  const needle = draft.value.trim().toLowerCase()
  if (!needle || pasted.value) return store.recipes
  return store.recipes.filter(r => r.name.toLowerCase().includes(needle))
})

// Photograph a cookbook page, or paste the link of one. Multi-select on the
// photo path because a recipe often spans a spread: ingredients on one page,
// method overleaf.
const recipeImport = useRecipeImport()
const photoInput = ref<HTMLInputElement>()
const toast = useToast()

async function add() {
  const typed = draft.value.trim()
  if (!typed || recipeImport.busy.value) return

  if (looksLikeUrl(typed)) {
    const recipeId = await recipeImport.importUrl(typed)
    if (recipeId) draft.value = ''
    await land(recipeId)
    return
  }

  draft.value = ''
  const created = await store.addRecipe({ name: typed })
  if (created) await navigateTo(`/recipes/${created.id}`)
}

async function onPhotosPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return

  await land(await recipeImport.importPhotos(files))
}

/** The new recipe, or the reason there isn't one. */
async function land(recipeId: string | null) {
  if (recipeId) {
    await navigateTo(`/recipes/${recipeId}`)
  } else if (recipeImport.error.value) {
    toast.add({ title: recipeImport.error.value, color: 'error' })
  }
}
</script>

<template>
  <RecipeLibraryWide v-if="isWide" />

  <div
    v-else
    class="flex h-full flex-col"
  >
    <AppPageHeader :title="swapDate ? `Pick a meal for ${dayLabel(swapDate)}` : 'Recipes'">
      <UForm
        :state="{ draft }"
        class="flex gap-2"
        @submit="add"
      >
        <UInput
          v-model="draft"
          size="xl"
          placeholder="Search, add or paste a link"
          autocapitalize="sentences"
          enterkeyhint="done"
          class="flex-1"
          data-testid="recipe-draft"
        />
        <UButton
          type="submit"
          size="xl"
          :icon="recipeImport.busy.value ? '' : (pasted ? 'i-lucide-link' : 'i-lucide-plus')"
          :loading="recipeImport.busy.value"
          :disabled="!draft.trim() || recipeImport.busy.value"
          :aria-label="pasted ? 'Import recipe from the link' : 'Add recipe'"
        />
        <UButton
          size="xl"
          color="neutral"
          variant="outline"
          :icon="recipeImport.busy.value ? '' : 'i-lucide-camera'"
          :loading="recipeImport.busy.value"
          :disabled="recipeImport.busy.value"
          aria-label="Add recipe from a photo"
          @click="photoInput?.click()"
        />
        <!-- A bare input rather than UFileUpload, because nothing here is
             visible: the control people see is the UButton above, and this is
             only the file picker it opens. UFileUpload brings a dropzone and a
             model this flow has no use for.

             No `capture` attribute: on iOS it forces the camera and silently
             drops `multiple`, and a cookbook recipe often needs two photos.
             Without it the phone offers camera or library, both of which work. -->
        <input
          ref="photoInput"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          data-testid="recipe-photo-input"
          @change="onPhotosPicked"
        >
      </UForm>
    </AppPageHeader>

    <main class="mx-auto flex w-full max-w-xl min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-6">
      <LoadingState v-if="!sync.hydrated" />

      <UEmpty
        v-else-if="!store.recipes.length"
        icon="i-lucide-chef-hat"
        title="No recipes yet."
        description="Type above to add the first one."
        class="flex-1"
      />

      <UEmpty
        v-else-if="!matches.length"
        icon="i-lucide-search-x"
        :title="`Nothing matches “${draft.trim()}”.`"
        description="Press add to make it a new recipe."
        class="flex-1"
      />

      <ul
        v-else
        class="mt-3 rounded-lg border border-default bg-elevated/30"
      >
        <RecipeRow
          v-for="item in matches"
          :key="item.id"
          :name="item.name"
          :ingredient-count="store.ingredientsFor(item.id).length"
          :servings="item.base_servings"
          :image-url="pictureOf(item)"
          @select="pick(item.id)"
        />
      </ul>
    </main>

    <RecipeSheet
      v-model:open="sheetOpen"
      :recipe-id="sheetId"
    />
  </div>
</template>
