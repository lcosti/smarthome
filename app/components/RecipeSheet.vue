<script setup lang="ts">
import { useRecipesStore } from '../stores/recipes'

/**
 * A recipe, on a phone, as something to read rather than edit.
 *
 * The wide library answers "which of these am I cooking?" in a pane beside the
 * grid. A phone has no room for a pane, and the page a tap used to land on is
 * the editor — an inline title field, eight nutrition inputs and a delete
 * button — which is the wrong screen for a decision. This is the pane, on a
 * phone: the same `LibraryDetail` (see `useRecipeDetail`), the same figures, the
 * same two decisions along the bottom.
 *
 * A `UDrawer` where the app's other eight bottom sheets are `USlideover`
 * (CLAUDE.md rule 6). Every one of those is a form — open it, type, save, shut
 * it — and one height is right for all of them. This is reading of unknown
 * length: the top of it chooses the meal and the rest of it cooks the meal, and
 * no single height serves both. `UDrawer` has snap points and a grab handle;
 * `USlideover` has neither, and faking them would mean rebuilding the drag.
 *
 * The footer offers `/recipes/:id` once, not twice: on this app that route is
 * the editor, so "view" and "edit" are the same door.
 */

const open = defineModel<boolean>('open', { required: true })
const { recipeId } = defineProps<{ recipeId: string | null }>()

const recipes = useRecipesStore()

const detail = useRecipeDetail(toRef(() => recipeId))
const { sending, send } = useRecipeSend()

/** The recipe's own row, for the nutrition panel — same reason as the wide pane. */
const recipe = computed(() => (recipeId ? recipes.recipeById(recipeId) : undefined))
const steps = computed(() => (recipeId ? recipes.stepsFor(recipeId) : []))

/**
 * Two heights: the decision, and the whole recipe.
 *
 * The short one is what the wide pane shows — the figures, what it needs, and
 * the two buttons — which is everything "am I cooking this?" is asked with. The
 * tall one is the method, which is a different question asked at the hob.
 *
 * It stops at 96% rather than the whole screen so the library stays visible
 * behind it: this is a sheet over a list, and a page you can still see the top
 * of is one you know how to get back to.
 */
const SHORT = 0.7
const FULL = 0.96

// Reopens short rather than where the last recipe was left: the first question
// is always "is this the one", and landing on the method answers one nobody
// asked yet.
const snap = ref<number | string | null>(SHORT)
watch(open, (isOpen) => {
  if (isOpen) snap.value = SHORT
})

const atFull = computed(() => snap.value === FULL)

/**
 * How tall the part of the sheet you can actually see is.
 *
 * A drawer with snap points is drawn full height and slid down until only a
 * fraction of it is above the bottom of the screen, so a footer at the end of
 * its column sits off the screen at every snap but the last — and the two
 * decisions this sheet exists to offer would need a drag to reach. Sizing the
 * column to the visible band instead puts them on the first screen, where the
 * wide pane puts them.
 *
 * A runtime percentage rather than a class because it is the snap point, which
 * is a number the drag is changing continuously. Minus the grab handle above
 * it, which is drawn outside this column and has its own margin.
 *
 * Reads as a straight percentage of the sheet only because `max-h-full` below
 * takes the theme's 96% cap off: with it on, the sheet is 96% of the screen and
 * a snap point is a fraction of the screen, so the two disagree by a sliver that
 * lands under the bottom edge. The cap's job is done here by the top snap point.
 */
const bandHeight = computed(() => {
  const fraction = typeof snap.value === 'number' ? snap.value : FULL
  return `calc(${fraction * 100}% - 1.5rem)`
})
</script>

