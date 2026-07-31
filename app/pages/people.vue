<script setup lang="ts">
import { usePeopleStore } from '../stores/people'
import { useSyncStore } from '../stores/sync'
import { isHardConstraint } from '../utils/attendance'
import { ageLabel, STAGE_LABEL } from '../utils/people'
import { useToday } from '../composables/useToday'

const store = usePeopleStore()
const sync = useSyncStore()

const newName = ref('')
const newDob = ref('')
const editingId = ref<string | null>(null)
const editorOpen = ref(false)

const today = useToday()

function edit(id: string) {
  editingId.value = id
  editorOpen.value = true
}

/** "Toddler · 2y 4m", or just the stage when nobody has said when they were born. */
function stageLine(personId: string, dateOfBirth: string | null) {
  const stage = STAGE_LABEL[store.lifeStageOf(personId, today.value)]
  const age = ageLabel(dateOfBirth, today.value)
  return age ? `${stage} · ${age}` : stage
}

async function addPerson() {
  const name = newName.value.trim()
  if (!name) return
  newName.value = ''
  const dob = newDob.value
  newDob.value = ''
  await store.addPerson(name, dob || null)
}
</script>

<template>
  <div class="min-h-dvh">
    <header class="sticky top-0 z-10 border-b border-default bg-default/85 backdrop-blur lg:static">
      <div class="mx-auto flex max-w-xl lg:max-w-3xl items-center gap-2 px-3 py-3">
        <UButton
          to="/settings"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to settings"
        />
        <h1 class="flex-1 truncate text-lg font-semibold">
          People
        </h1>
      </div>
    </header>

    <main class="mx-auto max-w-xl lg:max-w-3xl px-3 py-4 pb-28">
      <div
        v-if="!sync.hydrated"
        class="py-16 text-center text-sm text-muted"
      >
        Loading…
      </div>

      <template v-else>
        <p class="mb-3 text-sm text-muted">
          Everybody who eats here, whether or not they have a login. Ages decide
          what goes on each plate; allergies decide what never gets planned.
        </p>

        <ul
          v-if="store.people.length"
          class="divide-y divide-default rounded-lg border border-default"
        >
          <li
            v-for="person in store.people"
            :key="person.id"
          >
            <button
              type="button"
              class="flex w-full min-w-0 items-center gap-2 px-3 py-3 text-left min-h-12 active:bg-elevated/60"
              @click="edit(person.id)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ person.name }}</span>
                <span class="block truncate text-xs text-dimmed">
                  {{ stageLine(person.id, person.date_of_birth) }}
                </span>
              </span>
              <span class="flex shrink-0 flex-wrap justify-end gap-1">
                <UBadge
                  v-for="constraint in store.constraintsFor(person.id)"
                  :key="constraint.id"
                  :color="isHardConstraint(constraint.kind) ? 'warning' : 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ constraint.tag }}
                </UBadge>
              </span>
            </button>
          </li>
        </ul>

        <form
          class="mt-4 space-y-2 rounded-lg border border-default p-3"
          @submit.prevent="addPerson"
        >
          <UInput
            v-model="newName"
            size="lg"
            placeholder="Add somebody"
            autocapitalize="words"
            class="w-full"
          />
          <div class="flex gap-2">
            <UInput
              v-model="newDob"
              type="date"
              size="lg"
              class="flex-1"
            />
            <UButton
              type="submit"
              size="lg"
              icon="i-lucide-plus"
              :disabled="!newName.trim()"
              aria-label="Add person"
            />
          </div>
          <p class="text-xs text-dimmed">
            The date of birth is optional, but without it everybody is assumed to
            be an adult.
          </p>
        </form>
      </template>
    </main>

    <PersonEditor
      v-model:open="editorOpen"
      :person-id="editingId"
    />
  </div>
</template>
