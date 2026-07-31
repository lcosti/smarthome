<script setup lang="ts">
import { useRecipesStore } from '../../../stores/recipes'

/**
 * The library, as something to pick from across a kitchen.
 *
 * Read-only here on purpose: writing a recipe is a long typing job that belongs
 * on a phone, and the thing this screen is for is finding one — either to cook
 * from tonight or to see what the household actually has.
 */

const recipes = useRecipesStore()

const now = useBoardClock()
const nights = useBoardNights(now)

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
  <div class="flex h-full min-h-0 flex-col gap-[18px]">
    <div class="flex shrink-0 items-baseline gap-[18px]">
      <h2 class="text-[40px] font-semibold tracking-[-0.025em] text-highlighted">
        Recipes
      </h2>
      <p class="text-[26px] text-muted">
        {{ recipes.recipes.length }} in the library
      </p>
    </div>

    <div
      v-if="recipes.recipes.length"
      class="grid min-h-0 flex-1 grid-cols-5 content-start gap-[18px] overflow-hidden"
    >
      <NuxtLink
        v-for="recipe in recipes.recipes"
        :key="recipe.id"
        :to="`/board/recipes/${recipe.id}`"
        class="flex flex-col gap-2 rounded-[14px] border border-default bg-default px-6 py-5
               transition-opacity duration-[80ms] active:opacity-85"
      >
        <span class="line-clamp-2 text-[26px] font-medium text-default">{{ recipe.name }}</span>
        <span class="font-mono text-[18px] text-dimmed">
          {{ minutesOf(recipe.id) ?? '—' }} min · serves {{ recipe.base_servings }}
        </span>
        <UBadge
          v-if="plannedIds.get(recipe.id)"
          color="warning"
          variant="soft"
          :ui="{ base: 'mt-auto self-start rounded-full px-3.5 py-1 font-mono text-[17px] uppercase tracking-[0.06em] ring-1 ring-warning/50' }"
        >
          {{ plannedIds.get(recipe.id) }}
        </UBadge>
      </NuxtLink>
    </div>

    <div
      v-else
      class="flex flex-1 flex-col items-center justify-center gap-4"
    >
      <p class="text-[56px] font-semibold text-muted">
        No recipes yet
      </p>
      <p class="text-[26px] text-muted">
        Add a few from your phone — the generator builds the week out of them.
      </p>
    </div>
  </div>
</template>
