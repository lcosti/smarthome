<script setup lang="ts">
import { useListStore } from '../stores/list'
import { usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { useSyncStore } from '../stores/sync'
import { buildRecipeLibrary, type LibraryFacet, type LibrarySort } from '../utils/board'
import { looksLikeUrl } from '../utils/recipe-import'
import { dayLabel } from '../utils/week'

/**
 * The library, as something to pick from with room to compare.
 *
 * Master and detail rather than a grid you click through, because choosing a
 * meal is a comparison: you want the picture, the time and what it needs while
 * still looking at the four other things you could cook instead. Clicking a card
 * fills the right-hand pane and nothing navigates — the only way off this screen
 * is a decision.
 *
 * The decisions the pane offers are the reasons anybody opens this: put it on the
 * shortlist so the week's generator leans towards it, read it properly, or buy
 * what it needs. Cooking it is not one of them — that decision is made at the
 * hob, and it lives on the recipe's own page. Everything else about a recipe —
 * rewriting a step, fixing a quantity — is a typing job, and its own page too.
 *
 * `?swap=YYYY-MM-DD` turns it into a picker for that night, which is what
 * Tonight's "Swap meal" opens. A mode on the library rather than a modal:
 * choosing a meal means reading the whole library, and there is no version of
 * that which fits in a dialog.
 */

const recipes = useRecipesStore()
const plan = usePlanStore()
const list = useListStore()
const sync = useSyncStore()
const route = useRoute()
const toast = useToast()

const now = useBoardClock()
const pantryCovers = usePantryCovers()

/** The night being swapped, or null when this is just the library. */
const swapDate = computed(() => {
  const value = route.query.swap
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
})

// --- finding one --------------------------------------------------------------

const query = ref('')
const facet = ref<LibraryFacet>('all')
const sort = ref<LibrarySort>('recent')
const selectedId = ref<string | null>(null)

const SORTS: { value: LibrarySort, label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'quickest', label: 'Quickest' },
  { value: 'cooked', label: 'Most cooked' }
]

const lines = computed(() =>
  [...sync.rowsOf('recipe_ingredients').values()].filter(line => !line.deleted_at)
)

/**
 * A wide screen has a keyboard, so a recipe can start here — but only by
 * address. One box does both jobs, as it does on a phone: what you type narrows
 * the library, and what you paste gets fetched.
 *
 * Declared above the library rather than beside the rest of importing, because
 * the search reads it and `watch` below evaluates that on the spot.
 */
const recipeImport = useRecipeImport()
const searchInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const pasted = computed(() => looksLikeUrl(query.value))

const library = computed(() => buildRecipeLibrary({
  recipes: recipes.recipes,
  lines: lines.value,
  planEntries: plan.liveEntries,
  listItems: list.liveItems,
  now: now.value,
  // A pasted address is on its way to becoming a recipe, not a search for one.
  query: pasted.value ? '' : query.value,
  facet: facet.value,
  sort: sort.value,
  selectedId: selectedId.value,
  pantryCovers: pantryCovers.value
}))

const detail = computed(() => library.value.detail)

/**
 * The selected recipe's own row, for the nutrition panel.
 *
 * Read from the store rather than threaded through LibraryDetail: that model is
 * deliberately "the rows, minus what only an editor needs", and widening it by
 * eight columns to reach one read-only block would put the arithmetic in the
 * board builder instead of beside the thing that draws it.
 */
const detailRecipe = computed(() => detail.value ? recipes.recipeById(detail.value.id) : undefined)

// The builder falls back to the first card when a selection is filtered away, so
// the pane is never empty against a full grid. Writing that choice back keeps the
// ref honest — otherwise clearing the search would jump to a card nobody picked.
watch(detail, (value) => {
  if (value && value.id !== selectedId.value) selectedId.value = value.id
})

function clearSearch() {
  query.value = ''
  facet.value = 'all'
}

// --- the three decisions -------------------------------------------------------

async function choose() {
  const date = swapDate.value
  if (!date || !detail.value) return
  await plan.setNight(date, detail.value.id)
  // Straight back to Today: the swap was the errand, and leaving somebody on
  // the library afterwards makes them find their own way home.
  await navigateTo('/')
}

// Shared with the phone's drawer, which offers the same button off the same
// model — see useRecipeDetail.ts for why these go on as plain ad-hoc items.
const { sending, send } = useRecipeSend()

// --- getting one in ------------------------------------------------------------

