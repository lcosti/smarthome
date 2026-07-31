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
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-[18px]">
    <!-- Choosing a recipe for one night -->
    <template v-if="choosing">
      <div class="flex shrink-0 items-center justify-between">
        <div>
          <p class="font-mono text-[21px] uppercase tracking-[0.14em] text-muted">
            {{ dayLabelOf(choosing) }} {{ dateLabelOf(choosing) }}
          </p>
          <h2 class="text-[48px] font-semibold tracking-[-0.025em] text-highlighted">
            What are we having?
          </h2>
        </div>
        <div class="flex items-center gap-3">
          <UButton
            v-if="plan.entriesOn(choosing).length"
            color="neutral"
            variant="subtle"
            size="xl"
            label="Clear the night"
            class="h-[72px] rounded-[14px] px-8 text-[24px]"
            @click="clearNight(choosing)"
          />
          <UButton
            color="neutral"
            variant="subtle"
            size="xl"
            label="Back to the week"
            class="h-[72px] rounded-[14px] px-8 text-[24px]"
            @click="choosing = null"
          />
        </div>
      </div>

      <div
        v-if="recipes.recipes.length"
        class="grid min-h-0 flex-1 grid-cols-4 content-start gap-[18px] overflow-hidden"
      >
        <button
          v-for="recipe in recipes.recipes"
          :key="recipe.id"
          type="button"
          class="flex flex-col gap-2 rounded-[14px] border border-default bg-default px-6 py-5
                 text-left transition-opacity duration-[80ms] active:opacity-85"
          @click="choose(recipe.id)"
        >
          <span class="line-clamp-2 text-[28px] font-medium text-default">{{ recipe.name }}</span>
          <span class="font-mono text-[19px] text-dimmed">
            {{ (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0) || '—' }} min ·
            serves {{ recipe.base_servings }}
          </span>
        </button>
      </div>

      <div
        v-else
        class="flex flex-1 flex-col items-center justify-center gap-4"
      >
        <p class="text-[48px] font-semibold text-muted">
          No recipes yet
        </p>
        <p class="text-[26px] text-muted">
          Add a few from your phone and they show up here.
        </p>
      </div>
    </template>

    <!-- The week itself -->
    <template v-else>
      <div class="flex shrink-0 items-center justify-between">
        <h2 class="text-[40px] font-semibold tracking-[-0.025em] text-highlighted">
          The week ahead
        </h2>
        <UButton
          v-if="plan.hasGapsFor(today)"
          color="warning"
          variant="solid"
          :label="generating ? 'Generating…' : 'Fill the empty nights'"
          class="h-[72px] rounded-[14px] px-8 text-[24px] font-semibold"
          @click="generate"
        />
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-7 gap-[14px] overflow-hidden">
        <button
          v-for="night in nights"
          :key="night.date"
          type="button"
          class="flex min-h-0 flex-col gap-3 rounded-[14px] border px-5 py-4 text-left
                 transition-opacity duration-[80ms] active:opacity-85"
          :class="night.date === today
            ? 'border-warning/50 bg-warning/10'
            : 'border-default bg-default'"
          @click="choosing = night.date"
        >
          <span class="shrink-0">
            <span
              class="block font-mono text-[20px] uppercase tracking-[0.08em]"
              :class="night.date === today ? 'text-warning' : 'text-dimmed'"
            >{{ dayLabelOf(night.date) }}</span>
            <span class="block font-mono text-[17px] text-dimmed">{{ dateLabelOf(night.date) }}</span>
          </span>

          <span
            v-if="night.entries.length"
            class="min-w-0 flex-1"
          >
            <span class="line-clamp-3 text-[26px] font-medium text-highlighted">
              {{ night.entries[0]!.recipe?.name ?? 'Recipe deleted' }}
            </span>
            <span class="mt-1 block font-mono text-[18px] text-dimmed">
              {{ night.entries[0]!.entry.servings }} servings
            </span>
          </span>

          <!-- An empty night is an invitation, not a gap. -->
          <span
            v-else
            class="flex flex-1 items-start gap-2 text-dimmed"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-6 shrink-0"
            />
            <span class="text-[22px]">Add dinner</span>
          </span>

          <span class="flex shrink-0 flex-wrap gap-1.5">
            <BoardAvatar
              v-for="person in diners(night.date)"
              :key="person.id"
              :initial="initialOf(person.name)"
              :hue="personHue(person.id, people.people)"
              :size="34"
            />
          </span>
        </button>
      </div>
    </template>
  </div>
</template>
