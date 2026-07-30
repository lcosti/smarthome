<script setup lang="ts">
import { useIngredientsStore } from '../stores/ingredients'
import { useListStore } from '../stores/list'
import { useRecipesStore } from '../stores/recipes'
import { useSyncStore } from '../stores/sync'
import type { IngredientRow } from '../utils/db'
import { formatBaseAmount } from '../utils/quantity'

const store = useIngredientsStore()
const list = useListStore()
const recipes = useRecipesStore()
const sync = useSyncStore()
const toast = useToast()

const query = ref('')
const editingId = ref<string | null>(null)
const editorOpen = ref(false)
const scanning = ref(false)

const shown = computed(() => {
  const key = query.value.trim().toLowerCase()
  if (!key) return store.ingredients
  return store.ingredients.filter(i =>
    i.name.toLowerCase().includes(key)
    || store.aliasesFor(i.id).some(a => a.alias.toLowerCase().includes(key)))
})

function edit(id: string) {
  editingId.value = id
  editorOpen.value = true
}

function summaryFor(ingredient: IngredientRow) {
  const units = store.purchaseUnitsFor(ingredient.id)
    .map(u => `1 ${u.name} = ${formatBaseAmount(u.amount, unitOf(ingredient))}`)
  const aliases = store.aliasesFor(ingredient.id).map(a => a.alias)
  return [...units, ...aliases].join(' · ')
}

function unitOf(ingredient: IngredientRow) {
  return ingredient.base_unit === 'g' || ingredient.base_unit === 'ml' ? ingredient.base_unit : 'count'
}

function aisleNameFor(id: string | null) {
  return id ? list.aisles.get(id)?.name ?? null : null
}

/**
 * Catch up a library that predates all this, in one press.
 *
 * The alternative was a migration, which would have had to guess the same things
 * with none of the context and no way for anybody to see what it did.
 */
async function scanRecipes() {
  scanning.value = true
  try {
    let linked = 0
    for (const line of recipes.allLines.values()) {
      if (line.deleted_at || line.ingredient_id) continue
      const ingredientId = await store.linkFor(line.name, {
        quantity: line.quantity,
        aisleId: line.aisle_id
      })
      if (!ingredientId) continue
      await recipes.updateIngredient(line.id, { ingredient_id: ingredientId })
      linked++
    }
    toast.add({
      title: linked ? `Linked ${linked} ingredient${linked === 1 ? '' : 's'}` : 'Nothing left to link',
      description: linked ? 'Add them to a shopping list to see them grouped.' : undefined,
      icon: 'i-lucide-sparkles'
    })
  } finally {
    scanning.value = false
  }
}

const unlinkedCount = computed(() =>
  [...recipes.allLines.values()].filter(l => !l.deleted_at && !l.ingredient_id).length
)
</script>

<template>
  <div class="min-h-dvh">
    <header class="sticky top-0 z-10 border-b border-default bg-default/85 backdrop-blur">
      <div class="mx-auto flex max-w-xl items-center gap-2 px-3 py-3">
        <UButton
          to="/settings"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to settings"
        />
        <h1 class="flex-1 truncate text-lg font-semibold">
          Ingredients
        </h1>
      </div>
      <div class="mx-auto max-w-xl px-3 pb-3">
        <UInput
          v-model="query"
          size="lg"
          placeholder="Search ingredients"
          icon="i-lucide-search"
          autocapitalize="none"
          class="w-full"
        />
      </div>
    </header>

    <main class="mx-auto max-w-xl px-3 py-4 pb-28">
      <div
        v-if="!sync.hydrated"
        class="py-16 text-center text-sm text-muted"
      >
        Loading…
      </div>

      <div
        v-else-if="!store.ingredients.length"
        class="py-16 text-center"
      >
        <p class="text-muted">
          No ingredients yet.
        </p>
        <p class="mt-1 text-sm text-dimmed">
          They appear as you add them to recipes. If you already have a library,
          this reads through it.
        </p>
        <UButton
          v-if="unlinkedCount"
          class="mt-4"
          size="lg"
          :loading="scanning"
          @click="scanRecipes()"
        >
          Read my recipes
        </UButton>
      </div>

      <template v-else>
        <ul class="divide-y divide-default rounded-lg border border-default">
          <li
            v-for="ingredient in shown"
            :key="ingredient.id"
            class="flex items-center gap-2"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left min-h-12 active:bg-elevated/60"
              @click="edit(ingredient.id)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ ingredient.name }}</span>
                <span
                  v-if="summaryFor(ingredient)"
                  class="block truncate text-xs text-dimmed"
                >{{ summaryFor(ingredient) }}</span>
              </span>
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ ingredient.base_unit }}
              </UBadge>
              <span
                v-if="aisleNameFor(ingredient.aisle_id)"
                class="shrink-0 text-xs text-dimmed"
              >{{ aisleNameFor(ingredient.aisle_id) }}</span>
            </button>
          </li>
        </ul>

        <p
          v-if="!shown.length"
          class="rounded-lg border border-default bg-elevated/30 px-3 py-6 text-center text-sm text-dimmed"
        >
          Nothing matches “{{ query }}”.
        </p>

        <UButton
          v-if="unlinkedCount"
          class="mt-4"
          color="neutral"
          variant="subtle"
          block
          :loading="scanning"
          @click="scanRecipes()"
        >
          Link {{ unlinkedCount }} recipe line{{ unlinkedCount === 1 ? '' : 's' }}
        </UButton>
      </template>
    </main>

    <IngredientEditor
      v-model:open="editorOpen"
      :ingredient-id="editingId"
    />
  </div>
</template>
