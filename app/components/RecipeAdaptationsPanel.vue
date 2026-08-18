<script setup lang="ts">
/**
 * A recipe's adaptations, as something to read rather than edit.
 *
 * Same terms as RecipeNutritionPanel, whose shape this copies: the library pane
 * and the phone sheet are for choosing a meal, and "the baby's version exists"
 * is part of that choice. Editing is a typing job and lives on the recipe's own
 * page.
 *
 * Shows only what currently applies — an adaptation whose audience nobody is
 * (the weaning note after the baby turns one, a diet nobody follows any more)
 * is not drawn, and a recipe with none renders nothing at all: an empty panel
 * would push the ingredients down to say nothing.
 */

const { recipeId } = defineProps<{ recipeId: string | null }>()

const { matched } = useRecipeAdaptations(() => recipeId)
</script>

<template>
  <div v-if="matched.length">
    <h3 class="text-xs font-medium uppercase tracking-wide text-dimmed">
      Adaptations
    </h3>

    <ul class="mt-3 space-y-3">
      <li
        v-for="adaptation in matched"
        :key="adaptation.id"
        class="rounded-lg border border-default bg-default/40 px-4 py-3.5"
      >
        <p class="flex items-baseline gap-2">
          <UBadge
            variant="subtle"
            size="sm"
          >
            {{ adaptation.label }}
          </UBadge>
          <span class="text-xs text-dimmed">{{ adaptation.forWho }}</span>
        </p>

        <p
          v-if="adaptation.note"
          class="mt-2 text-sm leading-relaxed text-default"
        >
          {{ adaptation.note }}
        </p>

        <ul
          v-if="adaptation.items.length"
          class="mt-2 space-y-1"
        >
          <li
            v-for="item in adaptation.items"
            :key="item.id"
            class="text-sm leading-relaxed text-muted"
          >
            {{ item.text }}
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
