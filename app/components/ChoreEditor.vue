<script setup lang="ts">
import { useChoresStore } from '../stores/chores'
import { usePeopleStore } from '../stores/people'

/**
 * A chore, as somebody describes it: a name, whose it is, when it happens.
 *
 * "When" is the only place this has a real decision in it — a weekly rule or a
 * single day — and it is a radio rather than two sections, because a chore is
 * one or the other and never both. The store refuses anything else; this is
 * where that refusal is made impossible to reach instead.
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
 * Values are strings because that is what UCheckboxGroup takes; the column is
 * ISO weekday numbers, and `save` is where the two meet.
 */
const WEEKDAYS = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
  { value: '7', label: 'Sun' }
]

const REPEATS = [
  { value: 'weekly', label: 'Every week', description: 'Comes back on the same days.' },
  { value: 'once', label: 'One day', description: 'Shows on that date only.' }
]

const name = ref('')
const personId = ref<string>(EVERYONE)
const repeats = ref<'weekly' | 'once'>('weekly')
const weekdays = ref<string[]>([])
const dueDate = ref('')
const atTime = ref('')
const confirmDelete = ref(false)

const chore = computed(() => (choreId ? store.choreById(choreId) : null))

const assignees = computed(() => [
  { value: EVERYONE, label: 'Everyone' },
  ...people.people.map(person => ({ value: person.id, label: person.name }))
])

const valid = computed(() =>
  Boolean(name.value.trim())
  && (repeats.value === 'weekly' ? weekdays.value.length > 0 : Boolean(dueDate.value))
)

watch(open, (isOpen) => {
  if (!isOpen) return
  const row = chore.value
  name.value = row?.name ?? ''
  personId.value = row?.person_id ?? EVERYONE
  repeats.value = row?.due_date ? 'once' : 'weekly'
  weekdays.value = (row?.weekdays ?? []).map(String)
  dueDate.value = row?.due_date ?? ''
  atTime.value = row?.at_time ?? ''
  confirmDelete.value = false
}, { immediate: true })

async function save() {
  if (!valid.value) return
  await store.saveChore({
    name: name.value,
    personId: personId.value || null,
    weekdays: repeats.value === 'weekly' ? weekdays.value.map(Number) : null,
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

        <UFormField
          v-if="repeats === 'weekly'"
          label="Days"
          help="More than one is fine — bins on a Tuesday and a Friday is one chore, not two."
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
          v-else
          label="Date"
        >
          <UInput
            v-model="dueDate"
            type="date"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Time"
          help="Optional. With one it sits in the day at that time; without one it sits at the top, which is what most chores want."
        >
          <UInput
            v-model="atTime"
            type="time"
            size="lg"
          />
        </UFormField>
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
