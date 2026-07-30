<script setup lang="ts">
import { usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { dayLabel } from '../utils/week'

const open = defineModel<boolean>('open', { required: true })
const { date } = defineProps<{ date: string | null }>()

const plan = usePlanStore()
const recipes = useRecipesStore()

const search = ref('')

const planned = computed(() => (date ? plan.entriesOn(date)[0] ?? null : null))
const plannedRecipe = computed(() => (planned.value ? recipes.recipeById(planned.value.recipe_id) ?? null : null))

watch(open, (isOpen) => {
  if (isOpen) search.value = ''
})

const matches = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const all = recipes.recipes
  return needle ? all.filter(r => r.name.toLowerCase().includes(needle)) : all
})

/** Quantities are free text, so a different serving count is a hint, not maths. */
const showScalingNote = computed(() =>
  !!planned.value && !!plannedRecipe.value && planned.value.servings !== plannedRecipe.value.base_servings
)

// One tap assigns and closes. Asking for a confirmation here would double the
// cost of the most common action on the page.
async function choose(recipeId: string) {
  if (!date) return
  await plan.setNight(date, recipeId)
  open.value = false
}

async function setServings(delta: number) {
  if (!planned.value) return
  await plan.updateEntry(planned.value.id, {
    servings: Math.max(1, planned.value.servings + delta)
  })
}

async function clear() {
  if (!date) return
  await plan.clearNight(date)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    :title="date ? dayLabel(date) : 'Dinner'"
  >
    <template #body>
      <div class="space-y-4">
        <div
          v-if="planned"
          class="rounded-lg border border-default bg-elevated/30 p-3"
        >
          <p class="font-medium">
            {{ plannedRecipe?.name ?? 'Recipe deleted' }}
          </p>
          <div class="mt-2 flex items-center gap-2">
            <UButton
              icon="i-lucide-minus"
              size="sm"
              color="neutral"
              variant="subtle"
              :disabled="planned.servings <= 1"
              aria-label="Fewer servings"
              @click="setServings(-1)"
            />
            <span class="w-8 text-center tabular-nums">{{ planned.servings }}</span>
            <UButton
              icon="i-lucide-plus"
              size="sm"
              color="neutral"
              variant="subtle"
              aria-label="More servings"
              @click="setServings(1)"
            />
            <span class="text-sm text-dimmed">servings</span>
          </div>
          <p
            v-if="showScalingNote"
            class="mt-2 text-sm text-dimmed"
          >
            Quantities aren’t scaled — the list shows a ×{{ Math.round((planned.servings / (plannedRecipe?.base_servings ?? 1)) * 10) / 10 }} hint.
          </p>
        </div>

        <div
          v-if="!recipes.recipes.length"
          class="py-8 text-center"
        >
          <p class="text-muted">
            No recipes yet.
          </p>
          <p class="mt-1 text-sm text-dimmed">
            The plan is built from your recipe library.
          </p>
          <UButton
            to="/recipes"
            class="mt-4"
            color="neutral"
            variant="subtle"
            @click="open = false"
          >
            Go to recipes
          </UButton>
        </div>

        <template v-else>
          <UInput
            v-model="search"
            size="xl"
            class="w-full"
            icon="i-lucide-search"
            :placeholder="planned ? 'Swap for…' : 'Search recipes'"
            autocapitalize="sentences"
          />

          <ul class="max-h-[45dvh] overflow-y-auto rounded-lg border border-default bg-elevated/30">
            <RecipeRow
              v-for="item in matches"
              :key="item.id"
              :name="item.name"
              :ingredient-count="recipes.ingredientsFor(item.id).length"
              :servings="item.base_servings"
              @select="choose(item.id)"
            />
            <li
              v-if="!matches.length"
              class="px-3 py-6 text-center text-sm text-dimmed"
            >
              Nothing matches that.
            </li>
          </ul>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          v-if="planned"
          icon="i-lucide-trash-2"
          color="error"
          variant="subtle"
          @click="clear"
        >
          Remove
        </UButton>
        <div class="flex-1" />
        <UButton
          color="neutral"
          variant="ghost"
          @click="open = false"
        >
          Done
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
