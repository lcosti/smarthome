<script setup lang="ts">
import { useRecipesStore } from '../../stores/recipes'
import { useSyncStore } from '../../stores/sync'

const store = useRecipesStore()
const sync = useSyncStore()

// One box does both jobs. Typing narrows the library; pressing add turns what you
// typed into a recipe. Two separate inputs would mean choosing before you start.
const draft = ref('')

const matches = computed(() => {
  const needle = draft.value.trim().toLowerCase()
  if (!needle) return store.recipes
  return store.recipes.filter(r => r.name.toLowerCase().includes(needle))
})

async function add() {
  const name = draft.value.trim()
  if (!name) return
  draft.value = ''
  const created = await store.addRecipe({ name })
  if (created) await navigateTo(`/recipes/${created.id}`)
}

// Photograph a cookbook page instead of typing it in. Multi-select because a
// recipe often spans a spread: ingredients on one page, method overleaf.
const photoImport = useRecipePhotoImport()
const photoInput = ref<HTMLInputElement>()
const toast = useToast()

async function onPhotosPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return

  const recipeId = await photoImport.importPhotos(files)
  if (recipeId) {
    await navigateTo(`/recipes/${recipeId}`)
  } else if (photoImport.error.value) {
    toast.add({ title: photoImport.error.value, color: 'error' })
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="shrink-0 border-b border-default bg-default">
      <div class="mx-auto max-w-xl px-3 pt-3 pb-2">
        <h1 class="mb-2 text-lg font-semibold">
          Recipes
        </h1>

        <form
          class="flex gap-2"
          @submit.prevent="add"
        >
          <UInput
            v-model="draft"
            size="xl"
            placeholder="Search or add a recipe"
            autocapitalize="sentences"
            enterkeyhint="done"
            class="flex-1"
          />
          <UButton
            type="submit"
            size="xl"
            icon="i-lucide-plus"
            :disabled="!draft.trim()"
            aria-label="Add recipe"
          />
          <UButton
            size="xl"
            color="neutral"
            variant="outline"
            :icon="photoImport.status.value === 'idle' ? 'i-lucide-camera' : ''"
            :loading="photoImport.status.value !== 'idle'"
            :disabled="photoImport.status.value !== 'idle'"
            aria-label="Add recipe from a photo"
            @click="photoInput?.click()"
          />
          <!-- No `capture` attribute: on iOS it forces the camera and silently
               drops `multiple`, and a cookbook recipe often needs two photos.
               Without it the phone offers camera or library, both of which work. -->
          <input
            ref="photoInput"
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            data-testid="recipe-photo-input"
            @change="onPhotosPicked"
          >
        </form>

        <p
          v-if="photoImport.status.value !== 'idle'"
          class="mt-2 text-sm text-muted"
        >
          Reading recipe… this can take up to 30 seconds.
        </p>
      </div>
    </header>

    <main class="mx-auto w-full max-w-xl min-h-0 flex-1 overflow-y-auto px-3 pb-6">
      <div
        v-if="!sync.hydrated"
        class="py-16 text-center text-sm text-muted"
      >
        Loading…
      </div>

      <div
        v-else-if="!store.recipes.length"
        class="py-16 text-center"
      >
        <p class="text-muted">
          No recipes yet.
        </p>
        <p class="mt-1 text-sm text-dimmed">
          Type above to add the first one.
        </p>
      </div>

      <div
        v-else-if="!matches.length"
        class="py-16 text-center"
      >
        <p class="text-muted">
          Nothing matches “{{ draft.trim() }}”.
        </p>
        <p class="mt-1 text-sm text-dimmed">
          Press add to make it a new recipe.
        </p>
      </div>

      <ul
        v-else
        class="mt-3 rounded-lg border border-default bg-elevated/30"
      >
        <RecipeRow
          v-for="item in matches"
          :key="item.id"
          :name="item.name"
          :ingredient-count="store.ingredientsFor(item.id).length"
          :servings="item.base_servings"
          @select="navigateTo(`/recipes/${item.id}`)"
        />
      </ul>
    </main>
  </div>
</template>
