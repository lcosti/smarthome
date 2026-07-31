<script setup lang="ts">
import type { RosterPerson } from '../../utils/board'
import { personColors } from '../../utils/person-colors'

/**
 * One person at tonight's table: who they are, what goes on their plate, and
 * anything about them that needs acting on before the food does.
 *
 * Tapping toggles whether they are eating. That is the one edit worth making
 * from across the kitchen — somebody's plans changed — and it is the only reason
 * this row is a button.
 */
const { person } = defineProps<{ person: RosterPerson }>()

defineEmits<{ toggle: [] }>()

const nameInk = computed(() => personColors(person.hue, { absent: person.absent }).nameInk)
</script>

<template>
  <button
    type="button"
    class="grid w-full grid-cols-[68px_200px_1fr] items-center gap-5 rounded-[14px]
           border border-default bg-default px-5 py-2 text-left transition-opacity
           duration-[80ms] active:opacity-85"
    :style="{ opacity: person.absent ? '0.45' : '1' }"
    @click="$emit('toggle')"
  >
    <BoardAvatar
      :initial="person.initial"
      :hue="person.hue"
      :absent="person.absent"
      :size="68"
    />

    <span
      class="truncate text-[28px] font-medium"
      :style="{ color: nameInk, textDecoration: person.absent ? 'line-through' : 'none' }"
    >
      {{ person.name }}
    </span>

    <span class="flex min-w-0 justify-end gap-[10px]">
      <UBadge
        v-if="person.note"
        color="neutral"
        variant="soft"
        :ui="{ base: 'rounded-full whitespace-nowrap px-5 py-[10px] text-[21px] leading-tight ring-1 ring-default' }"
      >
        {{ person.note }}
      </UBadge>
      <UBadge
        v-if="person.warn"
        color="warning"
        variant="soft"
        :ui="{ base: 'rounded-full whitespace-nowrap px-5 py-[10px] text-[21px] leading-tight ring-1 ring-warning/50' }"
      >
        {{ person.warn }}
      </UBadge>
    </span>
  </button>
</template>
