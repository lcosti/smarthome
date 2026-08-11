<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePlanStore } from '../stores/plan'
import { initialOf } from '../utils/person-colors'

/**
 * Who is at the table on a day: the faces, and how many are eating.
 *
 * One answer to that question in two places. It was the night card's footer,
 * and the wide plan has since laid the week out as days across breakfast, lunch
 * and dinner — where the roll-call rides in the day's gutter under the date,
 * because it is a fact about the day rather than about any one of its meals.
 * The card still shows it in its footer at widths where it stands alone.
 *
 * One line in both places. The gutter used to stack the faces over the count,
 * because at `8rem` they did not fit beside each other; the gutter is `10rem`
 * now — the diary needed the width more than the roll-call did — and the line
 * the stack was spending is the line the diary sits on.
 *
 * Deliberately per day and not per meal: attendance is kept once, against the
 * dinner, and the reasoning for that lives in `stores/attendance.ts`.
 */
const { date } = defineProps<{
  date: string
}>()

const attendance = useAttendanceStore()
const plan = usePlanStore()

/**
 * Only who is eating. A day is a list of the people at the table, not a register
 * of the household with some of it crossed out — the count beside the faces is
 * what says how many are missing, and it says it in one number.
 */
const faces = computed(() =>
  attendance.presentOn(date).map(person => ({
    id: person.id,
    name: person.name,
    initial: initialOf(person.name),
    avatar: person.avatar
  }))
)

/**
 * How many portions the day is for, and whether it is for anybody at all.
 *
 * Both come off the store rather than being counted here, so that the number
 * shown and the nights "Fill empty nights" is willing to touch are the same
 * arithmetic. A pre-weaning baby is at the table and eating nothing off it,
 * exactly as the generator counts it — otherwise this promises a portion nobody
 * plates.
 */
const eating = computed(() => plan.eatersOn(date))
const nobodyHome = computed(() => plan.nobodyEatingOn(date))
</script>

<template>
  <div class="flex min-w-0 items-center gap-2">
    <UAvatarGroup
      :max="5"
      size="xs"
    >
      <UAvatar
        v-for="face in faces"
        :key="face.id"
        :src="face.avatar ?? undefined"
        :alt="face.name"
        :text="face.initial"
      />
    </UAvatarGroup>
    <!-- "0 eating" is a count of nothing beside a row of nobody. Say it. -->
    <span class="truncate text-xs text-dimmed">{{ nobodyHome ? 'Nobody home' : `${eating} eating` }}</span>
  </div>
</template>
