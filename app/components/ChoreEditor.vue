<script setup lang="ts">
import { useChoresStore } from '../stores/chores'
import { usePeopleStore } from '../stores/people'
import { choreRule, ordinalDay, WEEKDAY_LABELS } from '../utils/chores'
import { todayIso } from '../utils/week'

/**
 * A chore, as somebody describes it: a name, whose it is, when it happens.
 *
 * "When" is the only place this has a real decision in it, and it is a radio
 * rather than four sections, because a chore is one of these and never two. The
 * store refuses anything else; this is where that refusal is made impossible to
 * reach instead.
 *
 * The radio has four options and the row has three shapes, because "every other
 * week" is a weekly rule with an interval rather than a kind of its own — the
 * translation is `save`, one line each way, and it stays here rather than
 * spreading a second name for the same rule through the store and the schema.
 */

const open = defineModel<boolean>('open', { required: true })
const { choreId } = defineProps<{ choreId: string | null }>()

const store = useChoresStore()
const people = usePeopleStore()

/**
 * A chore belonging to nobody in particular is a null `person_id`, but a select
 * whose value is null reads as nothing chosen. So the field carries '' and the
 * translation happens on the way in and out — one line each way, rather than a
 * placeholder pretending to be an answer.
 */
const EVERYONE = ''

/**
 * Monday first, as the week is read everywhere else in the app.
 *
 * Values are strings because that is what UCheckboxGroup and USelectMenu take;
 * the columns are ISO weekday numbers, and `save` is where the two meet.
 */
const WEEKDAYS = WEEKDAY_LABELS.map((label, index) => ({ value: String(index + 1), label }))

const REPEATS = [
  { value: 'weekly', label: 'Every week', description: 'Comes back on the same days.' },
  { value: 'fortnightly', label: 'Every other week', description: 'The same days, one week in two.' },
  { value: 'monthly', label: 'Every month', description: 'A date, or a weekday like the first Sunday.' },
  { value: 'once', label: 'One day', description: 'Shows on that date only.' }
]

/**
 * The two monthly shapes in one control: pick a date, or pick which weekday.
 *
 * 'day' is the sentinel for "a date", the same trick the assignee select plays
 * with ''. Everything else is the `month_week` column as a string, and -1 is
 * last. Fifth is not offered — a month that has not got one would have to fall
 * back to something, and "last" is that answer said properly.
 */
const MONTH_WHICH = [
  { value: 'day', label: 'Day of the month' },
  { value: '1', label: 'First' },
  { value: '2', label: 'Second' },
  { value: '3', label: 'Third' },
  { value: '4', label: 'Fourth' },
  { value: '-1', label: 'Last' }
]

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => ({
  value: String(index + 1),
  label: ordinalDay(index + 1)
}))

const name = ref('')
const personId = ref<string>(EVERYONE)
const repeats = ref<'weekly' | 'fortnightly' | 'monthly' | 'once'>('weekly')
const weekdays = ref<string[]>([])
const anchorDate = ref('')
const monthWhich = ref('day')
const monthDay = ref('1')
const monthWeekday = ref('1')
const dueDate = ref('')
const atTime = ref('')
const confirmDelete = ref(false)

const chore = computed(() => (choreId ? store.choreById(choreId) : null))

const assignees = computed(() => [
  { value: EVERYONE, label: 'Everyone' },
  ...people.people.map(person => ({ value: person.id, label: person.name }))
])

/** Both rules that run on weekdays, which are the ones showing the Days field. */
const onWeekdays = computed(() => repeats.value === 'weekly' || repeats.value === 'fortnightly')

const valid = computed(() => {
  if (!name.value.trim()) return false
  if (repeats.value === 'once') return Boolean(dueDate.value)
  if (repeats.value === 'monthly') return true
  return weekdays.value.length > 0 && (repeats.value === 'weekly' || Boolean(anchorDate.value))
})

watch(open, (isOpen) => {
  if (!isOpen) return
  const row = chore.value
  const rule = row ? choreRule(row) : 'weekly'
  name.value = row?.name ?? ''
  personId.value = row?.person_id ?? EVERYONE
  repeats.value = rule === 'weekly' && (row?.week_interval ?? 1) > 1 ? 'fortnightly' : rule
  weekdays.value = (row?.weekdays ?? []).map(String)
  // A new fortnightly chore starts this week, which is what somebody adding one
  // on a Tuesday means by it.
  anchorDate.value = row?.anchor_date ?? todayIso()
  monthWhich.value = row?.month_day || !row?.month_week ? 'day' : String(row.month_week)
  monthDay.value = String(row?.month_day ?? 1)
  monthWeekday.value = String(row?.month_weekday ?? 1)
  dueDate.value = row?.due_date ?? ''
  atTime.value = row?.at_time ?? ''
  confirmDelete.value = false
}, { immediate: true })

