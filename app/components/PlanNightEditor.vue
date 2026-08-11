<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import { dishLabel, usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { DINNER, MEAL_LABELS, mealFitRank, type Meal } from '../utils/meal'
import { pictureOf } from '../utils/photo'
import { adultsAmong, defaultCook } from '../utils/plan-cook'
import { SKIP_REASONS } from '../utils/skip'
import { dayLabel } from '../utils/week'

/**
 * One slot of one day, opened from wherever it was tapped.
 *
 * The same slideover for all three meals rather than a smaller one for
 * breakfast, on the principle that both shapes of the plan already share one
 * `PlanNightCard`: a lunch is a slot with a dish and a portion count and a
 * search box, which is what this is. Two of its blocks are dinner's alone and
 * say why below.
 */
const open = defineModel<boolean>('open', { required: true })
const { date, meal = DINNER } = defineProps<{ date: string | null, meal?: Meal }>()

const plan = usePlanStore()
const recipes = useRecipesStore()
const people = usePeopleStore()
const attendance = useAttendanceStore()

const search = ref('')

const first = computed(() => (date ? plan.entriesOn(date, meal)[0] ?? null : null))
const planned = computed(() => (first.value ? plan.plannedEntry(first.value) : null))
const plannedRecipe = computed(() => planned.value?.recipe ?? null)

/**
 * The earlier nights this one could be eating again.
 *
 * Offered above the recipe list rather than inside it, because "we're finishing
 * Sunday's chilli" is a different sentence from "we're cooking chilli" and the
 * shopping list treats them as opposites.
 *
 * Not offered at breakfast. Yesterday's roast for today's lunch is the case this
 * exists for; leftovers of it at seven in the morning is a block of permanent
 * noise at the top of a slot nobody would use it in.
 */
const leftoverSources = computed(() =>
  date && meal !== 'breakfast' ? plan.leftoverSourcesFor(date) : []
)

watch(open, (isOpen) => {
  if (isOpen) search.value = ''
})

/**
 * The library, with the ones that suit this meal at the top.
 *
 * Ordered and never filtered. Hiding a recipe from a slot would make labelling
 * one a thing you could regret — the roast you fancy for Saturday lunch is still
 * a roast — and it would leave nothing on screen to explain where it went.
 * Sinking it costs a labelled recipe nothing that typing three letters does not
 * get back.
 *
 * A library nobody has labelled sorts exactly as it did before: everything is
 * unlabelled, every rank is the same, and the alphabetical order the store hands
 * over survives untouched. That is deliberate — labelling has to be worth doing
 * to five recipes rather than compulsory across four hundred.
 *
 * `[...]` because the no-search branch is the store's own array by reference,
 * and sorting in place would quietly reorder the library for everything else
 * reading it.
 */
const matches = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const all = needle
    ? recipes.recipes.filter(r => r.name.toLowerCase().includes(needle))
    : [...recipes.recipes]
  return all.sort((a, b) =>
    mealFitRank(a, meal) - mealFitRank(b, meal) || a.name.localeCompare(b.name)
  )
})

/** Quantities are free text, so a different serving count is a hint, not maths. */
const showScalingNote = computed(() =>
  !!planned.value && !planned.value.leftover && !!plannedRecipe.value
  && planned.value.entry.servings !== plannedRecipe.value.base_servings
)

// One tap assigns and closes. Asking for a confirmation here would double the
// cost of the most common action on the page.
async function choose(recipeId: string) {
  if (!date) return
  await plan.setNight(date, recipeId, meal)
  open.value = false
}

async function chooseLeftovers(sourceEntryId: string) {
  if (!date) return
  await plan.setLeftovers(date, sourceEntryId, meal)
  open.value = false
}

async function chooseSkip(reason: string) {
  if (!date) return
  await plan.skipNight(date, reason)
  open.value = false
}

async function setServings(next: number) {
  if (!planned.value || !Number.isFinite(next)) return
  await plan.updateEntry(planned.value.entry.id, { servings: Math.max(1, next) })
}

/**
 * A night nobody has claimed is a null `cook_person_id`, but a select whose
 * value is null reads as nothing chosen. So the field carries '' and the
 * translation happens on the way in and out, as ChoreEditor's assignee select
 * already does.
 */
const NOBODY = ''

/** Adults only — cooking is not a job the picker hands a toddler. */
const cookCandidates = computed(() =>
  date ? adultsAmong(people.people, date) : []
)

