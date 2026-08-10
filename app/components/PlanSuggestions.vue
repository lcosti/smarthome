<script setup lang="ts">
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { suggestionReason, type RankedCandidate } from '../utils/generator'
import { pictureOf } from '../utils/photo'

/**
 * What to cook on the next night still open, offered rather than decided.
 *
 * Asked once for the week rather than once per empty night: the same top-ranked
 * meal is the top-ranked meal on every free night, so repeating the shortlist on
 * each empty card said the same recipe name seven times and read as a plan
 * already made.
 *
 * One component for both shapes. On a wide screen it is the bottom of the aside;
 * on a phone it is what follows the nights. An offer is the same offer either
 * way, and the two drifting apart is how a suggestion on one becomes a decision
 * on the other.
 */
const { suggestions, nights, target, tiles = false } = defineProps<{
  /** Ranked meals for the night the buttons plan onto. Empty when the week is full. */
  suggestions: RankedCandidate[]
  /** The whole week, for what is already spoken for and how often it has been cooked. */
  nights: PlannedNight[]
  /** The first night still empty and still ahead, or null when there is none. */
  target: string | null
  /**
   * A rail of tiles that scrolls sideways, picture first, rather than a column
   * of rows.
   *
   * For the phone's day-by-day flow, where the shortlist is the body of the
   * screen and not a footnote under it: rows read as a list to work through,
   * and tiles read as dinners to choose between, which is the decision actually
   * being asked for.
   *
   * Sideways because the page it is on does not scroll. A wrapping grid grows
   * downwards without limit — four suggestions is two rows, six is three — and
   * whatever it grows past goes off the bottom of a screen that has no way to
   * reach it. A rail is one row however long the shortlist is, and the tile cut
   * off at the right edge is the thing that says there is more.
   */
  tiles?: boolean
}>()

const emit = defineEmits<{ pick: [recipeId: string], seeAll: [] }>()

const plan = usePlanStore()
const recipes = useRecipesStore()
const pantryCovers = usePantryCovers()

/**
 * An offer can be carried to the night you want it on.
 *
 * The button plans onto the next free night, which is right most of the time and
 * wrong precisely when somebody has a night in mind — dragging is how they say
 * which, without the button having to grow a menu of seven days.
 */
const drag = usePlanDrag()

function pickUp(event: PointerEvent, candidate: RankedCandidate) {
  drag.press(event, {
    kind: 'suggestion',
    recipeId: candidate.recipe.id,
    label: candidate.recipe.name,
    image: pictureOf(recipes.recipeById(candidate.recipe.id))
  })
}

const dayName = computed(() => {
  if (!target) return null
  const [year, month, day] = target.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'short' })
})

/** Every recipe already on this week, so a suggestion can admit it is spoken for. */
const onPlan = computed(() =>
  new Set(nights.flatMap(night => night.entries.map(planned => planned.entry.recipe_id)))
)

/** What it costs to cook, for the badge on the offer. Zero reads as no badge. */
function minutesOf(candidate: RankedCandidate): number {
  return (candidate.recipe.prep_minutes ?? 0) + (candidate.recipe.cook_minutes ?? 0)
}

/**
 * The reason line, with the one fact the scorer cannot know folded in: whether
 * the cupboard already covers it. Nothing to buy beats every other argument for
 * cooking something tonight.
 */
function reasonFor(candidate: RankedCandidate): string {
  const lines = recipes.ingredientsFor(candidate.recipe.id)
  const allPantry = lines.length > 0 && lines.every(line => pantryCovers.value(line))
  return suggestionReason(candidate, {
    allPantry,
    cookedTimes: plan.timesCooked(candidate.recipe.id, nights[0]?.date ?? '')
  })
}
</script>

