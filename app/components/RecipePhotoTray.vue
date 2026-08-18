<script setup lang="ts">
/**
 * The pages photographed so far, before they are sent to be read.
 *
 * The camera takes one picture at a time — `capture` on a file input is one
 * shot per tap, and on iOS it silently drops `multiple` — but a cookbook recipe
 * is regularly a spread, ingredients on one page and the method overleaf. So
 * the shots pile up here instead: take one, come back, take the other, then
 * read them together. It is the scanner-app shape, and it is the whole reason
 * the camera can be offered as its own choice rather than left to whatever
 * chooser the phone happens to put up.
 *
 * Only the camera path opens this. Choosing from the library already shows you
 * what you picked while you are picking it, and a confirmation step after that
 * would be a tap spent agreeing with yourself.
 *
 * Discarding is dismissing: nothing has been sent anywhere yet, and a tray you
 * swiped away is a set of photos you decided against.
 */
const open = defineModel<boolean>('open', { required: true })

const { files, max } = defineProps<{
  /** The shots taken so far, in the order they were taken. */
  files: File[]
  /** What the Edge Function will read in one go. */
  max: number
}>()

const emit = defineEmits<{
  /** Open the camera again for the next page. */
  add: []
  /** Drop a page — a shot with a thumb over the corner of it. */
  remove: [index: number]
  /** Send what is here to be read. */
  read: []
}>()

/**
 * Thumbnails, as object URLs rather than as base64.
 *
 * These are three-megabyte camera files and they are on screen for a few
 * seconds, so nothing is decoded, scaled or copied for them — the browser draws
 * the file it already has. Revoked whenever the set changes and again on the
 * way out, because an object URL keeps its file in memory until it is.
 */
const previews = ref<string[]>([])

function drawPreviews(list: File[]) {
  for (const url of previews.value) URL.revokeObjectURL(url)
  previews.value = list.map(file => URL.createObjectURL(file))
}

watch(() => files, drawPreviews, { immediate: true })
onUnmounted(() => drawPreviews([]))

const full = computed(() => files.length >= max)
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    :title="files.length === 1 ? 'One page' : `${files.length} pages`"
    :description="full
      ? 'That is as much as one recipe can be read from.'
      : 'Add the next page if the recipe carries on overleaf.'"
  >
    <template #body>
      <ul class="grid grid-cols-3 gap-3">
        <li
          v-for="(src, index) in previews"
          :key="src"
          class="relative"
        >
          <img
            :src="src"
            :alt="`Page ${index + 1}`"
            class="aspect-[3/4] w-full rounded-lg border border-default object-cover"
          >
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="solid"
            size="xs"
            class="absolute -end-1.5 -top-1.5 rounded-full"
            :aria-label="`Remove page ${index + 1}`"
            @click="emit('remove', index)"
          />
        </li>
      </ul>
    </template>

    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          icon="i-lucide-camera"
          color="neutral"
          variant="subtle"
          label="Add a page"
          :disabled="full"
          data-testid="recipe-add-page"
          @click="emit('add')"
        />
        <div class="flex-1" />
        <UButton
          size="lg"
          label="Read the recipe"
          :disabled="!files.length"
          data-testid="recipe-read-photos"
          @click="emit('read')"
        />
      </div>
    </template>
  </USlideover>
</template>