async function save() {
  if (!valid.value) return
  const byMonthDay = repeats.value === 'monthly' && monthWhich.value === 'day'
  const byMonthWeekday = repeats.value === 'monthly' && !byMonthDay
  await store.saveChore({
    name: name.value,
    personId: personId.value || null,
    rule: repeats.value === 'fortnightly' ? 'weekly' : repeats.value,
    weekdays: onWeekdays.value ? weekdays.value.map(Number) : null,
    weekInterval: repeats.value === 'fortnightly' ? 2 : null,
    anchorDate: repeats.value === 'fortnightly' ? anchorDate.value : null,
    monthDay: byMonthDay ? Number(monthDay.value) : null,
    monthWeek: byMonthWeekday ? Number(monthWhich.value) : null,
    monthWeekday: byMonthWeekday ? Number(monthWeekday.value) : null,
    dueDate: repeats.value === 'once' ? dueDate.value : null,
    atTime: atTime.value || null
  }, choreId ?? undefined)
  open.value = false
}

async function remove() {
  if (!choreId) return
  await store.deleteChore(choreId)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    :title="chore?.name ?? 'New chore'"
  >
    <template #body>
      <div class="space-y-5">
        <UFormField label="Chore">
          <UInput
            v-model="name"
            size="xl"
            class="w-full"
            placeholder="Put the bins out"
            autocapitalize="sentences"
          />
        </UFormField>

        <UFormField
          label="Whose"
          help="Everyone means it belongs to the house rather than to a person, and it shows in the neutral colour."
        >
          <USelectMenu
            v-model="personId"
            :items="assignees"
            value-key="value"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField label="When">
          <URadioGroup
            v-model="repeats"
            :items="REPEATS"
            variant="card"
            orientation="horizontal"
            :ui="{ fieldset: 'flex-wrap gap-2', item: 'flex-1 basis-40' }"
          />
        </UFormField>

        <!--
          What the chosen rule needs, and the time, across one line: the days,
          the week it starts in, the clock. They are one sentence — "Thursdays,
          from next week, at eight" — and stacking them made three rows of a form
          out of it, each one mostly empty to the right. The row wraps rather
          than squeezes, so the phone gets the stack back at its own width and
          nothing is ever narrower than what it holds.
        -->
        <div class="flex flex-wrap items-start gap-x-4 gap-y-5">
          <template v-if="onWeekdays">
            <UFormField
              label="Days"
              help="More than one is fine — bins on a Tuesday and a Friday is one chore, not two."
              class="min-w-64 flex-1"
            >
              <UCheckboxGroup
                v-model="weekdays"
                :items="WEEKDAYS"
                value-key="value"
                orientation="horizontal"
                :ui="{ fieldset: 'flex-wrap gap-x-4 gap-y-2' }"
              />
            </UFormField>

            <UFormField
              v-if="repeats === 'fortnightly'"
              label="Starting"
              help="The first week it runs in. Move it a week either way to flip which of the two weeks is the one."
              class="w-full sm:w-56"
            >
              <DateField v-model="anchorDate" />
            </UFormField>
          </template>

          <UFormField
            v-else-if="repeats === 'monthly'"
            label="Which day"
            help="A date, or a weekday like the first Sunday. A date past the end of a short month runs on its last day, so the 31st is the 28th in February."
            class="min-w-64 flex-1"
          >
            <div class="flex gap-2">
              <USelectMenu
                v-model="monthWhich"
                :items="MONTH_WHICH"
                value-key="value"
                size="lg"
                class="flex-1"
              />
              <USelectMenu
                v-if="monthWhich === 'day'"
                v-model="monthDay"
                :items="MONTH_DAYS"
                value-key="value"
                size="lg"
                class="flex-1"
              />
              <USelectMenu
                v-else
                v-model="monthWeekday"
                :items="WEEKDAYS"
                value-key="value"
                size="lg"
                class="flex-1"
              />
            </div>
          </UFormField>

          <UFormField
            v-else
            label="Date"
            class="w-full sm:w-56"
          >
            <DateField
              v-model="dueDate"
              placeholder="Pick a day"
            />
          </UFormField>

          <UFormField
            label="Time"
            help="Optional. Without one it sits at the top of the day, which is what most chores want."
            class="w-full sm:w-44"
          >
            <UInput
              v-model="atTime"
              type="time"
              size="lg"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <ConfirmModal
          v-if="choreId"
          v-model:open="confirmDelete"
          :title="`Delete ${chore?.name ?? 'this chore'}?`"
          description="It stops appearing on the board. Days already ticked off stay ticked, and nothing else changes."
          confirm-label="Delete"
          color="error"
          @confirm="remove"
        >
          <UButton
            color="error"
            variant="ghost"
            label="Delete"
          />
        </ConfirmModal>
        <div class="flex-1" />
        <UButton
          size="lg"
          :disabled="!valid"
          @click="save"
        >
          Save
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
