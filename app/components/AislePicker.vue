<script setup lang="ts">
import { useListStore } from '../stores/list'

/**
 * Which aisle a line belongs to, as a row of chips.
 *
 * Chips rather than a `USelectMenu`: one tap instead of open-then-tap, on a
 * field that is answered every time an item is added. There are about ten
 * aisles and they wrap onto two lines, which is the whole reason a select
 * would only be buying back space nobody needs.
 *
 * `type="button"` is load-bearing. `UButton` leaves the attribute unset, and
 * this sits inside a `UForm` where the browser default is submit — picking an
 * aisle would otherwise add the item.
 */
const model = defineModel<string | null>({ required: true })

const list = useListStore()
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <UButton
      type="button"
      size="sm"
      color="neutral"
      :variant="model === null ? 'solid' : 'outline'"
      label="Other"
      @click="model = null"
    />
    <UButton
      v-for="aisle in list.sortedAisles"
      :key="aisle.id"
      type="button"
      size="sm"
      :color="model === aisle.id ? 'primary' : 'neutral'"
      :variant="model === aisle.id ? 'solid' : 'outline'"
      :label="aisle.name"
      @click="model = aisle.id"
    />
  </div>
</template>
