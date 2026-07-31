<script setup lang="ts">
import { usePlanStore } from '../../../stores/plan'
import { useRecipesStore } from '../../../stores/recipes'
import { dayLabel } from '../../../utils/week'

/**
 * The library, as something to pick from across a kitchen.
 *
 * Read-only here on purpose: writing a recipe is a long typing job that belongs
 * on a phone, and the thing this screen is for is finding one — either to cook
 * from tonight or to see what the household actually has.
 *
 * `?swap=YYYY-MM-DD` turns it into a picker for that night, which is what
 * Tonight's "Swap meal" opens. A mode on the library rather than a modal over
 * the board: choosing a meal means reading the whole library, and there is no
 * version of that which fits in a dialog on a wall.
 */

const recipes = useRecipesStore()
const plan = usePlanStore()
const route = useRoute()

const now = useBoardClock()
const nights = useBoardNights(now)

/** The night being swapped, or null when this is just the library. */
const swapDate = computed(() => {
  const value = route.query.swap
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
})

async function choose(recipeId: string) {
  const date = swapDate.value
  if (!date) return
  await plan.setNight(date, recipeId)
  // Straight back to the board: the swap was the errand, and leaving somebody
  // on the library afterwards makes them find their own way home.
  await navigateTo('/board')
}

/** Which recipes are on the plan this week, so the library shows what is spoken for. */
const plannedIds = computed(() => {
  const ids = new Map<string, string>()
  for (const night of nights.value) {
    if (night.meal?.recipeId && !ids.has(night.meal.recipeId)) {
      const [year, month, day] = night.date.split('-').map(Number)
      ids.set(
        night.meal.recipeId,
        new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'short' })
      )
    }
  }
  return ids
})

function minutesOf(recipeId: string) {
  const recipe = recipes.recipeById(recipeId)
  return (recipe?.prep_minutes ?? 0) + (recipe?.cook_minutes ?? 0) || null
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col gap-3">
    <div class="flex shrink-0 items-baseline gap-3">
      <h2 class="text-[27px] font-semibold tracking-[-0.025em] text-highlighted">
        {{ swapDate ? 'Pick a meal' : 'Recipes' }}
      </h2>
      <p class="text-[17px] text-muted">
        {{ swapDate ? `for ${dayLabel(swapDate)}` : `${recipes.recipes.length} in the library` }}
      </p>
    </div>

    <UPageGrid
      v-if="recipes.recipes.length"
      class="min-h-0 flex-1 content-start gap-3 overflow-hidden lg:grid-cols-5"
    >
      <UPageCard
        v-for="recipe in recipes.recipes"
        :key="recipe.id"
        :to="swapDate ? undefined : `/board/recipes/${recipe.id}`"
        :title="recipe.name"
        :description="minutesOf(recipe.id)
          ? `${minutesOf(recipe.id)} min · serves ${recipe.base_servings}`
          : `serves ${recipe.base_servings}`"
        variant="outline"
        :ui="{
          root: 'rounded-lg bg-elevated px-4 py-3.5 transition-opacity duration-[80ms] active:opacity-85',
          title: 'line-clamp-2 text-[17px] font-medium text-default',
          description: 'font-mono text-xs text-dimmed'
        }"
        @click="swapDate && choose(recipe.id)"
      >
        <UBadge
          v-if="plannedIds.get(recipe.id)"
          color="primary"
          variant="subtle"
          :ui="{ base: 'w-fit self-start rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.06em]' }"
        >
          {{ plannedIds.get(recipe.id) }}
        </UBadge>
      </UPageCard>
    </UPageGrid>

    <UEmpty
      v-else
      icon="i-lucide-book-open"
      title="No recipes yet"
      description="Add a few from your phone — the generator builds the week out of them."
      class="flex-1"
      :ui="{
        avatar: 'size-10 bg-transparent text-dimmed',
        title: 'text-[30px] font-semibold text-muted',
        description: 'text-[17px] text-muted'
      }"
    />
  </div>
</template>
