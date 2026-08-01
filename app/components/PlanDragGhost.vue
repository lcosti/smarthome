<script setup lang="ts">
import { usePlanDrag } from '../composables/usePlanDrag'

/**
 * The dish in your hand while you decide where to put it.
 *
 * Teleported to the body and positioned in viewport coordinates, because both
 * shapes of the plan drag *out* of a scrolling box — a card following the
 * pointer from inside the week column would be clipped the moment it crossed
 * into the aside.
 *
 * Deliberately small and slightly rotated: it reads as a thing lifted off the
 * page rather than as a second copy of the night, and it stays clear of the
 * night underneath it, which is the one that has to be visible to aim at.
 *
 * `pointer-events-none` throughout. The hit test asks what is under the finger,
 * and the answer must never be this.
 */
const { payload, pointer } = usePlanDrag()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="payload"
      class="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rotate-2"
      :style="{ left: `${pointer.x}px`, top: `${pointer.y}px` }"
    >
      <UCard
        variant="subtle"
        :ui="{ root: 'bg-elevated shadow-xl ring-2 ring-primary', body: 'flex items-center gap-2.5 px-3 py-2.5 sm:p-3' }"
      >
        <RecipeThumb
          :src="payload.image"
          :alt="payload.label"
        />
        <span class="line-clamp-2 max-w-44 text-sm font-medium leading-tight">
          {{ payload.label }}
        </span>
      </UCard>
    </div>
  </Teleport>
</template>
