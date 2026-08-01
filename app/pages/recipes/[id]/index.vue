<script setup lang="ts">
import { useListStore } from '../../../stores/list'
import { usePlanStore } from '../../../stores/plan'
import { useRecipesStore } from '../../../stores/recipes'
import { useSyncStore } from '../../../stores/sync'
import { buildRecipeLibrary } from '../../../utils/board'
import { pictureOf } from '../../../utils/photo'

/**
 * The recipe as something to read, which is what a tap on the library opens.
 *
 * The wide library answers "shall we have this?" in its detail pane — how heavy
 * it is, what it would still need, when it was last had — and a phone deserves
 * the same answers rather than being dropped into the editor, where the first
 * accidental touch reorders an ingredient. So this page carries the pane's
 * content and its decisions (shortlist it, buy what it needs), plus the steps,
 * which the pane leaves out because a pane is for comparing and a page is for
 * reading. Every typing job is one deliberate press away behind the pencil,
 * on /recipes/[id]/edit.
 */

const route = useRoute()
const store = useRecipesStore()
const plan = usePlanStore()
const list = useListStore()
const sync = useSyncStore()
const toast = useToast()

const now = useBoardClock()
const pantryCovers = usePantryCovers()

const id = computed(() => String(route.params.id))
const recipe = computed(() => store.recipeById(id.value))
const steps = computed(() => store.stepsFor(id.value))
const picture = computed(() => pictureOf(recipe.value))

/**
 * The wide pane's own view model, handed just this recipe. One implementation
 * of "what is missing, what is already in the cupboard, when was it cooked"
 * rather than a second one that drifts from what the desktop says.
 */
const detail = computed(() => {
  if (!recipe.value) return null
  return buildRecipeLibrary({
    recipes: [recipe.value],
    lines: store.ingredientsFor(id.value),
    planEntries: plan.liveEntries,
    listItems: list.liveItems,
    now: now.value,
    query: '',
    facet: 'all',
    sort: 'recent',
    selectedId: id.value,
    pantryCovers: pantryCovers.value
  }).detail
})

const sending = ref(false)

/**
 * What this recipe needs that isn't already on the list.
 *
 * The plain add path rather than the plan's derivation, exactly as on the wide
 * library: these items have no plan entry behind them — somebody decided to buy
 * for a recipe without committing to a night — and giving them a provenance
 * they don't have would put them in line to be swept up when that night changed.
 */
async function sendToList() {
  const missing = detail.value?.missing
  if (!missing?.length || sending.value) return
  sending.value = true
  try {
    for (const line of missing) {
      await list.addItem(line.name, { quantity: line.quantity, aisleId: line.aisleId })
    }
    toast.add({ title: `Added ${missing.length === 1 ? '1 item' : `${missing.length} items`}`, color: 'success' })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <AppPageHeader
      back="/recipes"
      back-label="Back to recipes"
      :title="recipe?.name"
    >
      <template #actions>
        <!-- Reading, cooking and editing are three different evenings. Cook mode
             is for standing at the hob; the pencil is for the typing jobs. -->
        <UButton
          v-if="recipe"
          :to="`/recipes/${id}/cook`"
          icon="i-lucide-chef-hat"
          color="neutral"
          variant="ghost"
          aria-label="Cook this recipe"
        />
        <UButton
          v-if="recipe"
          :to="`/recipes/${id}/edit`"
          icon="i-lucide-pencil"
          color="neutral"
          variant="ghost"
          aria-label="Edit this recipe"
          data-testid="recipe-edit"
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

      <UEmpty
        v-else-if="!recipe"
        icon="i-lucide-book-open"
        title="That recipe is gone."
        description="It may have been deleted on another device."
        :actions="[{ label: 'Back to recipes', to: '/recipes', color: 'neutral', variant: 'subtle' }]"
      />

      <template v-else-if="detail">
        <!-- No placeholder when there is no picture, same as the editor: the
             page simply starts at the facts. -->
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
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            {{ detail.eyebrow }}
          </p>
          <p class="mt-1.5 font-mono text-sm text-muted">
            {{ detail.meta }}
          </p>

          <!--
            The pane's two decisions, up here where a thumb reaches them without
            scrolling past the ingredients. Shortlisting is primary for the same
            reason it is on the wide library: it is how a person says "this week,
            please" without picking the night themselves.
          -->
          <div class="mt-4 flex flex-col gap-2.5">
            <UButton
              :color="detail.shortlisted ? 'neutral' : 'primary'"
              :variant="detail.shortlisted ? 'subtle' : 'solid'"
              size="xl"
              :icon="detail.shortlisted ? 'i-lucide-check' : 'i-lucide-bookmark-plus'"
              :label="detail.shortlisted ? 'On the shortlist' : 'Add to shortlist'"
              class="justify-center"
              data-testid="recipe-shortlist"
              @click="store.toggleShortlist(id)"
            />
            <UButton
              v-if="detail.sendLabel"
              color="neutral"
              variant="subtle"
              size="lg"
              :label="detail.sendLabel"
              :loading="sending"
              class="justify-center"
              data-testid="recipe-send-list"
              @click="sendToList()"
            />
          </div>
        </section>

        <!-- Renders nothing when the recipe has no figures, so a hand-typed
             recipe reads exactly as it did before there was a panel. -->
        <RecipeNutritionPanel :recipe="recipe" />

        <section>
          <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Ingredients
          </h2>

          <ul
            v-if="detail.ingredients.length"
            class="mt-3 flex flex-col gap-2"
          >
            <li
              v-for="line in detail.ingredients"
              :key="line.id"
              class="flex items-baseline gap-3"
            >
              <!-- The dot marks what you would still have to buy, exactly as on
                   the wide pane: amber for missing, recessed for handled. -->
              <span
                class="size-1.5 shrink-0 translate-y-[-2px] rounded-full"
                :class="line.onList || line.inPantry ? 'bg-accented' : 'bg-primary'"
              />
              <span class="min-w-0 flex-1 text-sm text-default">{{ line.name }}</span>
              <span
                v-if="line.inPantry && !line.onList"
                class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-dimmed"
              >pantry</span>
              <span
                v-if="line.quantity"
                class="shrink-0 whitespace-nowrap font-mono text-xs text-dimmed"
              >{{ line.quantity }}</span>
            </li>
          </ul>

          <p
            v-else
            class="mt-3 text-sm text-dimmed"
          >
            No ingredients listed.
          </p>
        </section>

        <section v-if="steps.length">
          <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Steps
          </h2>
          <ol class="mt-3 flex flex-col gap-3">
            <li
              v-for="(step, index) in steps"
              :key="step.id"
              class="flex gap-3"
            >
              <span class="w-5 shrink-0 pt-px text-right font-mono text-sm text-dimmed">{{ index + 1 }}</span>
              <p class="min-w-0 flex-1 whitespace-pre-line text-sm leading-relaxed text-default">
                {{ step.body }}
              </p>
            </li>
          </ol>
        </section>

        <section v-if="recipe.method">
          <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Notes
          </h2>
          <p class="mt-3 whitespace-pre-line text-sm leading-relaxed text-default">
            {{ recipe.method }}
          </p>
        </section>

        <section v-if="detail.history.length">
          <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
            History
          </h2>
          <ul class="mt-3 flex flex-col gap-1.5">
            <li
              v-for="entry in detail.history"
              :key="entry.date"
              class="flex items-baseline gap-4"
            >
              <span class="w-[62px] shrink-0 font-mono text-sm text-muted">{{ entry.dateLabel }}</span>
              <span class="text-sm text-dimmed">{{ entry.label }}</span>
            </li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>
