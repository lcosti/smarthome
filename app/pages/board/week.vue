<script setup lang="ts">
import { useAttendanceStore } from '../../stores/attendance'
import { usePeopleStore } from '../../stores/people'
import { usePlanStore } from '../../stores/plan'
import { useRecipesStore } from '../../stores/recipes'
import { initialOf, personHue } from '../../utils/person-colors'
import { isoDate } from '../../utils/week'

/**
 * The week, and the ability to change it from the wall.
 *
 * Seven nights across, because a week is the unit the household actually thinks
 * in and a column per night is the only layout where "what are we doing Thursday"
 * is answered without reading.
 *
 * Tapping a night opens the library in place rather than a dialog over the top:
 * a modal on a wall display is a thing somebody has to know to dismiss, and a
 * board left in a state nobody can get out of is worse than one that cannot be
 * edited at all.
 */

const plan = usePlanStore()
const recipes = useRecipesStore()
const people = usePeopleStore()
const attendance = useAttendanceStore()

const now = useBoardClock()

/**
 * Seven nights from tonight, not Monday to Sunday.
 *
 * The phone plans calendar weeks, because that is how a shop is planned. A wall
 * on a Friday showing four Mondays-ago nights offering "Add dinner" is offering
 * to cook something that has already not happened — the board only ever looks
 * forward. `week()` takes any start date and returns the seven days from it.
 */
const today = computed(() => isoDate(now.value))
const nights = computed(() => plan.week(today.value))

/** The night being planned, or null when the week itself is on screen. */
const choosing = ref<string | null>(null)

const generating = ref(false)

async function generate() {
  if (generating.value) return
  generating.value = true
  try {
    await plan.fillWeek(today.value)
  } finally {
    generating.value = false
  }
}

async function choose(recipeId: string) {
  const date = choosing.value
  if (!date) return
  choosing.value = null
  await plan.setNight(date, recipeId)
}

async function clearNight(date: string) {
  choosing.value = null
  await plan.clearNight(date)
}

function diners(date: string) {
  return attendance.presentOn(date)
}

function dayLabelOf(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { weekday: 'short' })
}

function dateLabelOf(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * A recipe's one-line meta for the picker.
 *
 * A recipe imported from a photo or typed in as a bare name has no timings, and
 * the old string rendered that as "— min · serves 2". Say nothing about the time
 * rather than saying an em-dash of it.
 */
function describe(recipe: { prep_minutes: number | null, cook_minutes: number | null, base_servings: number }) {
  const minutes = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)
  const serves = `serves ${recipe.base_servings}`
  return minutes ? `${minutes} min · ${serves}` : serves
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-[12px]">
    <!-- Choosing a recipe for one night -->
    <template v-if="choosing">
      <div class="flex shrink-0 items-center justify-between">
        <div>
          <p class="font-mono text-[14px] uppercase tracking-[0.14em] text-muted">
            {{ dayLabelOf(choosing) }} {{ dateLabelOf(choosing) }}
          </p>
          <h2 class="text-[32px] font-semibold tracking-[-0.025em] text-highlighted">
            What are we having?
          </h2>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-if="plan.entriesOn(choosing).length"
            color="neutral"
            variant="subtle"
            size="xl"
            label="Clear the night"
            class="h-[48px] rounded-lg px-5 text-[16px]"
            @click="clearNight(choosing)"
          />
          <UButton
            color="neutral"
            variant="subtle"
            size="xl"
            label="Back to the week"
            class="h-[48px] rounded-lg px-5 text-[16px]"
            @click="choosing = null"
          />
        </div>
      </div>

      <UPageGrid
        v-if="recipes.recipes.length"
        class="min-h-0 flex-1 content-start gap-[12px] overflow-hidden lg:grid-cols-4"
      >
        <UPageCard
          v-for="recipe in recipes.recipes"
          :key="recipe.id"
          :title="recipe.name"
          :description="describe(recipe)"
          variant="outline"
          :ui="{
            root: 'rounded-lg bg-elevated px-4 py-3.5 transition-opacity duration-[80ms] active:opacity-85',
            title: 'line-clamp-2 text-[19px] font-medium text-default',
            description: 'font-mono text-[13px] text-dimmed'
          }"
          @click="choose(recipe.id)"
        />
      </UPageGrid>

      <UEmpty
        v-else
        icon="i-lucide-book-open"
        title="No recipes yet"
        description="Add a few from your phone and they show up here."
        class="flex-1"
        :ui="{
          avatar: 'size-9 bg-transparent text-dimmed',
          title: 'text-[32px] font-semibold text-muted',
          description: 'text-[17px] text-muted'
        }"
      />
    </template>

    <!-- The week itself -->
    <template v-else>
      <div class="flex shrink-0 items-center justify-between">
        <h2 class="text-[27px] font-semibold tracking-[-0.025em] text-highlighted">
          The week ahead
        </h2>
        <UButton
          v-if="plan.hasGapsFor(today)"
          color="primary"
          variant="solid"
          :label="generating ? 'Generating…' : 'Fill the empty nights'"
          class="h-[48px] rounded-lg px-5 text-[16px] font-semibold"
          @click="generate"
        />
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-7 gap-[9px] overflow-hidden">
        <UCard
          v-for="night in nights"
          :key="night.date"
          as="button"
          variant="outline"
          :ui="{
            root: night.date === today
              ? 'flex min-h-0 flex-col rounded-lg bg-primary/10 ring-primary/50 text-left transition-opacity duration-[80ms] active:opacity-85'
              : 'flex min-h-0 flex-col rounded-lg bg-elevated text-left transition-opacity duration-[80ms] active:opacity-85',
            body: 'flex min-h-0 flex-1 flex-col gap-2 px-3.5 py-2.5 sm:p-0 sm:px-3.5 sm:py-2.5'
          }"
          @click="choosing = night.date"
        >
          <span class="shrink-0">
            <span
              class="block font-mono text-[13px] uppercase tracking-[0.08em]"
              :class="night.date === today ? 'text-primary' : 'text-dimmed'"
            >{{ dayLabelOf(night.date) }}</span>
            <span class="block font-mono text-[11px] text-dimmed">{{ dateLabelOf(night.date) }}</span>
          </span>

          <span
            v-if="night.entries.length"
            class="min-w-0 flex-1"
          >
            <span class="line-clamp-3 text-[17px] font-medium text-highlighted">
              {{ night.entries[0]!.recipe?.name ?? 'Recipe deleted' }}
            </span>
            <span class="mt-0.5 block font-mono text-[12px] text-dimmed">
              {{ night.entries[0]!.entry.servings }} servings
            </span>
          </span>

          <!-- An empty night is an invitation, not a gap. -->
          <span
            v-else
            class="flex flex-1 items-start gap-1.5 text-dimmed"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-4 shrink-0"
            />
            <span class="text-[15px]">Add dinner</span>
          </span>

          <!--
            Overlapped rather than laid out in a row: on a narrow column a
            household of five wraps to two lines and pushes the dish out of the
            card, and who is eating is a glance rather than a roll-call.
          -->
          <UAvatarGroup
            :max="5"
            class="shrink-0"
            :ui="{ base: 'ring-0' }"
          >
            <BoardAvatar
              v-for="person in diners(night.date)"
              :key="person.id"
              :initial="initialOf(person.name)"
              :hue="personHue(person.id, people.people)"
              :size="34"
            />
          </UAvatarGroup>
        </UCard>
      </div>
    </template>
  </div>
</template>
