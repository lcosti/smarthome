<script setup lang="ts">
/**
 * One step of a method: a number, some prose, and a way to move it.
 *
 * Editing happens in place rather than in a slideover, unlike an ingredient
 * line. An ingredient is three fields worth choosing between; a step is one
 * paragraph you want to see in context while you fix it, because the sentence
 * before it is half the reason you are editing.
 *
 * The parent owns which step is open, so only ever one is.
 */
const { index, text, editing, canMoveUp, canMoveDown } = defineProps<{
  /** 1-based, for display. Steps are numbered by position, never stored. */
  index: number
  text: string
  editing: boolean
  canMoveUp: boolean
  canMoveDown: boolean
}>()

const emit = defineEmits<{
  edit: []
  save: [text: string]
  remove: []
  moveUp: []
  moveDown: []
  done: []
}>()

const draft = ref(text)

// The draft follows the row while this step is closed — another device may have
// edited it in the meantime — and is left strictly alone while it is open, so
// nothing arriving over realtime can overwrite half a typed sentence.
watch(() => [editing, text] as const, () => {
  if (!editing) draft.value = text
}, { immediate: true })

/**
 * Saved on blur as well as on Done, so a step survives the keyboard being
 * dismissed or the app being swiped away mid-sentence. Blur deliberately does
 * not close the row: the Remove button below has to stay clickable through the
 * blur it causes.
 */
function save() {
  const trimmed = draft.value.trim()
  if (!trimmed || trimmed === text) return
  emit('save', trimmed)
}

function done() {
  save()
  emit('done')
}
</script>

<template>
  <li class="border-b border-default last:border-b-0">
    <div
      v-if="editing"
      class="px-2 py-2"
    >
      <div class="flex gap-2">
        <span class="mt-3 w-5 shrink-0 text-sm tabular-nums text-dimmed">{{ index }}</span>
        <UTextarea
          v-model="draft"
          autofocus
          autoresize
          :rows="3"
          size="xl"
          class="flex-1"
          aria-label="Step"
          @blur="save"
        />
      </div>

      <div class="mt-2 flex items-center gap-2 pl-7">
        <UButton
          icon="i-lucide-trash-2"
          size="sm"
          color="error"
          variant="ghost"
          @click="$emit('remove')"
        >
          Remove
        </UButton>
        <div class="flex-1" />
        <UButton
          size="sm"
          color="neutral"
          variant="subtle"
          @click="done"
        >
          Done
        </UButton>
      </div>
    </div>

    <div
      v-else
      class="flex items-start gap-1 px-1"
    >
      <button
        type="button"
        class="flex min-h-12 min-w-0 flex-1 gap-2 px-2 py-3 text-left active:bg-elevated/60"
        @click="$emit('edit')"
      >
        <span class="w-5 shrink-0 text-sm leading-6 tabular-nums text-dimmed">{{ index }}</span>
        <span class="min-w-0 flex-1 whitespace-pre-line leading-6">{{ text }}</span>
      </button>

      <!-- Stacked rather than side by side: a step is a tall row, and this keeps
           both arrows next to the text they move. -->
      <div class="flex shrink-0 flex-col py-1">
        <UButton
          icon="i-lucide-chevron-up"
          size="sm"
          color="neutral"
          variant="ghost"
          :disabled="!canMoveUp"
          :aria-label="`Move step ${index} up`"
          @click="$emit('moveUp')"
        />
        <UButton
          icon="i-lucide-chevron-down"
          size="sm"
          color="neutral"
          variant="ghost"
          :disabled="!canMoveDown"
          :aria-label="`Move step ${index} down`"
          @click="$emit('moveDown')"
        />
      </div>
    </div>
  </li>
</template>