async function add() {
  if (recipeImport.busy.value) return

  if (!pasted.value) {
    // Nothing to import yet. Say what this button wants rather than sitting
    // greyed out, and put the cursor where the answer goes.
    searchInput.value?.inputRef?.focus()
    toast.add({ title: 'Paste a recipe’s address to import it', color: 'neutral' })
    return
  }

  const recipeId = await recipeImport.importUrl(query.value.trim())
  if (recipeId) {
    query.value = ''
    facet.value = 'all'
    selectedId.value = recipeId
  } else if (recipeImport.error.value) {
    toast.add({ title: recipeImport.error.value, color: 'error' })
  }
}
</script>

<template>
  <!--
    A screenful, not a page: the two panes scroll independently and the strip
    along the top stays put. h-full rather than a viewport calculation, because
    the shell is already exactly one viewport tall and has taken the app header
    off the top — subtracting it again here would only be right for as long as
    that header stays one line high.
  -->
  <div class="flex h-full min-h-0 flex-col gap-3 px-6 py-4">
    <!-- Title, search and import: one strip, because they are one job. -->
    <div class="flex shrink-0 items-center gap-4">
      <div class="flex items-baseline gap-3">
        <h2 class="text-2xl font-semibold tracking-[-0.025em] text-highlighted">
          {{ swapDate ? 'Pick a meal' : 'Recipes' }}
        </h2>
        <p class="whitespace-nowrap text-base text-muted">
          {{ swapDate ? `for ${dayLabel(swapDate)}` : `${recipes.recipes.length} in the library` }}
        </p>
      </div>

      <UInput
        ref="searchInput"
        v-model="query"
        size="xl"
        :icon="pasted ? 'i-lucide-link' : 'i-lucide-search'"
        :placeholder="`Search ${recipes.recipes.length} recipes, or paste a link`"
        class="ml-auto w-[360px]"
        data-testid="recipe-search"
        @keydown.enter="pasted && add()"
      />

      <UButton
        color="primary"
        variant="solid"
        size="xl"
        :label="recipeImport.busy.value ? 'Importing…' : 'Add recipe'"
        :loading="recipeImport.busy.value"
        class="shrink-0"
        data-testid="recipe-add"
        @click="add()"
      />
    </div>

    <!--
      Facets, then sort. Both describe the grid under them and nothing else.

      Both are radio groups rather than rows of buttons (CLAUDE.md rule 6): each
      is several chips with one answer, which is what a radio models, and it
      brings the roles and the arrow keys with it. This is the same chip as the
      aisle filter on the shopping list — `card` with the indicator hidden, sized
      in `app.config.ts` — because "filter the thing below" is one question and
      wants one answer.

      `horizontal` is load-bearing: the group defaults to vertical, and a column
      flex stretches its items to full width and ignores the flex-wrap.
    -->
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <URadioGroup
        v-model="facet"
        :items="library.facets"
        value-key="key"
        variant="card"
        indicator="hidden"
        orientation="horizontal"
        size="sm"
        color="primary"
        class="shrink-0"
        :ui="{ fieldset: 'flex-wrap gap-1.5' }"
      >
        <template #label="{ item, modelValue }">
          {{ item.label }}
          <span
            class="ms-1 font-mono"
            :class="modelValue === item.key ? 'text-primary/70' : 'text-dimmed'"
          >{{ item.count }}</span>
        </template>
      </URadioGroup>

      <div class="ml-auto flex items-center gap-2">
        <span class="text-sm text-dimmed">Sort</span>
        <URadioGroup
          v-model="sort"
          :items="SORTS"
          variant="card"
          indicator="hidden"
          orientation="horizontal"
          size="sm"
          color="primary"
          class="shrink-0"
          :ui="{ fieldset: 'flex-wrap gap-1.5' }"
        />
      </div>
    </div>

    <div
      v-if="recipes.recipes.length"
      class="grid min-h-0 flex-1 grid-cols-[1.7fr_1fr] gap-4 overflow-hidden"
    >
      <!--
        The padding is not decoration: a selected card is marked with a ring,
        which is a shadow drawn outside the card's own box, and a scrolling
        parent clips it flush against every edge. Two pixels of room is the
        difference between a ring and three sides of one.
      -->
      <div
        v-if="!library.noMatches"
        class="grid min-h-0 auto-rows-min grid-cols-2 content-start gap-3 overflow-y-auto p-0.5 xl:grid-cols-3"
      >
        <BoardRecipeCard
          v-for="card in library.cards"
          :key="card.id"
          :card="card"
          @select="selectedId = card.id"
        />
      </div>

      <UEmpty
        v-else
        icon="i-lucide-search-x"
        :title="`Nothing matches “${query.trim()}”.`"
        description="Press add to make it a new recipe."
        :actions="[{
          label: 'Clear',
          color: 'neutral' as const,
          variant: 'subtle' as const,
          onClick: clearSearch
        }]"
        class="col-span-2 min-h-0"
      />

      <!-- The pane: what it is, what it needs, and the three things to do about it. -->
      <UCard
        v-if="detail"
        variant="outline"
        :ui="{
          root: 'flex min-h-0 flex-col overflow-hidden rounded-lg bg-elevated',
          header: 'px-5 pt-4 pb-3.5 sm:px-5',
          body: 'flex min-h-0 flex-1 flex-col gap-5 p-0 sm:p-0',
          footer: 'flex flex-none flex-col gap-2.5 px-5 py-4 sm:px-5'
        }"
      >
        <template #header>
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            {{ detail.eyebrow }}
          </p>
          <h2
            data-detail-name
            class="mt-2 text-pretty text-xl font-semibold leading-[1.15] tracking-[-0.02em] text-highlighted"
          >
            {{ detail.name }}
          </h2>
          <p class="mt-1.5 font-mono text-sm text-muted">
            {{ detail.meta }}
          </p>
        </template>

        <!--
          shrink-0 on every block in here is load-bearing. This is a fixed-height
          flex column, so without it flexbox shrinks the ingredient list below
          its own content to make the others fit, and the overflow lands on top
          of the block underneath. The column scrolls; the blocks in it keep
          their height.
        -->
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-1 pt-4">
          <!--
            Above the ingredients because it answers the question being asked
            here. This pane exists to choose between meals, and "how heavy is
            it" is a reason to pick one — where the ingredient list is what you
            read once you already have.

            Renders nothing when the recipe has no figures, so a library that
            has never imported a panel looks exactly as it did before.
          -->
          <RecipeNutritionPanel
            v-if="detailRecipe"
            :recipe="detailRecipe"
            class="shrink-0"
          />

          <!-- Same terms again: nothing unless somebody at home currently
               needs a version of this — see the panel's own docblock. -->
          <RecipeAdaptationsPanel
            :recipe-id="detailRecipe?.id ?? null"
            class="shrink-0"
          />

          <div class="shrink-0">
            <h3 class="text-xs font-medium uppercase tracking-wide text-dimmed">
              Ingredients
            </h3>

            <ul
              v-if="detail.ingredients.length"
              class="mt-3 flex flex-col gap-2"
            >
              <li
                v-for="line in detail.ingredients"
                :key="line.id"
                class="flex items-baseline gap-3"
              >
                <!--
                  The dot marks what you would still have to buy. Amber on the
                  ones missing, recessed on the ones already handled — on the list
                  or already in the cupboard, which for this purpose are the same
                  answer. The same reading the block below spells out, available
                  without reading it.
                -->
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
          </div>

          <div
            v-if="detail.history.length"
            class="shrink-0"
          >
            <h3 class="text-xs font-medium uppercase tracking-wide text-dimmed">
              History
            </h3>
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
          </div>

          <div class="min-h-0 flex-1" />
        </div>

        <template #footer>
          <div class="flex gap-2.5">
            <UButton
              v-if="swapDate"
              color="primary"
              variant="solid"
              size="xl"
              :label="`Put on ${dayLabel(swapDate)}`"
              class="flex-1 justify-center"
              data-testid="recipe-put-on"
              @click="choose()"
            />
            <!--
              Shortlisting is the primary action because it is the one that feeds
              the generator: the week is assembled from the library, and this is
              how a person leans on that without picking the night themselves.
              Cooking it right now is a decision made in the kitchen, not in the
              library, and it lives on the recipe's own page.
            -->
            <UButton
              v-else
              :color="detail.shortlisted ? 'neutral' : 'primary'"
              :variant="detail.shortlisted ? 'subtle' : 'solid'"
              size="xl"
              :icon="detail.shortlisted ? 'i-lucide-check' : 'i-lucide-bookmark-plus'"
              :label="detail.shortlisted ? 'On the shortlist' : 'Add to shortlist'"
              class="flex-1 justify-center"
              data-testid="recipe-shortlist"
              @click="recipes.toggleShortlist(detail.id)"
            />
          </div>

          <div
            v-if="!swapDate"
            class="flex gap-2.5"
          >
            <UButton
              :to="`/recipes/${detail.id}`"
              color="neutral"
              variant="subtle"
              size="lg"
              label="View recipe"
              class="flex-1 justify-center"
              data-testid="recipe-view"
            />
            <UButton
              v-if="detail.sendLabel"
              color="neutral"
              variant="subtle"
              size="lg"
              label="Add ingredients to list"
              :loading="sending"
              class="flex-1 justify-center"
              data-testid="recipe-send-list"
              @click="send(detail.missing)"
            />
          </div>
        </template>
      </UCard>
    </div>

    <UEmpty
      v-else
      icon="i-lucide-chef-hat"
      title="No recipes yet."
      description="Type above to add the first one."
      class="flex-1"
    />
  </div>
</template>
