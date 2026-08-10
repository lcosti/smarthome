<script setup lang="ts">
import { useChoresStore } from '../stores/chores'
import { useListStore } from '../stores/list'
import { usePeopleStore } from '../stores/people'
import { useSyncStore } from '../stores/sync'
import { relativeTime } from '../utils/board'
import { choreScheduleLabel } from '../utils/chores'
import type { AisleRow, ChoreRow } from '../utils/db'

const store = useListStore()
const sync = useSyncStore()
const chores = useChoresStore()
const people = usePeopleStore()
const supabase = useSupabaseClient()
const signOut = useSignOut()
const toast = useToast()

const alwaysOn = useAlwaysOn()

const household = ref<{ name: string, invite_code: string } | null>(null)
const newAisle = ref('')
const confirmAisle = ref<string | null>(null)
const confirmSignOut = ref(false)
const drafts = ref(new Map<string, string>())
const editingChore = ref<string | null>(null)
const choreEditorOpen = ref(false)

/** "Tue, Fri · Maya · 19:00" — when it happens, whose it is, and at what time. */
function choreMeta(chore: ChoreRow): string {
  const when = choreScheduleLabel(chore)
  const whose = chore.person_id
    ? people.personById(chore.person_id)?.name ?? null
    : 'Everyone'
  return [when, whose, chore.at_time].filter(Boolean).join(' · ')
}

function editChore(id: string | null) {
  editingChore.value = id
  choreEditorOpen.value = true
}

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

/**
 * What the calendar is actually doing.
 *
 * This used to be `rows.length > 0`, which made "nobody has set this up" and "the
 * service account was never shared onto the calendar" the same sentence on screen.
 * They are not the same problem and only one of them is anybody's fault, so the
 * sync function now records what it did and this reads that record. The event
 * count is still shown, because when it is working that is the useful number.
 */
const calendar = computed(() => {
  const events = [...sync.rowsOf('calendar_events').values()].filter(row => !row.deleted_at)
  const status = [...sync.rowsOf('calendar_sync_status').values()][0] ?? null
  const ago = status ? relativeTime(status.ran_at, new Date()) : null
  if (status?.outcome === 'error') {
    return {
      tone: 'error' as const,
      title: 'Calendar sync is failing',
      // The server's own words. Whoever reads this is the person who can go and
      // fix it, and a code would only send them back here to look it up.
      detail: status.detail ?? 'The last sync run failed and did not say why.',
      ago
    }
  }
  if (status?.outcome === 'skipped' || !status) {
    return {
      tone: 'idle' as const,
      title: 'No calendar connected',
      detail: status?.detail
        ?? 'Set up on the server, not here: the sync function holds the account and '
        + 'the list of calendars. Nothing has arrived yet.',
      ago
    }
  }
  return {
    tone: 'ok' as const,
    title: `${events.length} events cached`,
    detail: 'Google Calendar, synced every few minutes and cached on this device so '
      + 'the board still shows today with the wifi down.',
    ago
  }
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
      back-label="Back to today"
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
            <ConfirmModal
              :open="confirmAisle === aisle.id"
              :title="`Delete ${aisle.name}?`"
              description="Items in it move to Other. The aisle order is what the list is walked in, so this changes every future shop."
              @update:open="confirmAisle = $event ? aisle.id : null"
              @confirm="store.deleteAisle(aisle.id)"
            >
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="`Delete ${aisle.name}`"
              />
            </ConfirmModal>
          </li>
        </ul>

        <UForm
          :state="{ newAisle }"
          class="flex gap-2"
          @submit="addAisle"
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
        </UForm>
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

      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Chores
        </h2>
        <p class="text-sm text-muted">
          These sit in Today's schedule alongside the calendar, and anyone can
          tick them off there. A day without one shows nothing.
        </p>

        <ul
          v-if="chores.chores.length"
          class="divide-y divide-default rounded-lg border border-default"
        >
          <li
            v-for="chore in chores.chores"
            :key="chore.id"
          >
            <UButton
              color="neutral"
              variant="ghost"
              size="lg"
              block
              :ui="{ base: 'justify-between rounded-none' }"
              trailing-icon="i-lucide-chevron-right"
              @click="editChore(chore.id)"
            >
              <span class="flex min-w-0 flex-col items-start gap-0.5">
                <span class="truncate">{{ chore.name }}</span>
                <span class="truncate text-xs font-normal text-dimmed">{{ choreMeta(chore) }}</span>
              </span>
            </UButton>
          </li>
        </ul>

        <UButton
          color="neutral"
          variant="subtle"
          size="lg"
          block
          icon="i-lucide-plus"
          label="Add a chore"
          @click="editChore(null)"
        />

        <ChoreEditor
          v-model:open="choreEditorOpen"
          :chore-id="editingChore"
        />
      </section>

      <!--
        Read-only, and it says so. There is no per-user OAuth here — the
        sync-calendar Edge Function holds a service account and a list of
        calendar ids — so the honest thing this screen can do is report what
        the server did rather than offer a button that connects nothing. It
        exists because the board's "Connect a calendar" has to land somewhere
        true.

        Reporting what *arrived* was not enough: an empty table is the symptom of
        a household that never connected a calendar and of one whose sync has
        been failing for a month, and only the second needs anybody to do
        something. So the failing case is a UAlert rather than the same grey box
        — it is the one state here that is asking for action.
      -->
      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Calendar
        </h2>
        <UAlert
          v-if="calendar.tone === 'error'"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="calendar.title"
          :description="calendar.detail"
        />
        <div
          v-else
          class="space-y-1 rounded-lg border border-default p-3"
        >
          <p class="text-sm">
            {{ calendar.title }}
          </p>
          <p class="text-sm text-muted">
            {{ calendar.detail }}
          </p>
        </div>
        <p
          v-if="calendar.ago"
          class="text-xs text-dimmed"
        >
          Last checked {{ calendar.ago }}
        </p>
      </section>

      <section class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-dimmed">
          Always-on display
        </h2>
        <div class="rounded-lg border border-default p-3">
          <USwitch
            v-model="alwaysOn"
            label="This screen never sleeps"
            description="For a tablet left on in the kitchen. Everything drifts a pixel at a time so the layout never burns into the panel — slowly enough that nobody sees it move. Press F for fullscreen."
          />
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
            <!--
              `data-invite-code` is a handle for the acceptance scripts, as
              `data-shopping-aisle` is on the list. The code used to be a
              `<code>` element they could find on its own; as a badge it is a
              six-character span on a page that also says AISLES and PEOPLE.
            -->
            <UBadge
              data-invite-code
              color="neutral"
              variant="subtle"
              size="xl"
              :label="household.invite_code"
              class="font-mono text-lg tracking-widest"
            />
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
        <!--
          The only confirmation that is about the queue rather than the data:
          signing out with changes still waiting throws them away, and the count
          above is the thing worth reading before agreeing.
        -->
        <ConfirmModal
          v-model:open="confirmSignOut"
          title="Sign out?"
          :description="sync.pendingCount
            ? `${sync.pendingCount} change${sync.pendingCount === 1 ? '' : 's'} have not reached the server yet and will be lost.`
            : 'Everything is synced. You will need the sign-in link again on this device.'"
          confirm-label="Sign out"
          :color="sync.pendingCount ? 'error' : 'primary'"
          @confirm="signOut()"
        >
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-lucide-log-out"
            label="Sign out"
          />
        </ConfirmModal>
      </section>
    </main>
  </div>
</template>
