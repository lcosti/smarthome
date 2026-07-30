<script setup lang="ts">
import { useIngredientsStore } from '../stores/ingredients'
import type { IngredientRow } from '../utils/db'

/**
 * A name field that quietly offers the ingredients this household already knows.
 *
 * The friction rule is the whole design. Enter always submits what was typed,
 * immediately, whether or not anything was suggested and without a selection step
 * — the suggestions are an offer, never a gate. Tapping one submits that
 * ingredient instead, which is also how the app is taught a synonym.
 */
const model = defineModel<string>({ required: true })

const {
  placeholder = 'Add an ingredient',
  size = 'xl',
  enterkeyhint = 'next',
  limit = 6
} = defineProps<{
  placeholder?: string
  size?: 'md' | 'lg' | 'xl'
  enterkeyhint?: 'next' | 'done' | 'enter'
  limit?: number
}>()

const emit = defineEmits<{
  /** The chosen ingredient, or null when they just pressed enter on their own text. */
  submit: [name: string, ingredient: IngredientRow | null]
}>()

const ingredients = useIngredientsStore()
const input = useTemplateRef<{ inputRef?: HTMLInputElement }>('input')
const focused = ref(false)

const suggestions = computed(() => {
  const query = model.value.trim()
  if (!focused.value || query.length < 2) return []
  const found = ingredients.suggest(query, limit)
  // Nothing to offer if the only match is already exactly what they have typed.
  if (found.length === 1 && found[0]!.ingredient.name.toLowerCase() === query.toLowerCase()) return []
  return found
})

function submitTyped() {
  const name = model.value.trim()
  if (!name) return
  emit('submit', name, null)
}

function choose(ingredient: IngredientRow) {
  const typed = model.value.trim()
  emit('submit', typed || ingredient.name, ingredient)
}

/** Let the parent keep the keyboard up for the next one. */
function focus() {
  input.value?.inputRef?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="relative flex-1">
    <UInput
      ref="input"
      v-model="model"
      :size="size"
      :placeholder="placeholder"
      :enterkeyhint="enterkeyhint"
      autocapitalize="sentences"
      autocomplete="off"
      class="w-full"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.enter.prevent="submitTyped"
      @keydown.escape="focused = false"
    />

    <!--
      Below the field. The buttons swallow mousedown so the field never blurs
      out from under a tap, which is why closing on blur is safe here.
    -->
    <ul
      v-if="suggestions.length"
      class="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-default bg-default shadow-lg"
    >
      <li
        v-for="suggestion in suggestions"
        :key="suggestion.ingredient.id"
      >
        <button
          type="button"
          class="flex w-full items-baseline gap-2 px-3 py-2.5 text-left text-sm hover:bg-elevated"
          @mousedown.prevent
          @click="choose(suggestion.ingredient)"
        >
          <span class="truncate">{{ suggestion.ingredient.name }}</span>
          <span
            v-if="suggestion.matchedAlias"
            class="truncate text-xs text-dimmed"
          >
            also “{{ suggestion.matchedAlias }}”
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
