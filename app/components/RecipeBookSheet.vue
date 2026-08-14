<script setup lang="ts">
import { useRecipesStore } from '../stores/recipes'
import { tidySource, type RecipeSourceFields } from '../utils/recipe-source'

/**
 * "Which book was that?" — asked once, over the top of the photographs being
 * read.
 *
 * A photograph of a cookbook page carries the method and the ingredients and
 * nothing about the object it was printed in. The headnote, the picture, the
 * paragraph saying what to serve it with and what the leftovers are for: all of
 * that is still on the shelf, and the only way back to it is the book's name and
 * a page. It is the one fact the camera cannot capture, and the one this house
 * says out loud anyway — "it's in the Ottolenghi, page 82".
 *
 * Asked here rather than extracted, deliberately. A model reading a spread will
 * happily report a page number off a running header, or invent one, and a page
 * number nobody typed is a page number nobody would ever check.
 *
 * Answering is never in the way of anything: the extraction is already running
 * when this opens (see `recipes/index.vue`), so the question is asked in the
 * time that was being spent waiting, and "Not from a book" — or dismissing the
 * sheet — lands on the new recipe exactly as before. Anything not answered now,
 * or answered wrongly, is two fields on the recipe's own page.
 *
 * A `USlideover` like the app's other bottom sheets, because this is a form:
 * open, type, save, shut. The one exception the library makes for reading —
 * `RecipeSheet`'s drawer — is about height, and two fields have one right height.
 */

const open = defineModel<boolean>('open', { required: true })

const { loading = false } = defineProps<{
  /** The photographs are still being read, so the answer has landed and is waiting. */
  loading?: boolean
}>()

const emit = defineEmits<{
  /** Both buttons end here; "Not from a book" is the same answer with nothing in it. */
  done: [RecipeSourceFields]
}>()

const recipes = useRecipesStore()

const book = ref('')
const page = ref('')

// Cleared on open rather than remembered. Two recipes photographed in one sitting
// are often out of the same book, but a book quietly inherited by the next one is
// a wrong answer nobody typed — and the suggestions below make retyping it a tap.
watch(open, (isOpen) => {
  if (!isOpen) return
  book.value = ''
  page.value = ''
})

const answered = computed(() => Boolean(book.value.trim() || page.value.trim()))
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    title="Out of a book?"
    description="The photos have the recipe. This is how to find the rest of the page again."
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField label="Book">
          <!--
            The books this house has already typed in, offered back so one shelf
            is spelled one way — which is the whole reason "everything out of the
            Ottolenghi" is a question anybody can answer later. `autocomplete`
            mode rather than the default combobox: what is typed is the value,
            and the list is an offer rather than a set to choose from, so the
            first book ever entered is typed the same way as the fortieth.

            A plain `UInput` until there is something to suggest, because an
            empty menu answering "no matching data" while somebody types the
            first book in the house is noise in front of an empty library.
          -->
          <UInputMenu
            v-if="recipes.books.length"
            v-model="book"
            mode="autocomplete"
            :items="recipes.books"
            size="xl"
            class="w-full"
            placeholder="Ottolenghi Simple"
            autocapitalize="words"
            data-testid="recipe-book"
          />
          <UInput
            v-else
            v-model="book"
            size="xl"
            class="w-full"
            placeholder="Ottolenghi Simple"
            autocapitalize="words"
            data-testid="recipe-book"
          />
        </UFormField>

        <UFormField
          label="Page"
          description="A spread is fine — 82-83."
        >
          <!--
            No `inputmode="numeric"`: a photographed recipe regularly spans two
            pages, and the numeric keypad has no dash on it. The ordinary
            keyboard opens on digits anyway.
          -->
          <UInput
            v-model="page"
            size="xl"
            class="w-full"
            placeholder="82"
            data-testid="recipe-page"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Not from a book"
          :disabled="loading"
          @click="emit('done', { source_book: null, source_page: null })"
        />
        <div class="flex-1" />
        <UButton
          size="lg"
          label="Save"
          :loading="loading"
          :disabled="!answered"
          data-testid="recipe-book-save"
          @click="emit('done', tidySource({ book, page }))"
        />
      </div>
    </template>
  </USlideover>
</template>
