<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import { dishLabel, usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import { SKIP_REASONS } from '../utils/skip'
import { dayLabel } from '../utils/week'

const open = defineModel<boolean>('open', { required: true })
const { date } = defineProps<{ date: string | null }>()

const plan = usePlanStore()
const recipes = useRecipesStore()
const people = usePeopleStore()
const attendance = useAttendanceStore()

const search = ref('')

const first = computed(() => (date ? plan.entriesOn(date)[0] ?? null : null))
const planned = computed(() => (first.value ? plan.plannedEntry(first.value) : null))
const plannedRecipe = computed(() => planned.value?.recipe ?? null)

/**
 * The earlier nights this one could be eating again.
 *
 * Offered above the recipe list rather than inside it, because "we're finishing
 * Sunday's chilli" is a different sentence from "we're cooking chilli" and the
 * shopping list treats them as opposites.
 */
const leftoverSources = computed(() => (date ? plan.leftoverSourcesFor(date) : []))

watch(open, (isOpen) => {
  if (isOpen) search.value = ''
})

const matches = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const all = recipes.recipes
  return needle ? all.filter(r => r.name.toLowerCase().includes(needle)) : all
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
  await plan.setNight(date, recipeId)
  open.value = false
}

async function chooseLeftovers(sourceEntryId: string) {
  if (!date) return
  await plan.setLeftovers(date, sourceEntryId)
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
  await plan.clearNight(date)
  open.value = false
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="bottom"
    :title="date ? dayLabel(date) : 'Dinner'"
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
        -->
        <div class="rounded-lg border border-default p-3">
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