const cookItems = computed(() => [
  { value: NOBODY, label: 'Not decided' },
  ...cookCandidates.value.map(person => ({ value: person.id, label: person.name }))
])

/**
 * What the select shows: an explicit choice, or the derived default — the sole
 * adult eating that day (see plan-cook.ts). Picking "Not decided" writes null,
 * which hands the night back to that rule rather than to nobody. Resolved
 * through the store so the id of somebody since removed falls through to the
 * default rather than showing a blank.
 */
const cookId = computed(() =>
  people.personById(planned.value?.entry.cook_person_id)?.id
  ?? (date ? defaultCook(attendance.presentOn(date), date)?.id : undefined)
  ?? NOBODY
)

async function setCook(next: string) {
  if (!planned.value) return
  await plan.updateEntry(planned.value.entry.id, { cook_person_id: next || null })
}

/**
 * The day's roll-call, whichever slot this editor was opened for.
 *
 * The surprising thing in this file, and deliberate: attendance is kept once per
 * day, against the dinner, and breakfast and lunch read the same answer. Somebody
 * out for lunch and home for dinner is a real household and not this one, and a
 * roster asked three times a night would cost more than it told anybody. Passing
 * `meal` here would also find nothing — the rows that exist are dinner rows —
 * and everybody would read as away.
 */
function isHome(personId: string) {
  return date ? attendance.isPresent(personId, date) : true
}

const peopleItems = computed(() =>
  people.people.map(person => ({ label: person.name, value: person.id }))
)

const whoIsHome = computed(() =>
  people.people.filter(person => isHome(person.id)).map(person => person.id)
)

/**
 * The group hands back the whole set, but attendance is stored a person at a
 * time, so only the one that actually changed is written. One tap stays one
 * mutation on the queue rather than one per person in the household.
 */
async function applyHome(next: (string | number)[]) {
  if (!date) return
  const selected = new Set(next.map(String))
  const changed = people.people.find(person => selected.has(person.id) !== isHome(person.id))
  if (changed) await attendance.togglePresence(changed.id, date)
}

