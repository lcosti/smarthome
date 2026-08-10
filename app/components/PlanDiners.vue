<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import { initialOf } from '../utils/person-colors'

/**
 * Who is at the table on one night, and one press to change it.
 *
 * The aside on a wide screen asks this the other way round — a person's whole
 * week behind a menu — because that is how absence is usually decided: Tom is
 * at his dad's on Tuesdays and Thursdays. The phone is planning one night, and
 * on that night the question is who is here, so the roster is the night's and
 * the chip is a toggle rather than a menu.
 *
 * One person is one chip, in a row, rather than a card with a button on the end
 * of it. A column of rows cost the page four times its own height to answer a
 * question with four one-word answers, and the page it is on does not scroll —
 * so it was spending the room the night and the shortlist needed. It also grew
 * with the household, which meant the layout held for this family and broke for
 * a fifth person. The row scrolls sideways if it ever has to.
 *
 * The chip says what is true, not what pressing it would do. A name on an
 * accent chip with a tick is a fact about tonight; a button reading "Mark away"
 * would be an instruction, and half the household would read it as the fact.
 * The tick and the cross are what carry it — colour alone is not something to
 * ask somebody to decode, and the name is the thing being looked for.
 */
const { date } = defineProps<{ date: string }>()

const people = usePeopleStore()
const attendance = useAttendanceStore()

const diners = computed(() =>
  people.people.map(person => ({
    id: person.id,
    name: person.name,
    avatar: person.avatar,
    initial: initialOf(person.name),
    present: attendance.isPresent(person.id, date)
  }))
)
</script>

<template>
  <!--
    The negative margin is the phone page's gutter, cancelled so a roll-call
    longer than the screen runs to the edge rather than stopping short of it —
    the same bleed the shortlist below uses, for the same reason.
  -->
  <ul
    v-if="diners.length"
    class="-mx-3 flex gap-1.5 overflow-x-auto overscroll-x-contain px-3"
  >
    <li
      v-for="person in diners"
      :key="person.id"
      class="shrink-0"
    >
      <!--
        A `UButton`, per the card-and-row rule: the chip's content is a label
        with a face in front of it, not a laid-out block, which is exactly the
        case the rule says belongs to a button.
      -->
      <UButton
        :color="person.present ? 'primary' : 'neutral'"
        variant="subtle"
        size="xs"
        :label="person.name"
        :trailing-icon="person.present ? 'i-lucide-check' : 'i-lucide-x'"
        :class="person.present ? '' : 'opacity-60'"
        :ui="{ base: 'py-1.5', trailingIcon: 'size-3.5' }"
        :aria-label="`${person.name} is ${person.present ? 'eating in' : 'out'} — press to change`"
        @click="attendance.togglePresence(person.id, date)"
      >
        <template #leading>
          <UAvatar
            :src="person.avatar ?? undefined"
            :alt="person.name"
            :text="person.initial"
            size="3xs"
          />
        </template>
      </UButton>
    </li>
  </ul>
</template>
