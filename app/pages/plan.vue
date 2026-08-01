<script setup lang="ts">
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { useSyncStore } from '../stores/sync'
import { useToday } from '../composables/useToday'
import { addDays, isoDate, mondayOf, weekLabel } from '../utils/week'

const plan = usePlanStore()
const recipes = useRecipesStore()
const sync = useSyncStore()
const toast = useToast()

// The two shapes are a column of cards and a grid beside an aside. Everything
// else — which week is on screen, what is in it, filling it, deriving the list,
// the night editor — is the same either way and stays here, so neither shape can
// grow an opinion the other does not have.
const isWide = useWide()

// Week offset rather than a route param: deep-linking a week is not a real use
// case, and back should leave the page rather than walk backwards through weeks.
const weekOffset = ref(0)
const editingDate = ref<string | null>(null)
const editorOpen = ref(false)
const deriving = ref(false)
const filling = ref(false)

const monday = computed(() => addDays(mondayOf(new Date()), weekOffset.value * 7))
const weekStart = computed(() => isoDate(monday.value))
const today = useToday()

const { nights, strip, cards, target, suggestions, canDerive, deriveLabel, removeNight }
  = usePlanWeek(weekStart, today)

const canFill = computed(() => plan.hasGapsFor(weekStart.value) && recipes.recipes.length > 0)

async function fill() {
  if (filling.value) return
  filling.value = true
  try {
    const { filled, skipped } = await plan.fillWeek(weekStart.value)
    if (!filled) {
      toast.add({
        title: 'Nothing to suggest',
        description: 'Every recipe is either already on this week or ruled out by an allergy.',
        icon: 'i-lucide-info',
        color: 'neutral'
      })
      return
    }
    toast.add({
      title: `${filled} night${filled === 1 ? '' : 's'} planned`,
      description: skipped
        ? `${skipped} night${skipped === 1 ? '' : 's'} had nothing left to suggest.`
        : 'Change any of them, then add it to the list.',
      icon: 'i-lucide-wand-sparkles',
      color: 'success'
    })
  } finally {
    filling.value = false
  }
}

function openNight(date: string) {
  editingDate.value = date
  editorOpen.value = true
}

async function pick(recipeId: string) {
  if (!target.value) return
  const row = await plan.setNight(target.value, recipeId)
  if (!row) return
  toast.add({
    title: `${plan.plannedEntry(row).recipe?.name ?? 'Dinner'} planned`,
    icon: 'i-lucide-check',
    color: 'success'
  })
}

async function remove(night: PlannedNight) {
  await removeNight(night)
}

async function derive() {
  if (deriving.value) return
  deriving.value = true
  try {
    const { added, updated, removed } = await plan.deriveWeek(weekStart.value)
    if (added === 0 && updated === 0 && removed === 0) {
      toast.add({ title: 'Already on the list', icon: 'i-lucide-check', color: 'neutral' })
      return
    }
    const parts = [
      added && `${added} item${added === 1 ? '' : 's'} added`,
      updated && `${updated} updated`,
      removed && `${removed} removed`
    ].filter(Boolean)
    toast.add({ title: parts.join(', '), icon: 'i-lucide-shopping-cart', color: 'success' })
  } finally {
    deriving.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!--
      Phone only. On a wide screen the app header above already carries the tab
      you are on, and the week strip lives inside the grid with the buttons that
      act on it — two stacked bars saying "Plan" was a header arguing with a nav.
    -->
    <AppPageHeader
      v-if="!isWide"
      content-class="max-w-xl"
    >
      <template #title>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <h1 class="text-lg font-semibold">
            Plan
          </h1>
          <!-- The same badge the wide header carries, minus the word above it. -->
          <AppPlanBadge short />
        </div>
      </template>

      <template #actions>
        <!--
          An icon rather than the wide screen's labelled button: filling is the
          less common of the two actions and the bar is a phone's worth of width,
          so the one that has to be unmissable is the one along the bottom.
        -->
        <UButton
          v-if="canFill"
          icon="i-lucide-wand-sparkles"
          color="neutral"
          variant="ghost"
          aria-label="Fill empty nights"
          :loading="filling"
          @click="fill"
        />
      </template>

      <!-- The same field group the wide shape uses, stretched to the bar. -->
      <UFieldGroup class="flex w-full">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="outline"
          aria-label="Previous week"
          @click="weekOffset--"
        />
        <UButton
          color="neutral"
          variant="outline"
          class="flex-1 justify-center"
          @click="weekOffset = 0"
        >
          {{ weekLabel(monday) }}
          <span
            v-if="weekOffset !== 0"
            class="text-dimmed"
          >· this week</span>
        </UButton>
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="outline"
          aria-label="Next week"
          @click="weekOffset++"
        />
      </UFieldGroup>
    </AppPageHeader>

    <!-- The wide shape is a screenful of its own and owns its margins. -->
    <PlanWeekWide
      v-if="isWide && sync.hydrated"
      :nights="nights"
      :strip="strip"
      :cards="cards"
      :today="today"
      :week-start="weekStart"
      :suggestions="suggestions"
      :target="target"
      :can-fill="canFill"
      :can-derive="canDerive"
      :derive-label="deriveLabel"
      :filling="filling"
      :deriving="deriving"
      @open="openNight"
      @remove="remove"
      @pick="pick"
      @fill="fill"
      @derive="derive"
      @step="weekOffset += $event"
      @reset="weekOffset = 0"
    />

    <template v-else>
      <main class="mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto px-3 pb-4">
        <LoadingState v-if="!sync.hydrated" />

        <div
          v-else
          class="flex flex-col gap-3 pt-3"
        >
          <PlanEarlierStrip
            v-if="strip.length"
            :nights="strip"
            @open="openNight"
          />

          <USeparator v-if="strip.length" />

          <!--
            The nights still ahead, one card each and the whole column. The same
            card the wide screen uses, without the table along the bottom: seven
            copies of the same four faces down a phone is a roll-call nobody
            reads, so only a night somebody is missing says anything.
          -->
          <PlanNightCard
            v-for="night in cards"
            :key="night.date"
            :night="night"
            :today="night.date === today"
            :past="night.date < today"
            :table="false"
            class="min-h-36"
            @open="openNight(night.date)"
            @remove="remove(night)"
          />

          <USeparator />

          <PlanSuggestions
            :suggestions="suggestions"
            :nights="nights"
            :target="target"
            @pick="pick"
          />
        </div>
      </main>

      <!--
        The one thing a phone is holding this page open to do, parked above the
        tab bar where a thumb already is. Filling the week is a suggestion and
        lives in the header; putting the week on the list is the errand.
      -->
      <div
        v-if="sync.hydrated"
        class="shrink-0 border-t border-default bg-default/85 px-3 py-3 backdrop-blur"
      >
        <div class="mx-auto max-w-xl">
          <UButton
            color="primary"
            variant="subtle"
            size="xl"
            block
            icon="i-lucide-shopping-cart"
            :label="deriveLabel"
            :disabled="!canDerive"
            :loading="deriving"
            @click="derive"
          />
          <p
            v-if="!canDerive"
            class="mt-2 text-center text-xs text-dimmed"
          >
            Plan a night first, then this puts its ingredients on the list.
          </p>
        </div>
      </div>
    </template>

    <PlanNightEditor
      v-model:open="editorOpen"
      :date="editingDate"
    />
  </div>
</template>
