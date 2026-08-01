<script setup lang="ts">
import { usePeopleStore } from '../stores/people'
import type { ConstraintKind } from '../utils/attendance'
import { ageLabel, deriveLifeStage, STAGE_LABEL } from '../utils/people'
import { initialOf } from '../utils/person-colors'
import { cropToAvatar } from '../utils/photo'
import { todayIso } from '../utils/week'

const open = defineModel<boolean>('open', { required: true })
const { personId } = defineProps<{ personId: string | null }>()

const store = usePeopleStore()
const toast = useToast()

const name = ref('')
const dateOfBirth = ref('')
const kind = ref<ConstraintKind>('allergy')
const tag = ref('')
const photoInput = ref<HTMLInputElement | null>(null)
const savingPhoto = ref(false)

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

/**
 * The picture, saved the moment it is picked rather than waiting for Save.
 *
 * Choosing a photograph is its own decision and reads as done as soon as the
 * face appears — the same way adding an allergy below writes immediately. The
 * name and the date of birth are a form; this is not.
 *
 * Shrunk here rather than anywhere else: a phone hands over three to twelve
 * megabytes, the row it is going into is replicated to every device in the
 * house, and utils/photo.ts turns it into a 192px square of about eight
 * kilobytes before any of that happens.
 */
async function onPhotoPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Cleared straight away so picking the same file twice in a row still fires.
  input.value = ''
  if (!file || !personId || savingPhoto.value) return

  savingPhoto.value = true
  try {
    await store.updatePerson(personId, { avatar: await cropToAvatar(file) })
  } catch {
    toast.add({
      title: 'That photo could not be read',
      description: 'Try another one, or take a new picture.',
      color: 'warning',
      icon: 'i-lucide-image-off'
    })
  } finally {
    savingPhoto.value = false
  }
}

async function removePhoto() {
  if (!personId) return
  await store.updatePerson(personId, { avatar: null })
}

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
        <UFormField
          label="Photo"
          help="Optional. Without one they are their initial, which is what every screen showed before photos existed."
        >
          <div class="flex items-center gap-3">
            <UAvatar
              :src="person.avatar ?? undefined"
              :alt="person.name"
              :text="initialOf(person.name)"
              size="3xl"
            />
            <UButton
              color="neutral"
              variant="subtle"
              size="lg"
              icon="i-lucide-camera"
              :label="person.avatar ? 'Change photo' : 'Add photo'"
              :loading="savingPhoto"
              @click="photoInput?.click()"
            />
            <UButton
              v-if="person.avatar"
              color="neutral"
              variant="ghost"
              size="lg"
              label="Remove"
              @click="removePhoto"
            />
            <!--
              A bare input rather than UFileUpload, exactly as on the recipe
              import: nothing here is visible, the control people see is the
              button beside it, and UFileUpload brings a dropzone this has no use
              for. No `capture`, so the phone offers the camera and the library
              rather than forcing the camera.
            -->
            <input
              ref="photoInput"
              type="file"
              accept="image/*"
              class="hidden"
              data-testid="person-photo-input"
              @change="onPhotoPicked"
            >
          </div>
        </UFormField>

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