async function clear() {
  if (!date) return
  await plan.clearNight(date, meal)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    :title="date ? `${dayLabel(date)} · ${MEAL_LABELS[meal]}` : MEAL_LABELS[meal]"
  >
    <template #body>
      <div class="space-y-4">
        <div
          v-if="planned"
          class="rounded-lg border border-default bg-elevated/30 p-3"
        >
          <p class="font-medium">
            {{ dishLabel(planned) }}
          </p>
          <!--
            A night nobody is cooking on has no portions to set: the stepper
            scales quantities, and there are none. What is worth saying is the
            thing somebody opening this would want to check.
          -->
          <p
            v-if="planned.skipped"
            class="mt-2 text-sm text-dimmed"
          >
            Nothing to cook and nothing to buy — pick a recipe below to plan a dinner instead.
          </p>
          <div
            v-else
            class="mt-2 flex items-center gap-2"
          >
            <UInputNumber
              :model-value="planned.entry.servings"
              :min="1"
              size="sm"
              class="w-28"
              aria-label="Servings"
              @update:model-value="setServings"
            />
            <span class="text-sm text-dimmed">servings</span>
          </div>
          <p
            v-if="showScalingNote"
            class="mt-2 text-sm text-dimmed"
          >
            Quantities aren’t scaled — the list shows a ×{{ Math.round((planned.entry.servings / (plannedRecipe?.base_servings ?? 1)) * 10) / 10 }} hint.
          </p>
          <!--
            The stepper on a leftovers night spends somebody else's shopping, and
            saying so is cheaper than letting them find out from the list.
          -->
          <p
            v-else-if="planned.leftover"
            class="mt-2 text-sm text-dimmed"
          >
            Nothing extra to buy — these portions are shopped for with
            {{ planned.leftoverSource ? dayLabel(planned.leftoverSource.entry.date) : 'the night it was cooked' }}.
          </p>
          <!--
            Not asked on a skipped or leftovers night — reheating isn't cooking,
            and the board already says "reheat" — nor when the household has one
            adult, where the roster below is hidden for the same reason: there
            is only one possible answer, and the default rule already gives it.
          -->
          <UFormField
            v-if="!planned.skipped && !planned.leftover && cookCandidates.length > 1"
            label="Who's cooking"
            class="mt-3"
          >
            <USelectMenu
              :model-value="cookId"
              :items="cookItems"
              value-key="value"
              size="lg"
              class="w-full"
              @update:model-value="setCook"
            />
          </UFormField>
        </div>

        <!--
          Offered before the recipe list, because on a night that follows a big
          batch this is the likelier answer and it is one tap either way.
        -->
        <div
          v-if="leftoverSources.length"
          class="rounded-lg border border-default p-3"
        >
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Leftovers
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <UButton
              v-for="source in leftoverSources"
              :key="source.entry.id"
              :color="planned?.leftoverSource?.entry.id === source.entry.id ? 'primary' : 'neutral'"
              :variant="planned?.leftoverSource?.entry.id === source.entry.id ? 'solid' : 'subtle'"
              size="lg"
              icon="i-lucide-refrigerator"
              @click="chooseLeftovers(source.entry.id)"
            >
              {{ dayLabel(source.entry.date) }}’s {{ source.recipe?.name ?? 'dinner' }}
            </UButton>
          </div>
        </div>

        <!--
          Not cooking is an answer to "what's for dinner", so it sits with the
          other answers rather than under the recipe list — a night getting a
          takeaway is decided before anybody scrolls a library they are not going
          to cook from.

          Dinner's alone. A skip is a decision the rest of the app reads — the
          board says so, the generator stops offering, the week's fraction counts
          the night as dealt with — and none of that exists for a breakfast,
          where an empty slot is the ordinary case rather than a gap.
        -->
        <div
          v-if="meal === 'dinner'"
          class="rounded-lg border border-default p-3"
        >
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Not cooking
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <UButton
              v-for="reason in SKIP_REASONS"
              :key="reason.value"
              :color="planned?.entry.skip_reason === reason.value ? 'primary' : 'neutral'"
              :variant="planned?.entry.skip_reason === reason.value ? 'solid' : 'subtle'"
              size="lg"
              :icon="reason.icon"
              :label="reason.label"
              @click="chooseSkip(reason.value)"
            />
          </div>
        </div>

        <!--
          Who is eating is a fact about the night, so it belongs on the night, not
          on a page somebody would have to remember to visit.
        -->
        <div
          v-if="people.people.length > 1"
          class="rounded-lg border border-default p-3"
        >
          <p class="text-xs font-medium uppercase tracking-wide text-dimmed">
            Who's home
          </p>
          <!--
            Checkboxes, because this is several independent yes/nos rather than
            one choice: any number of people can be home, including none.
          -->
          <UCheckboxGroup
            :model-value="whoIsHome"
            :items="peopleItems"
            variant="card"
            orientation="horizontal"
            class="mt-2"
            :ui="{ fieldset: 'flex-wrap gap-2', item: 'flex-1 basis-36' }"
            @update:model-value="applyHome"
          />
        </div>

        <UEmpty
          v-if="!recipes.recipes.length"
          icon="i-lucide-chef-hat"
          title="No recipes yet."
          description="The plan is built from your recipe library."
          :actions="[{
            label: 'Go to recipes',
            to: '/recipes',
            color: 'neutral',
            variant: 'subtle',
            onClick: () => { open = false }
          }]"
        />

        <template v-else>
          <UInput
            v-model="search"
            size="xl"
            class="w-full"
            icon="i-lucide-search"
            :placeholder="planned ? 'Swap for…' : 'Search recipes'"
            autocapitalize="sentences"
          />

          <ul class="max-h-[45dvh] overflow-y-auto rounded-lg border border-default bg-elevated/30">
            <RecipeRow
              v-for="item in matches"
              :key="item.id"
              :name="item.name"
              :ingredient-count="recipes.ingredientsFor(item.id).length"
              :servings="item.base_servings"
              :image-url="pictureOf(item)"
              @select="choose(item.id)"
            />
            <UEmpty
              v-if="!matches.length"
              as="li"
              icon="i-lucide-search-x"
              title="Nothing matches that."
            />
          </ul>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full gap-2">
        <UButton
          v-if="planned"
          icon="i-lucide-trash-2"
          color="error"
          variant="subtle"
          @click="clear"
        >
          Remove
        </UButton>
        <div class="flex-1" />
        <UButton
          color="neutral"
          variant="ghost"
          @click="open = false"
        >
          Done
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
