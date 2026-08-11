<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import { usePlanStore, type PlannedEntry, type PlannedNight } from '../stores/plan'
import type { RankedCandidate } from '../utils/generator'
import type { Meal } from '../utils/meal'
import { initialOf } from '../utils/person-colors'
import { defaultCook } from '../utils/plan-cook'

/**
 * What the grid cannot answer without being read across: the week in numbers,
 * who is at the table for it, and what to put on the nights still open.
 *
 * Who is eating is a column-by-column fact laid out sideways — seven cards each
 * showing four faces is a roll-call you have to perform yourself. One row per
 * person answers it: a count of the nights they are in for, and a chip saying
 * whether they are missing any of them, which is also what opens the menu that
 * changes it.
 *
 * Those rows live behind a button now rather than in the column. A household
 * where everybody is in all week — the ordinary case — spent four cards saying
 * "7 of 7 nights" four times, in the same column as the week's numbers and the
 * shortlist, which are the two things anybody planning is actually reading. The
 * button says the exception in a line and holds the rows for when there is one
 * to change.
 *
 * That button sits in the week card's footer rather than in a block of its own,
 * so the column is two objects — the week, and what to cook — instead of three.
 * Everything the merge saved goes to the shortlist, which is the only part of
 * this column that scrolls.
 */
const { nights, suggestions, target } = defineProps<{
  nights: PlannedNight[]
  /** Ranked meals for the night the buttons plan onto. Empty when the week is full. */
  suggestions: RankedCandidate[]
  /** The first night still empty and still ahead, or null when there is none. */
  target: string | null
}>()

const emit = defineEmits<{ pick: [recipeId: string, meal: Meal] }>()

const people = usePeopleStore()
const attendance = useAttendanceStore()
const plan = usePlanStore()

/**
 * Attendance across the whole week, not across the nights that happen to have a
 * meal on them.
 *
 * The denominator used to be the planned nights, which made an unplanned week
 * read "0 of 0 nights" for everybody — including somebody who is in on two of
 * them — and made the number move every time a dinner was chosen. Whether Luke
 * is eating here on Saturday is a fact about Saturday; it does not wait for
 * anyone to decide what is being cooked.
 */
const roster = computed(() =>
  people.people.map((person) => {
    const present = attendance.nightsPresent(person.id, nights.map(night => night.date))
    const total = nights.length
    return {
      id: person.id,
      name: person.name,
      initial: initialOf(person.name),
      avatar: person.avatar,
      // Whether the cooking menu is offered at all — the stove is an adult's.
      adult: people.lifeStageOf(person.id) === 'adult',
      present,
      total,
      away: total > 0 && present < total,
      nights: nights.map(night => ({
        date: night.date,
        label: new Date(
          Number(night.date.slice(0, 4)),
          Number(night.date.slice(5, 7)) - 1,
          Number(night.date.slice(8, 10))
        ).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
        present: attendance.isPresent(person.id, night.date)
      }))
    }
  })
)

/**
 * One person's week as a menu of checkboxes, headed by whose week it is.
 *
 * `checked` is read straight off the roster rather than held separately, so the
 * menu shows attendance rather than a copy of it that can drift.
 *
 * The menu stays open across a tick. A dropdown closing on select is right when
 * the items are commands and picking one ends the task, and wrong here: "who is
 * eating this week" is answered several nights at a time — away Wednesday,
 * Thursday and Friday is one thought, not three — and re-opening the same menu
 * between each of them is the whole of the friction. Reka closes on `select`
 * unless the event is prevented, so each night prevents it.
 */
/**
 * The whole roster in one line, for the button that holds it.
 *
 * The exception rather than the roll-call: a week everybody is in for is the
 * ordinary case and needs no names, and a week with somebody out is a week whose
 * one interesting fact is who. Two names still fit; past that it is a count,
 * because the button is a column narrow enough that four names would truncate
 * into saying nothing.
 */
const rosterSummary = computed(() => {
  if (!roster.value.length) return 'Nobody yet'
  const away = roster.value.filter(person => person.away)
  if (!away.length) return 'Everyone in all week'
  if (away.length === 1) return `${away[0]!.name} away ${away[0]!.total - away[0]!.present}`
  if (away.length === 2) return `${away[0]!.name} and ${away[1]!.name} away`
  return `${away.length} people away`
})

function nightItems(person: { id: string, name: string, nights: { date: string, label: string, present: boolean }[] }) {
  return [
    [{ label: `${person.name} is eating`, type: 'label' as const }],
    person.nights.map(night => ({
      label: night.label,
      type: 'checkbox' as const,
      checked: night.present,
      onSelect: (event: Event) => event.preventDefault(),
      onUpdateChecked: (checked: boolean) => {
        attendance.setPresence(person.id, night.date, checked)
      }
    }))
  ]
}

/** The night's dinner, if it is one somebody actually cooks. */
function cookable(date: string): PlannedEntry | null {
  const planned = nights.find(night => night.date === date)?.entries[0]
  return planned && !planned.skipped && !planned.leftover ? planned : null
}

/**
 * The same menu as the roster's, asked about the stove: one checkbox per night,
 * checked where this person is the cook — by somebody's say-so or as the sole
 * adult at the table (plan-cook.ts), which is also what the cards show. Ticking
 * a night writes them onto its dinner, taking it off whoever had it; unticking
 * writes null, which hands the night back to the default rule. Nights with
 * nothing to cook — unplanned, skipped, leftovers — are disabled rather than
 * hidden, so the week keeps its shape.
 */
