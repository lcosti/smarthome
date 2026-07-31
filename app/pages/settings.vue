<script setup lang="ts">
import { useListStore } from '../stores/list'
import { useSyncStore } from '../stores/sync'
import type { AisleRow } from '../utils/db'

const store = useListStore()
const sync = useSyncStore()
const supabase = useSupabaseClient()
const signOut = useSignOut()
const toast = useToast()

const alwaysOn = useAlwaysOn()

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

/** Whether anything has ever arrived from the calendar sync, and how much. */
const calendar = computed(() => {
  const rows = [...sync.rowsOf('calendar_events').values()].filter(row => !row.deleted_at)
  return { connected: rows.length > 0, count: rows.length }
})

async function copyInviteCode() {
  if (!household.value) return
  await navigator.clipboard.writeText(household.value.invite_code)
  toast.add({ title: 'Invite code copied', icon: 'i-lucide-check' })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <AppPageHeader
      title="Settings"
      back="/"
      back-label="Back to list"
    />

    <main class="mx-auto min-h-0 w-full max-w-xl flex-1 space-y-8 overflow-y-auto px-3 py-5 lg:max-w-3xl">
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
          People
        </h2>
        <p class="text-sm text-muted">
          Everybody who eats here, children included. Their ages decide the
          portions and their allergies decide what never gets planned.
        </p>
        <UButton
          to="/people"
          color="neutral"
          variant="subtle"
          size="lg"
          block
          trailing-icon="i-lucide-chevron-right"
        >
          Manage people
        </UButton>
      </section>

      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Ingredients
        </h2>
        <p class="text-sm text-muted">
          The names your recipes share. Two recipes calling for the same thing
          become one line on the shopping list.
        </p>
        <UButton
          to="/ingredients"
          color="neutral"
          variant="subtle"
          size="lg"
          block
          trailing-icon="i-lucide-chevron-right"
        >
          Manage ingredients
        </UButton>
      </section>

      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Pantry
        </h2>
        <p class="text-sm text-muted">
          What is already in the house. Two onions left over from a three-pack
          means next week's list only asks for what you actually need.
        </p>
        <UButton
          to="/pantry"
          color="neutral"
          variant="subtle"
          size="lg"
          block
          trailing-icon="i-lucide-chevron-right"
        >
          Manage pantry
        </UButton>
      </section>

      <!--
        Read-only, and it says so. There is no per-user OAuth here — the
        sync-calendar Edge Function holds a service account and a list of
        calendar ids — so the honest thing this screen can do is report what
        arrived rather than offer a button that connects nothing. It exists
        because the board's "Connect a calendar" has to land somewhere true.
      -->
      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Calendar
        </h2>
        <div class="space-y-1 rounded-lg border border-default p-3">
          <p class="text-sm">
            {{ calendar.connected ? `${calendar.count} events cached` : 'No calendar connected' }}
          </p>
          <p class="text-sm text-muted">
            {{ calendar.connected
              ? 'Google Calendar, synced every few minutes and cached on this device so the board still shows today with the wifi down.'
              : 'Set up on the server, not here: the sync function holds the account and the list of calendars. Nothing has arrived yet.' }}
          </p>
        </div>
      </section>

      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Always-on display
        </h2>
        <div class="flex items-start gap-3 rounded-lg border border-default p-3">
          <USwitch
            v-model="alwaysOn"
            class="mt-0.5"
            aria-label="Always-on display"
          />
          <div class="space-y-1">
            <p class="text-sm">
              This screen never sleeps
            </p>
            <p class="text-sm text-muted">
              For a tablet left on in the kitchen. Everything drifts a pixel at a
              time so the layout never burns into the panel — slowly enough that
              nobody sees it move. Press F for fullscreen.
            </p>
          </div>
        </div>
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
