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
 * The three decisions the pane offers are the three reasons anybody opens this:
 * cook it now, put it on a night, or buy what it needs. Everything else about a
 * recipe — rewriting a step, fixing a quantity — is a typing job, and its own
 * page.
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

const sending = ref(false)

/**
 * What this recipe needs that isn't already on the list.
 *
 * Deliberately the plain add path rather than the plan's derivation: these items
 * have no plan entry behind them — somebody decided to buy for a recipe without
 * committing to a night — and giving them a provenance they don't have would put
 * them in line to be swept up when that night changed.
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

    <p
      v-if="recipeImport.progress.value"
      class="shrink-0 text-sm text-muted"
    >
      {{ recipeImport.progress.value }}
    </p>

    <!-- Facets, then sort. Both describe the grid under them and nothing else. -->
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <UButton
        v-for="option in library.facets"
        :key="option.key"
        :color="facet === option.key ? 'primary' : 'neutral'"
        :variant="facet === option.key ? 'soft' : 'ghost'"
        size="lg"
        class="rounded-full px-3.5 py-1.5 text-sm"
        :data-facet="option.key"
        :data-active="facet === option.key ? '' : undefined"
        @click="facet = option.key"
      >
        {{ option.label }}
        <span
          class="font-mono text-xs"
          :class="facet === option.key ? 'text-primary/70' : 'text-dimmed'"
        >{{ option.count }}</span>
      </UButton>

      <div class="ml-auto flex items-center gap-2">
        <span class="text-sm text-dimmed">Sort</span>
        <UButton
          v-for="option in SORTS"
          :key="option.value"
          color="neutral"
          :variant="sort === option.value ? 'subtle' : 'ghost'"
          size="lg"
          :label="option.label"
          class="rounded-lg px-3 py-1.5 text-sm"
          :class="sort === option.value ? 'text-default' : 'text-dimmed'"
          @click="sort = option.value"
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
        title="Nothing matches"
        :ui="{ avatar: 'size-10', title: 'text-2xl font-semibold', description: 'text-base text-muted' }"
        :description="`No recipe here answers to “${query.trim()}”.`"
        :actions="[{
          label: 'Clear',
          color: 'neutral' as const,
          variant: 'subtle' as const,
          size: 'xl' as const,
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
          <p class="font-mono text-xs uppercase tracking-[0.14em] text-dimmed">
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
          <div class="shrink-0">
            <h3 class="font-mono text-xs uppercase tracking-[0.14em] text-dimmed">
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
                  class="shrink-0 font-mono text-[10px] uppercase tracking-wider text-dimmed"
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

          <!--
            What is genuinely left: neither on the list nor in the cupboard. Both
            are facts the app actually holds, which is what makes this safe to put
            a "buy these" button under.
          -->
          <div
            v-if="detail.missing.length && detail.ingredients.length"
            class="shrink-0"
          >
            <h3 class="font-mono text-xs uppercase tracking-[0.14em] text-dimmed">
              Not on the list yet
            </h3>
            <div class="mt-3 flex flex-wrap gap-2">
              <UBadge
                v-for="line in detail.missing"
                :key="line.id"
                color="primary"
                variant="subtle"
                size="lg"
                class="items-baseline gap-1.5"
              >
                {{ line.name }}
                <span
                  v-if="line.quantity"
                  class="font-mono text-xs opacity-70"
                >{{ line.quantity }}</span>
              </UBadge>
            </div>
          </div>

          <div
            v-if="detail.history.length"
            class="shrink-0"
          >
            <h3 class="font-mono text-xs uppercase tracking-[0.14em] text-dimmed">
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
            <template v-else>
              <UButton
                :to="`/recipes/${detail.id}/cook`"
                color="primary"
                variant="solid"
                size="xl"
                label="Cook tonight"
                class="flex-1 justify-center"
                data-testid="recipe-cook"
              />
              <UButton
                :to="`/recipes/${detail.id}`"
                color="neutral"
                variant="subtle"
                size="xl"
                label="Edit"
                class="flex-1 justify-center"
              />
            </template>
          </div>

          <UButton
            v-if="detail.sendLabel && !swapDate"
            color="neutral"
            variant="ghost"
            size="lg"
            :label="detail.sendLabel"
            :loading="sending"
            class="justify-center text-muted"
            data-testid="recipe-send-list"
            @click="sendToList()"
          />
        </template>
      </UCard>
    </div>

    <UEmpty
      v-else
      icon="i-lucide-book-open"
      title="No recipes yet"
      :ui="{ avatar: 'size-10', title: 'text-2xl font-semibold', description: 'text-base text-muted' }"
      description="Paste a recipe’s address above, or add one from a photo on your phone — the generator builds the week out of them."
      class="flex-1"
    />
  </div>
</template>
