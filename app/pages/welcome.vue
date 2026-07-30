<script setup lang="ts">
import { useSyncStore } from '../stores/sync'
import { writeIdentity } from '../utils/identity'

const store = useSyncStore()
const supabase = useSupabaseClient()
const user = useSupabaseUser()

const mode = ref<'create' | 'join'>('create')
const householdName = ref('')
const personName = ref('')
const inviteCode = ref('')
const pending = ref(false)
const errorMessage = ref<string | null>(null)

// Already set up — nothing to do here.
watchEffect(() => {
  if (store.householdId) navigateTo('/')
})

const canSubmit = computed(() => {
  if (!personName.value.trim()) return false
  return mode.value === 'create' ? !!householdName.value.trim() : inviteCode.value.trim().length >= 4
})

async function submit() {
  const userId = user.value?.sub
  if (!canSubmit.value || pending.value || !userId) return

  pending.value = true
  errorMessage.value = null

  const { data, error } = mode.value === 'create'
    ? await supabase.rpc('create_household', {
        hname: householdName.value.trim(),
        pname: personName.value.trim()
      })
    : await supabase.rpc('join_household', {
        code: inviteCode.value.trim(),
        pname: personName.value.trim()
      })

  if (error || !data) {
    pending.value = false
    errorMessage.value = error?.message ?? 'That did not work. Check the invite code.'
    return
  }

  store.householdId = data
  writeIdentity({ householdId: data, userId })
  await navigateTo('/')

  // Deliberately not awaited, and deliberately after the navigation. The first
  // sync of a new household takes a moment, and navigating once it resolves
  // means anyone who taps through to Recipes or Plan in the meantime gets
  // dragged back to the list under their thumb.
  void store.sync()
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="flex min-h-full items-center justify-center p-6">
      <div class="w-full max-w-sm space-y-6">
        <div class="space-y-1 text-center">
          <h1 class="text-2xl font-semibold">
            Set up your household
          </h1>
          <p class="text-sm text-muted">
            Create one, or join the one that already exists.
          </p>
        </div>

        <div class="flex gap-2">
          <UButton
            block
            :variant="mode === 'create' ? 'solid' : 'outline'"
            @click="mode = 'create'"
          >
            Create
          </UButton>
          <UButton
            block
            :variant="mode === 'join' ? 'solid' : 'outline'"
            @click="mode = 'join'"
          >
            Join
          </UButton>
        </div>

        <form
          class="space-y-3"
          @submit.prevent="submit"
        >
          <UFormField
            v-if="mode === 'create'"
            label="Household name"
          >
            <UInput
              v-model="householdName"
              size="xl"
              placeholder="The Costis"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-else
            label="Invite code"
            help="Six characters, from the settings screen on the other phone."
          >
            <UInput
              v-model="inviteCode"
              size="xl"
              placeholder="ABC123"
              class="w-full font-mono uppercase"
            />
          </UFormField>

          <UFormField label="Your name">
            <UInput
              v-model="personName"
              size="xl"
              placeholder="Luke"
              class="w-full"
            />
          </UFormField>

          <UButton
            type="submit"
            size="xl"
            block
            :loading="pending"
            :disabled="!canSubmit"
          >
            {{ mode === 'create' ? 'Create household' : 'Join household' }}
          </UButton>

          <p
            v-if="errorMessage"
            class="text-sm text-error"
          >
            {{ errorMessage }}
          </p>
        </form>
      </div>
    </div>
  </div>
</template>
