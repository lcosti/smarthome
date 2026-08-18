<script setup lang="ts">
import { usePlanStore } from '../../stores/plan'
import { useRecipesStore } from '../../stores/recipes'
import { useSyncStore } from '../../stores/sync'
import { pictureOf } from '../../utils/photo'
import { looksLikeUrl } from '../../utils/recipe-import'
import type { RecipeSourceFields } from '../../utils/recipe-source'
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
const toast = useToast()

/**
 * One hidden input, and the phone's own chooser — with the camera in it.
 *
 * iOS puts up a sheet with Take Photo on it for any file input. Chrome on
 * Android 14+ does not, when every `accept` value is an image or video type:
 * it opens the system photo picker, which is the gallery with no way to the
 * camera, so "add a recipe from a photo" quietly became "from a photo you
 * already took". Anything else in the list — here the non-standard
 * `android/allowCamera`, which is what the web settled on — sends Chrome back
 * to the intent chooser, which offers Camera and Files and honours `multiple`.
 * iOS ignores the type it does not know.
 *
 * Not `capture`: that means one shot per tap and iOS drops `multiple`
 * alongside it, which would cost the spread this feature is mostly used for.
 * The price of the chooser is that its Files branch can pick any file at all;
 * `useRecipeImport` catches a file that will not decode and says so.
 */
const photoInput = ref<HTMLInputElement>()

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

/** The answer "Not from a book" gives, which is also what dismissing it means. */
const NO_BOOK: RecipeSourceFields = { source_book: null, source_page: null }

const bookOpen = ref(false)
const bookSaving = ref(false)
let pendingPhotos: Promise<string | null> | null = null

/** Whatever the chooser handed over: straight off to be read. */
function onPhotosPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (files.length) startPhotos(files)
}

/**
 * The pages are settled: start reading them, and ask which book they came out
 * of while that happens.
 *
 * The two run over each other on purpose. Extraction is ten or twenty seconds of
 * standing still, and the book and page are the one thing the photographs cannot
 * carry — so the question goes in the time that was being spent waiting, and
 * answering it costs nothing. Whoever finishes first waits for the other: a quick
 * "Not from a book" waits on the spinner exactly as this did before the question
 * existed, and a slow answer finds the recipe already saved.
 *
 * The answer lands as a second write rather than as part of the insert, which is
 * what lets it be asked late. Two upserts of one row is what this app's whole
 * sync layer is built to shrug at.
 */
function startPhotos(files: File[]) {
  const reading = recipeImport.importPhotos(files)
  pendingPhotos = reading
  bookOpen.value = true

  // A read that failed has nothing to hang a book on. It takes the question away
  // itself and says what went wrong, rather than making somebody finish
  // answering a question about a recipe that does not exist.
  void reading.then((recipeId) => {
    if (!recipeId) finishPhotos(NO_BOOK)
  })
}

/** Both buttons in the sheet, and dismissing it, end up here exactly once. */
async function finishPhotos(source: RecipeSourceFields) {
  const reading = pendingPhotos
  pendingPhotos = null
  if (!reading) return

  // Whether the photographs had been read by the time this was answered. If they
  // had, the page the sheet offered was on screen and whatever is in `source` is
  // the verdict on it — an empty box means somebody cleared it.
  const sawTheReading = recipeImport.pageSeen.value !== null

  bookSaving.value = true
  const recipeId = await reading
  bookSaving.value = false
  bookOpen.value = false

  // Answered before the reading arrived, and answered with a book: the page the
  // photographs turned out to show fills the blank it was never offered for.
  // Same rule the nutrition estimator states — fill blanks, overwrite nothing —
  // and it makes the outcome the same whether you answer in five seconds or
  // twenty. Never on "Not from a book", which is a no to the whole question.
  const page = source.source_page
    ?? (!sawTheReading && source.source_book ? recipeImport.pageSeen.value : null)

  if (recipeId && (source.source_book || page)) {
    await store.updateRecipe(recipeId, { ...source, source_page: page })
  }
  await land(recipeId)
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
          type="button"
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
             visible: the control people see is the button above, and this is
             only the picker it opens. UFileUpload brings a dropzone and a model
             this flow has no use for. The second accept value is what keeps
             the camera in Android's chooser — see `photoInput`. -->
        <input
          ref="photoInput"
          type="file"
          accept="image/*,android/allowCamera"
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

    <!-- Dismissing it is an answer too — the same one "Not from a book" gives,
         so a swipe down never leaves the new recipe unopened. -->
    <RecipeBookSheet
      v-model:open="bookOpen"
      :loading="bookSaving"
      :suggested-page="recipeImport.pageSeen.value"
      @done="finishPhotos"
      @update:open="value => value || finishPhotos(NO_BOOK)"
    />
  </div>
</template>
