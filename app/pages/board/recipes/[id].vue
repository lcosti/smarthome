<script setup lang="ts">
import { useRecipesStore } from '../../../stores/recipes'

/**
 * One recipe, at the size you can read from the hob.
 *
 * Two columns and no scrolling: ingredients on the left because you check them
 * before you start, method on the right because you read it while your hands are
 * busy. A recipe long enough not to fit is clipped rather than made smaller —
 * nothing on this board shrinks type to make content fit.
 */

const route = useRoute()
const recipes = useRecipesStore()

const id = computed(() => String(route.params.id))
const recipe = computed(() => recipes.recipeById(id.value))
const lines = computed(() => recipes.ingredientsFor(id.value))

const minutes = computed(() => {
  const total = (recipe.value?.prep_minutes ?? 0) + (recipe.value?.cook_minutes ?? 0)
  return total || null
})

/**
 * Method as paragraphs. Stored as one block of text, split on blank lines the
 * way it was typed, so a numbered list stays numbered and prose stays prose.
 */
const steps = computed(() =>
  (recipe.value?.method ?? '')
    .split(/\n\s*\n/)
    .map(step => step.trim())
    .filter(Boolean)
)
</script>

<template>
  <div
    v-if="recipe"
    class="flex h-full min-h-0 flex-col gap-[18px]"
  >
    <div class="flex shrink-0 items-start justify-between gap-8">
      <div class="min-w-0">
        <h2 class="truncate text-[52px] font-semibold tracking-[-0.025em] text-highlighted">
          {{ recipe.name }}
        </h2>
        <p class="mt-1 text-[26px] text-muted">
          <template v-if="minutes">
            {{ minutes }} min ·
          </template>
          serves {{ recipe.base_servings }}
        </p>
      </div>
      <UButton
        to="/board/recipes"
        color="neutral"
        variant="subtle"
        size="xl"
        label="All recipes"
        class="h-[72px] shrink-0 rounded-[14px] px-8 text-[24px]"
      />
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-[1fr_1.6fr] gap-[22px] overflow-hidden">
      <UCard
        variant="outline"
        :ui="{
          root: 'flex min-h-0 flex-col overflow-hidden rounded-2xl bg-elevated',
          header: 'px-8 pt-6 pb-0 sm:px-8',
          body: 'flex min-h-0 flex-1 flex-col px-8 py-4 sm:p-0 sm:px-8 sm:py-4'
        }"
      >
        <template #header>
          <h3 class="font-mono text-[21px] uppercase tracking-[0.14em] text-muted">
            Ingredients
          </h3>
        </template>
        <ul class="flex min-h-0 flex-col gap-2.5 overflow-hidden">
          <li
            v-for="line in lines"
            :key="line.id"
            class="flex items-baseline gap-4"
          >
            <span class="size-2 shrink-0 translate-y-[-4px] rounded-full bg-accented" />
            <span class="min-w-0 flex-1 text-[26px] text-default">{{ line.name }}</span>
            <span
              v-if="line.quantity"
              class="shrink-0 whitespace-nowrap font-mono text-[24px] text-muted"
            >{{ line.quantity }}</span>
          </li>
        </ul>
        <p
          v-if="!lines.length"
          class="text-[24px] text-dimmed"
        >
          No ingredients listed.
        </p>
      </UCard>

      <UCard
        variant="outline"
        :ui="{
          root: 'flex min-h-0 flex-col overflow-hidden rounded-2xl bg-elevated',
          header: 'px-8 pt-6 pb-0 sm:px-8',
          body: 'flex min-h-0 flex-1 flex-col px-8 py-4 sm:p-0 sm:px-8 sm:py-4'
        }"
      >
        <template #header>
          <h3 class="font-mono text-[21px] uppercase tracking-[0.14em] text-muted">
            Method
          </h3>
        </template>
        <ol class="flex min-h-0 flex-col gap-4 overflow-hidden">
          <li
            v-for="(step, index) in steps"
            :key="index"
            class="flex gap-5"
          >
            <span class="shrink-0 font-mono text-[24px] text-dimmed">{{ index + 1 }}</span>
            <span class="text-[26px] leading-[1.45] text-default">{{ step }}</span>
          </li>
        </ol>
        <p
          v-if="!steps.length"
          class="text-[24px] text-dimmed"
        >
          No method written down. It is on the phone, or in somebody's head.
        </p>
      </UCard>
    </div>
  </div>

  <!-- A recipe deleted on another device while this was open. Not an error. -->
  <UEmpty
    v-else
    icon="i-lucide-book-open"
    title="That recipe is gone"
    description="It was deleted on another device while this was open."
    :actions="[{ label: 'All recipes', to: '/board/recipes', color: 'neutral', variant: 'subtle', size: 'xl' }]"
    class="h-full"
    :ui="{
      avatar: 'size-16 bg-transparent text-dimmed',
      title: 'text-[56px] font-semibold text-muted',
      description: 'text-[26px] text-muted'
    }"
  />
</template>
