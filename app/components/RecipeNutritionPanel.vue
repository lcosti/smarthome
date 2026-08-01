<script setup lang="ts">
import type { RecipeRow } from '../utils/db'
import { nutritionView, REFERENCE_KCAL, type NutritionKey, type NutritionScope } from '../utils/nutrition'

/**
 * A recipe's nutrition, as something to read rather than edit.
 *
 * The library pane's job is comparison — you are deciding between five meals,
 * and "how heavy is this one" is part of that. So this leads with the kcal at a
 * size you can take in without reading, and puts the macro split under it as a
 * shape rather than three more numbers to compare in your head.
 *
 * Read-only on purpose. Correcting a figure is a typing job and lives on the
 * recipe's own page, like every other edit the library pane declines to offer.
 *
 * Renders nothing at all when the recipe has no figures, which is most of a new
 * library: an empty panel offering eight dashes is worse than the ingredients
 * simply starting where the panel would have been.
 */

const { recipe } = defineProps<{ recipe: Pick<RecipeRow, NutritionKey | 'base_servings'> }>()

const scope = ref<NutritionScope>('serving')

const SCOPES = [
  { label: 'Per serving', value: 'serving' },
  { label: 'Whole recipe', value: 'whole' }
]

const view = computed(() => nutritionView(recipe, scope.value))

/**
 * Against the label's reference intake, not against anybody's target. The app
 * models no daily budget and adds nothing up across a day — this is the same
 * arithmetic printed on the back of a packet, for one serving.
 */
const referencePercent = computed(() =>
  view.value.kcal === null ? null : Math.round((view.value.kcal / REFERENCE_KCAL) * 100)
)

/** The three that are read as figures rather than as a proportion. */
const secondary = computed(() => [
  { label: 'Fibre', value: view.value.fibre === null ? '—' : `${view.value.fibre}g` },
  { label: 'Salt', value: view.value.salt === null ? '—' : `${view.value.salt}g` },
  { label: 'Of daily kcal', value: referencePercent.value === null ? '—' : `${referencePercent.value}%` }
])
</script>

<template>
  <div v-if="view.hasData">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-xs font-medium uppercase tracking-wide text-dimmed">
        Nutrition
      </h3>
      <!-- Two mutually exclusive readings of one set of figures, so a tab set
           rather than a pair of buttons. No panels: the card below is the panel. -->
      <UTabs
        v-model="scope"
        :items="SCOPES"
        :content="false"
        size="xs"
        :ui="{ list: 'rounded-lg' }"
        aria-label="Nutrition scope"
      />
    </div>

    <div class="mt-3 rounded-lg border border-default bg-default/40 px-4 py-3.5">
      <div class="flex items-baseline justify-between gap-3">
        <p class="flex items-baseline gap-1.5">
          <span class="text-3xl font-semibold leading-none tracking-[-0.02em] text-highlighted">
            {{ view.kcal ?? '—' }}
          </span>
          <span class="text-sm text-muted">kcal</span>
        </p>
        <p class="font-mono text-xs text-dimmed">
          {{ view.scopeLabel }}
        </p>
      </div>

      <!--
        The macro split as one bar rather than three numbers.

        A custom element in place of UProgress, which draws one value against a
        track: this is three series summing to a whole, and there is no stock
        component for a stacked bar. Widths are runtime percentages, so they
        cannot be Tailwind classes either.
      -->
      <div
        v-if="view.hasSplit"
        class="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full"
      >
        <div
          v-for="macro in view.macros"
          :key="macro.key"
          class="h-full first:rounded-l-full last:rounded-r-full"
          :class="macro.bar"
          :style="{ width: `${macro.percent}%` }"
        />
      </div>

      <dl class="mt-3.5 grid grid-cols-3 gap-3">
        <div
          v-for="macro in view.macros"
          :key="macro.key"
        >
          <dt class="flex items-center gap-1.5 text-sm text-muted">
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="macro.dot"
            />
            {{ macro.label }}
          </dt>
          <dd class="mt-0.5 text-base text-default">
            {{ macro.grams === null ? '—' : `${macro.grams}g` }}
          </dd>
        </div>
      </dl>

      <USeparator class="my-3" />

      <dl class="grid grid-cols-3 gap-3">
        <div
          v-for="rest in secondary"
          :key="rest.label"
        >
          <dt class="text-sm text-muted">
            {{ rest.label }}
          </dt>
          <dd class="mt-0.5 text-base text-default">
            {{ rest.value }}
          </dd>
        </div>
      </dl>
    </div>

    <p class="mt-2 text-xs leading-relaxed text-dimmed">
      As the source states it, or estimated where it did not — not a substitute
      for label values.
    </p>
  </div>
</template>