<template>
  <UDrawer
    v-model:open="open"
    v-model:active-snap-point="snap"
    :snap-points="[SHORT, FULL]"
    :title="detail?.name ?? 'Recipe'"
    :description="detail?.meta"
    :ui="{ content: 'max-h-full' }"
  >
    <!--
      The sheet's own column rather than the header/body/footer slots, so it can
      be the height of what is on screen — see `bandHeight`. Everything inside it
      is stock; `title` and `description` stay as props, which is what the drawer
      announces itself by when this slot is filled.
    -->
    <template
      v-if="detail"
      #content
    >
      <div
        class="flex w-full flex-col"
        :style="{ height: bandHeight }"
      >
        <div class="flex shrink-0 items-start gap-3 px-4 pb-3">
          <div class="min-w-0 flex-1">
            <h2 class="text-pretty text-xl font-semibold leading-[1.15] tracking-[-0.02em] text-highlighted">
              {{ detail.name }}
            </h2>
            <p class="mt-1 font-mono text-sm text-muted">
              {{ detail.meta }}
            </p>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Close"
            @click="open = false"
          />
        </div>

        <!--
          Locked until the sheet is all the way up, which is how a drawer with
          snap points has to behave: below the top snap an upward drag is raising
          the sheet, and a list that scrolled under your finger would swallow it.
        -->
        <div
          class="flex min-h-0 flex-1 flex-col gap-5 px-4 pb-4"
          :class="atFull
            ? 'overflow-y-auto'
            : 'overflow-hidden [mask-image:linear-gradient(to_bottom,#000_calc(100%-2.5rem),transparent)]'"
        >
          <!-- Renders nothing when the recipe has no figures, so an unimported
               recipe simply starts at its ingredients. -->
          <RecipeNutritionPanel
            v-if="recipe"
            :recipe="recipe"
            class="shrink-0"
          />

          <div class="shrink-0">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-xs font-medium uppercase tracking-wide text-dimmed">
                Ingredients <span class="ms-1 font-mono">{{ detail.ingredients.length }}</span>
              </h3>
              <UButton
                v-if="detail.sendLabel"
                variant="link"
                size="xs"
                color="primary"
                label="Add all to list"
                :loading="sending"
                class="-me-1.5 p-0"
                data-testid="recipe-send-list"
                @click="send(detail.missing)"
              />
            </div>

            <ul
              v-if="detail.ingredients.length"
              class="mt-3 flex flex-col gap-2"
            >
              <!-- The dot marks what you would still have to buy. Recessed once
                   it is on the list or already in the cupboard, which for this
                   purpose are the same answer. Same reading as the wide pane. -->
              <li
                v-for="line in detail.ingredients"
                :key="line.id"
                class="flex items-baseline gap-3"
              >
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
            v-if="steps.length"
            class="shrink-0"
          >
            <h3 class="text-xs font-medium uppercase tracking-wide text-dimmed">
              Method
            </h3>
            <ol class="mt-3 flex flex-col gap-3">
              <li
                v-for="(step, index) in steps"
                :key="step.id"
                class="flex gap-3"
              >
                <span class="w-5 shrink-0 font-mono text-sm text-dimmed">{{ index + 1 }}</span>
                <span class="min-w-0 flex-1 whitespace-pre-line text-sm text-default">{{ step.body }}</span>
              </li>
            </ol>
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
        </div>

        <!--
          Below the fold rather than in the column above it: the column is
          clipped at the short snap, so a hint inside it is the one line
          guaranteed not to be read.
        -->
        <p
          v-if="!atFull && (steps.length || detail.history.length)"
          class="shrink-0 px-4 pt-1 text-sm text-dimmed"
        >
          Drag up for the rest and the method
        </p>

        <div class="flex shrink-0 gap-2.5 border-t border-default px-4 pb-4 pt-3">
          <!-- Shortlisting leads, as it does in the pane: it is the decision
               that feeds the week's generator without picking a night by hand. -->
          <UButton
            :color="detail.shortlisted ? 'neutral' : 'primary'"
            :variant="detail.shortlisted ? 'subtle' : 'solid'"
            size="xl"
            :icon="detail.shortlisted ? 'i-lucide-check' : 'i-lucide-bookmark-plus'"
            :label="detail.shortlisted ? 'On the shortlist' : 'Shortlist'"
            class="flex-1 justify-center"
            data-testid="recipe-shortlist"
            @click="recipes.toggleShortlist(detail.id)"
          />
          <UButton
            :to="`/recipes/${detail.id}`"
            color="neutral"
            variant="subtle"
            size="xl"
            label="Open recipe"
            class="flex-1 justify-center"
            data-testid="recipe-view"
          />
        </div>
      </div>
    </template>
  </UDrawer>
</template>
