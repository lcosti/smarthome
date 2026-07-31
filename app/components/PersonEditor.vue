<script setup lang="ts">
import { usePeopleStore } from '../stores/people'
import type { ConstraintKind } from '../utils/attendance'
import { ageLabel, deriveLifeStage, STAGE_LABEL } from '../utils/people'
import { todayIso } from '../utils/week'

const open = defineModel<boolean>('open', { required: true })
const { personId } = defineProps<{ personId: string | null }>()

const store = usePeopleStore()

const name = ref('')
const dateOfBirth = ref('')
const kind = ref<ConstraintKind>('allergy')
const tag = ref('')

const person = computed(() => (personId ? store.personById(personId) ?? null : null))
const constraints = computed(() => (personId ? store.constraintsFor(personId) : []))

/** Signing in is what makes a person a member, so their row cannot be removed. */
const hasLogin = computed(() => Boolean(person.value?.auth_user_id))

/** Shown live beside the date, so a mistyped year is obvious before it is saved. */
const preview = computed(() => {
  const today = todayIso()
  const dob = dateOfBirth.value || null
  const stage = STAGE_LABEL[deriveLifeStage(dob, today)]
  const age = ageLabel(dob, today)
  return age ? `${stage} · ${age}` : stage
})

const KINDS: { value: ConstraintKind, label: string, description: string }[] = [
  { value: 'allergy', label: 'Allergy', description: 'Never planned.' },
  { value: 'intolerance', label: 'Intolerance', description: 'Never planned.' },
  { value: 'dislike', label: 'Dislike', description: 'Planned less often.' },
  { value: 'preference', label: 'Preference', description: 'Planned more often.' }
]

watch(open, (isOpen) => {
  if (!isOpen || !person.value) return
  name.value = person.value.name
  dateOfBirth.value = person.value.date_of_birth ?? ''
  kind.value = 'allergy'
  tag.value = ''
}, { immediate: true })

async function save() {
  if (!personId || !name.value.trim()) return
  await store.updatePerson(personId, {
    name: name.value.trim(),
    date_of_birth: dateOfBirth.value || null
  })
  open.value = false
}

async function addConstraint() {
  if (!personId || !tag.value.trim()) return
  await store.addConstraint(personId, kind.value, tag.value)
  tag.value = ''
}

async function remove() {
  if (!personId) return
  await store.removePerson(personId)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    :title="person?.name ?? 'Person'"
  >
    <template #body>
      <div
        v-if="person"
        class="space-y-5"
      >
        <UFormField label="Name">
          <UInput
            v-model="name"
            size="xl"
            class="w-full"
            autocapitalize="words"
          />
        </UFormField>

        <UFormField
          label="Date of birth"
          help="How the portions are worked out. Nothing stores the label, so it keeps up on its own."
        >
          <div class="flex items-center gap-3">
            <UInput
              v-model="dateOfBirth"
              type="date"
              size="lg"
              class="flex-1"
            />
            <UBadge
              color="neutral"
              variant="subtle"
              size="lg"
            >
              {{ preview }}
            </UBadge>
          </div>
        </UFormField>

        <UFormField
          label="Can't or won't eat"
          help="Allergies and intolerances are never planned. Dislikes and preferences only shift the odds."
        >
          <div
            v-if="constraints.length"
            class="mb-2 flex flex-wrap gap-2"
          >
            <UBadge
              v-for="constraint in constraints"
              :key="constraint.id"
              :color="constraint.kind === 'allergy' || constraint.kind === 'intolerance' ? 'warning' : 'neutral'"
              variant="subtle"
              size="lg"
            >
              {{ constraint.tag }}
              <span class="ml-1 text-xs opacity-70">{{ constraint.kind }}</span>
              <UButton
                type="button"
                icon="i-lucide-x"
                color="neutral"
                variant="link"
                size="xs"
                :aria-label="`Remove ${constraint.tag}`"
                :ui="{ base: 'p-0 ms-1' }"
                @click="store.removeConstraint(constraint.id)"
              />
            </UBadge>
          </div>

          <!--
            A radio group rather than four buttons, which is what this always
            was: one choice out of four, and the cards are where the difference
            between an allergy and a dislike finally gets said out loud instead
            of sitting unread in KINDS.
          -->
          <URadioGroup
            v-model="kind"
            :items="KINDS"
            variant="card"
            orientation="horizontal"
            :ui="{ fieldset: 'flex-wrap gap-2', item: 'flex-1 basis-40' }"
          />

          <UForm
            :state="{ tag }"
            class="mt-2 flex gap-2"
            @submit="addConstraint"
          >
            <UInput
              v-model="tag"
              size="lg"
              placeholder="peanuts"
              autocapitalize="none"
              class="flex-1"
            />
            <UButton
              type="submit"
              size="lg"
              icon="i-lucide-plus"
              :disabled="!tag.trim()"
              aria-label="Add"
            />
          </UForm>
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <UButton
          v-if="!hasLogin"
          color="error"
          variant="ghost"
          @click="remove"
        >
          Remove
        </UButton>
        <p
          v-else
          class="text-xs text-dimmed"
        >
          Signed in on this household.
        </p>
        <div class="flex-1" />
        <UButton
          size="lg"
          :disabled="!name.trim()"
          @click="save"
        >
          Save
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
