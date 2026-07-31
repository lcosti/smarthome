<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import { dishLabel, usePlanStore } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
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

async function setServings(delta: number) {
  if (!planned.value) return
  await plan.updateEntry(planned.value.entry.id, {
    servings: Math.max(1, planned.value.entry.servings + delta)
  })
}

function isHome(personId: string) {
  return date ? attendance.isPresent(personId, date) : true
}

async function toggleHome(personId: string) {
  if (!date) return
  await attendance.togglePresence(personId, date)
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
          <div class="mt-2 flex items-center gap-2">
            <UButton
              icon="i-lucide-minus"
              size="sm"
              color="neutral"
              variant="subtle"
              :disabled="planned.entry.servings <= 1"
              aria-label="Fewer servings"
              @click="setServings(-1)"
            />
            <span class="w-8 text-center tabular-nums">{{ planned.entry.servings }}</span>
            <UButton
              icon="i-lucide-plus"
              size="sm"
              color="neutral"
              variant="subtle"
              aria-label="More servings"
              @click="setServings(1)"
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
          <div class="mt-2 flex flex-wrap gap-2">
            <UButton
              v-for="person in people.people"
              :key="person.id"
              :color="isHome(person.id) ? 'primary' : 'neutral'"
              :variant="isHome(person.id) ? 'solid' : 'subtle'"
              size="lg"
              @click="toggleHome(person.id)"
            >
              {{ person.name }}
            </UButton>
          </div>
        </div>

        <div
          v-if="!recipes.recipes.length"
          class="py-8 text-center"
        >
          <p class="text-muted">
            No recipes yet.
          </p>
          <p class="mt-1 text-sm text-dimmed">
            The plan is built from your recipe library.
          </p>
          <UButton
            to="/recipes"
            class="mt-4"
            color="neutral"
            variant="subtle"
            @click="open = false"
          >
            Go to recipes
          </UButton>
        </div>

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
            <li
              v-if="!matches.length"
              class="px-3 py-6 text-center text-sm text-dimmed"
            >
              Nothing matches that.
            </li>
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