function cookNightItems(person: { id: string, name: string, nights: { date: string, label: string }[] }) {
  return [
    [{ label: `${person.name} is cooking`, type: 'label' as const }],
    person.nights.map((night) => {
      const planned = cookable(night.date)
      const cookId = planned
        ? people.personById(planned.entry.cook_person_id)?.id
        ?? defaultCook(attendance.presentOn(night.date), night.date)?.id
        : undefined
      return {
        label: night.label,
        type: 'checkbox' as const,
        checked: cookId === person.id,
        disabled: !planned,
        onSelect: (event: Event) => event.preventDefault(),
        onUpdateChecked: (checked: boolean) => {
          if (planned) plan.updateEntry(planned.entry.id, { cook_person_id: checked ? person.id : null })
        }
      }
    })
  ]
}
</script>

<template>
  <!--
    A column beside the week rather than a panel on top of it: the rule down its
    left edge is the only frame it needs, and the cards inside are the objects.
    shrink-0 on every block is load-bearing, exactly as in the recipe pane —
    without it the roster is squashed below its own content to make room for
    what follows and overflows onto it.
  -->
  <div class="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-default px-5 py-4">
    <PlanWeekStats
      :nights="nights"
      class="shrink-0"
    >
      <!--
        The roster, folded up, in the week's own card. It is read far less often
        than it is looked past — most weeks the answer is "everybody, all of it"
        — so the column keeps the one line that would change your mind and the
        rows open on a press. No heading over it either: five avatars and "Luke
        away 5" are not improved by "Who is eating" above them, and the name it
        answers to is on the button's `aria-label`, which is where a label worth
        having only when you cannot see the faces belongs.
      -->
      <template #footer>
        <UPopover
          v-if="roster.length"
          :content="{ align: 'start', side: 'bottom' }"
        >
          <UButton
            color="neutral"
            variant="subtle"
            size="sm"
            block
            class="justify-between"
            trailing-icon="i-lucide-chevron-down"
            :aria-label="`Who is eating: ${rosterSummary}`"
          >
            <span class="flex min-w-0 items-center gap-2">
              <!--
                Four faces and then a count. The line beside them is the fact
                worth reading — a fifth avatar buys one more initial at the price
                of truncating "Everyone in all week" into "Everyone in all w…".
              -->
              <UAvatarGroup
                :max="4"
                size="3xs"
              >
                <UAvatar
                  v-for="person in roster"
                  :key="person.id"
                  :src="person.avatar ?? undefined"
                  :alt="person.name"
                  :text="person.initial"
                />
              </UAvatarGroup>
              <span class="truncate text-sm font-normal">{{ rosterSummary }}</span>
            </span>
          </UButton>

          <template #content>
            <ul class="flex w-80 flex-col gap-2 p-2">
              <li
                v-for="person in roster"
                :key="person.id"
              >
                <UCard
                  variant="soft"
                  :ui="{ body: 'flex items-center gap-2.5 px-3 py-2.5 sm:p-3' }"
                >
                  <UAvatar
                    :src="person.avatar ?? undefined"
                    :alt="person.name"
                    :text="person.initial"
                    size="sm"
                  />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
                    {{ person.name }}
                  </span>
                  <span class="shrink-0 text-xs text-dimmed tabular-nums">
                    {{ person.present }} of {{ person.total }} nights
                  </span>

                  <!--
                    What it says and what changes it are the same object: marking
                    Tuesday away used to mean opening a night, which is the wrong
                    unit, because absence is a fact about a person across a week.
                    A button rather than a badge, chip-shaped though it is — it
                    opens a menu, and that is what a button is for. A checkbox
                    menu rather than a popover full of buttons: seven nights each
                    independently on or off is exactly what it models, and it
                    brings the keyboard handling and the roles with it.

                    A menu inside the roster's own popover. Both are dismissable
                    layers and the menu is the inner one, so a press inside it
                    dismisses neither — which is what keeps "away Wednesday,
                    Thursday and Friday" one thought rather than three.
                  -->
                  <!--
                    The eating menu's twin, for the stove. Adults only — the
                    picker in the night editor draws the same line.
                  -->
                  <UDropdownMenu
                    v-if="person.adult"
                    :items="cookNightItems(person)"
                    :ui="{ content: 'p-1.5' }"
                  >
                    <UButton
                      icon="i-lucide-chef-hat"
                      color="neutral"
                      variant="subtle"
                      size="xs"
                      class="shrink-0"
                      :aria-label="`Which nights ${person.name} cooks`"
                    />
                  </UDropdownMenu>

                  <UDropdownMenu
                    :items="nightItems(person)"
                    :ui="{ content: 'p-1.5' }"
                  >
                    <UButton
                      :color="person.away ? 'neutral' : 'primary'"
                      variant="subtle"
                      size="xs"
                      class="shrink-0"
                      :label="person.away ? `Away ${person.total - person.present}` : 'Eating in'"
                    />
                  </UDropdownMenu>
                </UCard>
              </li>
            </ul>
          </template>
        </UPopover>

        <UEmpty
          v-else
          variant="naked"
          size="sm"
          icon="i-lucide-users"
          title="Nobody in the household yet"
          description="Add people in Settings and the week starts catering for them."
          :ui="{ root: 'p-0 sm:p-0' }"
        />
      </template>
    </PlanWeekStats>

    <PlanSuggestions
      :suggestions="suggestions"
      :nights="nights"
      :target="target"
      class="shrink-0"
      @pick="(recipeId, meal) => emit('pick', recipeId, meal)"
    />
  </div>
</template>
