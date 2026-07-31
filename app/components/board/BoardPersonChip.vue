<script setup lang="ts">
import type { RosterPerson } from '../../utils/board'
import { personColors } from '../../utils/person-colors'

/**
 * One person at tonight's table, as a chip.
 *
 * The roster used to be full-width rows carrying the portion and every dietary
 * tag. That was the right shape when the hero had a third of the frame to itself
 * and nothing else in it; on a denser card the roster is context, not the
 * subject, and four rows of it pushed everything the board is actually for below
 * the fold. A wrapping row of chips says the same thing in one line.
 *
 * Tapping still toggles whether they are eating. That is the one edit worth
 * making from across the kitchen — somebody's plans changed — and it is the only
 * reason this is a button.
 *
 * The amber warning is a chip of its own rather than a colour on this one: "out
 * at 18:00, plate up first" is a fact about the evening, and it has to survive
 * being next to three people who are fine.
 */
const { person } = defineProps<{ person: RosterPerson }>()

defineEmits<{ toggle: [] }>()

const nameInk = computed(() => personColors(person.hue, { absent: person.absent }).nameInk)
</script>

<template>
  <button
    type="button"
    class="flex items-center gap-2 rounded-full bg-elevated py-[5px] pl-[5px] pr-3
           text-left ring ring-accented transition-opacity duration-[80ms] active:opacity-85"
    :style="{ opacity: person.absent ? '0.45' : '1' }"
    @click="$emit('toggle')"
  >
    <BoardAvatar
      :initial="person.initial"
      :hue="person.hue"
      :absent="person.absent"
      :size="24"
    />

    <span
      class="text-sm font-medium"
      :style="{ color: nameInk, textDecoration: person.absent ? 'line-through' : 'none' }"
    >
      {{ person.name }}
    </span>

    <span
      v-if="person.note"
      class="text-xs text-dimmed"
    >
      {{ person.note }}
    </span>

    <span
      v-if="person.warn"
      class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring ring-primary/25"
    >
      {{ person.warn }}
    </span>
  </button>
</template>
