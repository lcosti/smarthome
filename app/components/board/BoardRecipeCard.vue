<script setup lang="ts">
import type { LibraryCard } from '../../utils/board'

/**
 * One recipe in the library grid.
 *
 * The photograph does the work. Reading a wall from the other side of a kitchen,
 * a picture says "the orzo one" in the time it takes to notice a title exists —
 * so the image is the top half of the card and the words underneath are for
 * confirming, not for finding.
 *
 * A recipe with no photograph gets the hatched panel rather than a collapsed
 * card: the grid is scanned by shape, and cards of two different heights turn a
 * tidy wall into a jumble. `<RecipeImage>` renders nothing when its address is
 * missing or dead, which is exactly what lets the panel show through.
 */
defineProps<{ card: LibraryCard }>()

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    data-recipe-card
    :data-selected="card.selected ? '' : undefined"
    class="flex flex-col overflow-hidden rounded-lg text-left transition-[opacity,background-color] duration-[80ms] active:opacity-85"
    :class="card.selected
      ? 'bg-elevated ring-2 ring-primary'
      : 'bg-elevated/50 ring ring-default hover:bg-elevated'"
    @click="$emit('select')"
  >
    <div class="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-accented/20">
      <!--
        Hatching rather than a flat grey or an icon: it reads as "no photograph
        here" instead of as an image still loading, which on a board that paints
        from IndexedDB with no network is a distinction worth drawing.
      -->
      <div
        class="size-full bg-[repeating-linear-gradient(135deg,var(--ui-bg-accented)_0_6px,transparent_6px_12px)] opacity-60"
      />
      <RecipeImage
        :src="card.image"
        :alt="card.name"
        class="absolute inset-0"
      />

      <UBadge
        v-if="card.plannedDay"
        color="primary"
        variant="solid"
        :label="card.plannedDay"
        class="absolute right-2.5 top-2.5 px-2 py-0.5 font-mono text-[11px] tracking-[0.06em]"
      />

      <!--
        Bottom left, out of the planned badge's corner: the two can be true at
        once, and a night already planned that also needs no shopping is the best
        card on the wall.
      -->
      <UBadge
        v-if="card.fromPantry"
        color="neutral"
        variant="solid"
        icon="i-lucide-package-check"
        label="Have it all"
        class="absolute bottom-2.5 left-2.5 px-2 py-0.5 font-mono text-[11px] tracking-[0.06em]"
      />
    </div>

    <div class="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <h3
        class="line-clamp-1 text-[17px] font-medium"
        :class="card.selected ? 'text-highlighted' : 'text-default'"
      >
        {{ card.name }}
      </h3>
      <p class="font-mono text-xs text-dimmed">
        {{ card.meta }}
      </p>

      <div
        v-if="card.chips.length"
        class="flex flex-wrap gap-1.5"
      >
        <UBadge
          v-for="chip in card.chips"
          :key="chip"
          color="neutral"
          variant="outline"
          :label="chip"
          class="rounded bg-default px-2 py-0.5 text-[12px] font-normal text-muted"
        />
      </div>
    </div>
  </button>
</template>
