<script setup lang="ts">
import { usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { useSyncStore } from '../stores/sync'
import { useToday } from '../composables/useToday'
import { addDays, isoDate, mondayOf, weekLabel } from '../utils/week'

const plan = usePlanStore()
const recipes = useRecipesStore()
const sync = useSyncStore()
const toast = useToast()

// The two shapes are seven rows and seven columns. Everything else — which week
// is on screen, filling it, deriving the list, the night editor — is the same
// either way and stays here, so neither shape can grow an opinion the other
// does not have.
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
const nights = computed(() => plan.week(weekStart.value))
const today = useToday()

// Stays enabled after the last night comes off, because that is exactly when the
// list still holds ingredients nobody is going to cook.
const canDerive = computed(() => plan.hasWorkFor(weekStart.value))
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
  <div :class="isWide ? 'min-h-0' : 'min-h-dvh'">
    <!--
      Phone only. On a wide screen the app header above already carries the tab
      you are on, and the week strip lives inside the grid with the buttons that
      act on it — two stacked bars saying "Plan" was a header arguing with a nav.
    -->
    <AppPageHeader
      v-if="!isWide"
      title="Plan"
      content-class="max-w-xl"
    >
      <div class="flex items-center gap-1 lg:max-w-md">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          aria-label="Previous week"
          @click="weekOffset--"
        />
        <button
          type="button"
          class="flex-1 py-2 text-center text-sm font-medium active:bg-elevated/60"
          @click="weekOffset = 0"
        >
          {{ weekLabel(monday) }}
          <span
            v-if="weekOffset !== 0"
            class="ml-1 text-dimmed"
          >· this week</span>
        </button>
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          aria-label="Next week"
          @click="weekOffset++"
        />
      </div>
    </AppPageHeader>

    <!-- The wide shape is a screenful of its own and owns its margins. -->
    <PlanWeekWide
      v-if="isWide && sync.hydrated"
      :nights="nights"
      :today="today"
      :week-start="weekStart"
      :can-fill="canFill"
      :can-derive="canDerive"
      :filling="filling"
      :deriving="deriving"
      @open="openNight"
      @fill="fill"
      @derive="derive"
      @step="weekOffset += $event"
      @reset="weekOffset = 0"
    />

    <main
      v-else
      class="mx-auto max-w-xl px-3 pb-28"
    >
      <div
        v-if="!sync.hydrated"
        class="py-16 text-center text-sm text-muted"
      >
        Loading…
      </div>

      <template v-else>
        <!-- All seven nights always render: an empty one is the invitation. -->
        <ul class="mt-3 rounded-lg border border-default bg-elevated/30">
          <PlanNightRow
            v-for="night in nights"
            :key="night.date"
            :night="night"
            :today="night.date === today"
            @open="openNight(night.date)"
          />
        </ul>

        <!--
          Fill is above derive because it comes first in the week: suggest,
          adjust what you don't fancy, then shop. Stacked full-width, because
          they are the bottom of a column and a thumb is the pointer.
        -->
        <div class="mt-4 flex flex-col gap-3">
          <UButton
            v-if="canFill"
            class="justify-center"
            size="xl"
            color="neutral"
            variant="subtle"
            block
            icon="i-lucide-wand-sparkles"
            :loading="filling"
            @click="fill"
          >
            Fill the empty nights
          </UButton>

          <UButton
            class="justify-center"
            size="xl"
            block
            icon="i-lucide-shopping-cart"
            :disabled="!canDerive"
            :loading="deriving"
            @click="derive"
          >
            Add to shopping list
          </UButton>
        </div>

        <p
          v-if="!canDerive"
          class="mt-2 text-center text-sm text-dimmed"
        >
          Plan a night first, then this puts its ingredients on the list.
        </p>
      </template>
    </main>

    <PlanNightEditor
      v-model:open="editorOpen"
      :date="editingDate"
    />
  </div>
</template>
