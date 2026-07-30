<script setup lang="ts">
import { useListStore } from '../stores/list'
import { useSyncStore } from '../stores/sync'
import type { AisleRow } from '../utils/db'

const store = useListStore()
const sync = useSyncStore()
const supabase = useSupabaseClient()
const signOut = useSignOut()
const toast = useToast()

const household = ref<{ name: string, invite_code: string } | null>(null)
const newAisle = ref('')
const drafts = ref(new Map<string, string>())

onMounted(async () => {
  if (!sync.householdId) return
  const { data } = await supabase
    .from('households')
    .select('name, invite_code')
    .eq('id', sync.householdId)
    .maybeSingle()
  household.value = data
})

async function addAisle() {
  const name = newAisle.value.trim()
  if (!name) return
  newAisle.value = ''
  await store.addAisle(name)
}

/** Renaming commits on blur, so a mutation is not queued for every keystroke. */
async function commitName(aisle: AisleRow) {
  const draft = (drafts.value.get(aisle.id) ?? aisle.name).trim()
  drafts.value.delete(aisle.id)
  if (draft && draft !== aisle.name) await store.renameAisle(aisle.id, draft)
}

async function copyInviteCode() {
  if (!household.value) return
  await navigator.clipboard.writeText(household.value.invite_code)
  toast.add({ title: 'Invite code copied', icon: 'i-lucide-check' })
}
</script>

<template>
  <div class="min-h-dvh">
    <header class="sticky top-0 z-10 border-b border-default bg-default/85 backdrop-blur">
      <div class="mx-auto flex max-w-xl items-center gap-2 px-3 py-3">
        <UButton
          to="/"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to list"
        />
        <h1 class="flex-1 truncate text-lg font-semibold">
          Settings
        </h1>
      </div>
    </header>

    <main class="mx-auto max-w-xl space-y-8 px-3 py-5 pb-28">
      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Aisles
        </h2>
        <p class="text-sm text-muted">
          Put these in the order you walk the shop. The list follows this order.
        </p>

        <ul class="divide-y divide-default rounded-lg border border-default">
          <li
            v-for="(aisle, index) in store.sortedAisles"
            :key="aisle.id"
            class="flex items-center gap-1 p-2"
          >
            <UInput
              :model-value="drafts.get(aisle.id) ?? aisle.name"
              variant="ghost"
              class="flex-1"
              @update:model-value="drafts.set(aisle.id, String($event))"
              @blur="commitName(aisle)"
            />
            <UButton
              icon="i-lucide-chevron-up"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="index === 0"
              :aria-label="`Move ${aisle.name} up`"
              @click="store.moveAisle(aisle.id, -1)"
            />
            <UButton
              icon="i-lucide-chevron-down"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="index === store.sortedAisles.length - 1"
              :aria-label="`Move ${aisle.name} down`"
              @click="store.moveAisle(aisle.id, 1)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="`Delete ${aisle.name}`"
              @click="store.deleteAisle(aisle.id)"
            />
          </li>
        </ul>

        <form
          class="flex gap-2"
          @submit.prevent="addAisle"
        >
          <UInput
            v-model="newAisle"
            placeholder="Add an aisle"
            class="flex-1"
          />
          <UButton
            type="submit"
            icon="i-lucide-plus"
            :disabled="!newAisle.trim()"
            aria-label="Add aisle"
          />
        </form>
      </section>

      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Household
        </h2>
        <div class="rounded-lg border border-default p-3">
          <p
            v-if="household"
            class="text-sm text-muted"
          >
            {{ household.name }}
          </p>
          <p
            v-else
            class="text-sm text-dimmed"
          >
            Connect to the internet to see the invite code.
          </p>

          <div
            v-if="household"
            class="mt-2 flex items-center gap-2"
          >
            <code class="rounded bg-elevated px-2 py-1 font-mono text-lg tracking-widest">
              {{ household.invite_code }}
            </code>
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="subtle"
              size="sm"
              @click="copyInviteCode"
            >
              Copy
            </UButton>
          </div>
          <p
            v-if="household"
            class="mt-2 text-xs text-dimmed"
          >
            Anyone with this code can join the household and see the list.
          </p>
        </div>
      </section>

      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          This device
        </h2>
        <p class="text-sm text-muted">
          {{ sync.pendingCount }} change{{ sync.pendingCount === 1 ? '' : 's' }} waiting to sync.
        </p>
        <UButton
          color="neutral"
          variant="subtle"
          icon="i-lucide-log-out"
          @click="signOut()"
        >
          Sign out
        </UButton>
      </section>
    </main>
  </div>
</template>