<template>
  <div>
    <div class="flex items-baseline justify-between gap-2">
      <h3
        v-if="tiles"
        class="text-sm font-semibold text-highlighted"
      >
        Recommended for {{ dayName }}
      </h3>
      <h3
        v-else
        class="text-xs text-dimmed"
      >
        Recommended meals
      </h3>

      <!-- Four is a shortlist, not the library. This is the way to the rest of it. -->
      <UButton
        v-if="tiles"
        color="neutral"
        variant="link"
        size="xs"
        label="See all"
        class="-me-2 shrink-0"
        @click="emit('seeAll')"
      />
    </div>

    <!--
      A rail, picture on top. The tile is the same offer the column makes —
      name, why, what it costs, one press to take it — laid out for a screen
      where choosing between them is the whole task.

      The negative margin is the phone page's own gutter, cancelled so the rail
      runs to both edges of the screen: a tile that stops short of the edge
      reads as the last one, and the whole point is that it is not. The padding
      puts the gutter back inside, so the first tile still lines up with the
      heading above it.

      Snapping, but `snap-proximity` rather than `snap-mandatory` — a shortlist
      is browsed as much as chosen from, and mandatory snapping fights a flick
      that only meant to see what was over there. `scroll-px-3` is what makes a
      snap land on the gutter rather than on the screen edge: without it the
      snap area starts at the padding box, and the rail settles with the first
      tile a gutter's width off the left of itself.
    -->
    <ul
      v-if="tiles && suggestions.length"
      class="-mx-3 mt-2.5 flex snap-x snap-proximity scroll-px-3 gap-2.5 overflow-x-auto overscroll-x-contain px-3 pb-1"
    >
      <li
        v-for="candidate in suggestions"
        :key="candidate.recipe.id"
        class="w-38 shrink-0 snap-start"
      >
        <UCard
          variant="soft"
          :ui="{
            root: 'flex h-full flex-col overflow-hidden touch-manipulation select-none',
            body: 'flex min-h-0 flex-1 flex-col gap-2 p-2.5 sm:p-2.5'
          }"
          class="cursor-grab"
          @pointerdown="pickUp($event, candidate)"
        >
          <!--
            Hatching behind the photograph rather than a flat grey, exactly as
            the wall board's recipe cards do it: it reads as "no picture" rather
            than as one still loading.
          -->
          <div class="relative -mx-2.5 -mt-2.5 aspect-[16/10] overflow-hidden bg-accented/20">
            <div class="size-full bg-[repeating-linear-gradient(135deg,var(--ui-bg-accented)_0_6px,transparent_6px_12px)] opacity-60" />
            <RecipeImage
              :src="pictureOf(recipes.recipeById(candidate.recipe.id))"
              :alt="candidate.recipe.name"
              class="absolute inset-0"
            />
            <UBadge
              v-if="minutesOf(candidate)"
              color="neutral"
              variant="solid"
              size="sm"
              :label="`${minutesOf(candidate)}m`"
              class="absolute bottom-1.5 left-1.5 font-mono"
            />
          </div>

          <div class="min-h-0 flex-1">
            <p class="line-clamp-2 text-pretty text-[13px] font-medium leading-tight text-highlighted">
              {{ candidate.recipe.name }}
            </p>
            <!-- One line on a tile. The reason is why this one is near the top,
                 not something to read — and the tile is paying for its height
                 out of a screen that has none spare. -->
            <p class="mt-1 line-clamp-1 text-[11px] text-muted">
              {{ reasonFor(candidate) }}
            </p>
          </div>

          <UButton
            v-if="onPlan.has(candidate.recipe.id)"
            color="neutral"
            variant="subtle"
            size="xs"
            block
            label="On plan"
            disabled
            data-no-drag
          />
          <UButton
            v-else
            color="primary"
            variant="subtle"
            size="xs"
            block
            data-no-drag
            :label="`Use ${dayName}`"
            @click="emit('pick', candidate.recipe.id)"
          />
        </UCard>
      </li>
    </ul>

    <ul
      v-else-if="suggestions.length"
      class="mt-2 flex flex-col gap-2"
    >
      <li
        v-for="candidate in suggestions"
        :key="candidate.recipe.id"
      >
        <!--
          An offer is a card, not a paragraph with a button after it: the name,
          why it is being offered, what it will cost you and the one thing to do
          about it are one object, and four of them in a column should read as
          four things you could pick rather than as prose.
        -->
        <UCard
          variant="soft"
          :ui="{ root: 'touch-manipulation select-none', body: 'px-3.5 py-3 sm:p-3.5' }"
          class="cursor-grab"
          @pointerdown="pickUp($event, candidate)"
        >
          <div class="flex items-start gap-3">
            <RecipeThumb
              :src="pictureOf(recipes.recipeById(candidate.recipe.id))"
              :alt="candidate.recipe.name"
            />

            <div class="min-w-0 flex-1">
              <p class="text-pretty text-sm font-medium leading-tight text-highlighted">
                {{ candidate.recipe.name }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ reasonFor(candidate) }}
              </p>
            </div>
          </div>

          <!-- What it costs and the one thing to do about it, on the card's own
               width — the offer indents beside its picture, the action does not. -->
          <div class="mt-2.5 flex items-center gap-2">
            <UBadge
              v-if="minutesOf(candidate)"
              color="neutral"
              variant="subtle"
              size="sm"
              :label="`${minutesOf(candidate)}m`"
            />
            <UButton
              v-if="onPlan.has(candidate.recipe.id)"
              color="neutral"
              variant="subtle"
              size="xs"
              label="On plan"
              disabled
              data-no-drag
              class="ml-auto"
            />
            <UButton
              v-else
              color="primary"
              variant="subtle"
              size="xs"
              data-no-drag
              :label="`Use ${dayName}`"
              class="ml-auto"
              @click="emit('pick', candidate.recipe.id)"
            />
          </div>
        </UCard>
      </li>
    </ul>

    <UEmpty
      v-else
      variant="naked"
      size="sm"
      :icon="target ? 'i-lucide-search-x' : 'i-lucide-check'"
      :title="target ? 'Nothing left to suggest' : 'Nothing left to plan'"
      :description="target
        ? 'Every recipe is already on this week or ruled out by an allergy.'
        : 'Every night this week has a meal on it.'"
      :ui="{ root: 'mt-2 p-0 sm:p-0' }"
    />
  </div>
</template>
