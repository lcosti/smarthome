<script setup lang="ts">
import { useListStore } from '../stores/list'
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { reviewByAisle, reviewByMeal, type ReviewSection } from '../utils/review'

/**
 * The last step of planning a week on a phone: everything the week's dinners
 * need, read over once before any of it goes on the shopping list.
 *
 * This is the moment the cupboard gets its say. Standing in the kitchen with the
 * week in front of you, "we already have rice" is one press; finding the same
 * line in an aisle three days later is a wasted bag of rice. So every line is
 * ticked by default and unticking one is the whole interaction.
 *
 * What that writes is not "nothing" — it is the row, soft-deleted. That is the
 * shape a person deleting an item off the list already leaves behind, and
 * `derive` has always refused to resurrect one, so the decision survives filling
 * the week again, the other phone deriving it, and next Tuesday.
 *
 * By aisle or by meal, and the tick state is keyed by row rather than by line,
 * so changing your mind about the arrangement never loses an answer.
 */
const { nights, weekStart, weekLabel } = defineProps<{
  nights: PlannedNight[]
  weekStart: string
  weekLabel: string
}>()

const emit = defineEmits<{ back: [] }>()

const plan = usePlanStore()
const list = useListStore()
const toast = useToast()

const grouping = ref<'aisle' | 'meal'>('aisle')
const committing = ref(false)
const failed = ref(false)

const groupingItems = [
  { label: 'By aisle', value: 'aisle' },
  { label: 'By meal', value: 'meal' }
]

const rows = computed(() => plan.reviewWeek(weekStart))

/**
 * Everything but what is already in the trolley.
 *
 * A row somebody is holding in a shop is not a decision anybody is being offered
 * again, and listing it among the things to choose would invite them to change
 * an answer this screen has no business changing.
 */
const items = computed(() => rows.value.filter(row => !row.frozen).map(row => row.row))

/**
 * The aisle read is the canonical one: it is where the totals are added up and
 * where the cupboard is subtracted, so grouping by meal cannot make the week
 * appear to need more or less than it does.
 */
const byAisle = computed(() => reviewByAisle(items.value, list.aggregateContext, list.sortedAisles))

const stapleIds = computed(() => new Set(byAisle.value.staples.map(row => row.id)))

const sections = computed<ReviewSection[]>(() =>
  grouping.value === 'aisle'
    ? byAisle.value.sections
    : reviewByMeal(items.value, plan.nightOf, {
        covered: byAisle.value.covered,
        staples: stapleIds.value
      })
)

/**
 * The rows that have been unticked.
 *
 * A plain reactive set rather than a model on the group, because one line can
 * stand for several rows and the same row appears under a different line when
 * the arrangement changes. The row is the thing that gets written, so the row is
 * what the answer is stored against.
 */
const excluded = reactive(new Set<string>())

/**
 * Seeded once per row, never re-seeded: what the cupboard covers starts
 * unticked, and so does anything somebody took off the last time they did this.
 * After that the answer is theirs and nothing here overrules it.
 */
const seeded = new Set<string>()
watchEffect(() => {
  const covered = byAisle.value.covered
  for (const row of rows.value) {
    const id = row.row.id
    if (seeded.has(id)) continue
    seeded.add(id)
    if (row.excluded || covered.has(id)) excluded.add(id)
  }
})

/** Every row on offer, which is what the counts along the bottom are counted over. */
const offered = computed(() =>
  byAisle.value.sections.flatMap(section => section.lines.flatMap(line => line.items.map(item => item.id)))
)

const selectedCount = computed(() => offered.value.filter(id => !excluded.has(id)).length)
const skippedCount = computed(() => offered.value.filter(id => excluded.has(id)).length)

/** What the week assumes it does not have to buy: the cupboard, and the staples. */
const alreadyIn = computed(() => byAisle.value.covered.size + byAisle.value.staples.length)

/** A line is on if any row behind it is; toggling it moves all of them together. */
function isOn(itemIds: string[]): boolean {
  return itemIds.some(id => !excluded.has(id))
}

function toggle(itemIds: string[]) {
  const off = isOn(itemIds)
  for (const id of itemIds) {
    if (off) excluded.add(id)
    else excluded.delete(id)
  }
}

/** The values `UCheckboxGroup` should show as ticked, in its own vocabulary. */
function checkedIn(section: ReviewSection): string[] {
  return section.lines.filter(line => isOn(line.items.map(item => item.id))).map(line => line.key)
}

function onUpdate(section: ReviewSection, next: unknown) {
  const after = new Set((next as string[]) ?? [])
  for (const line of section.lines) {
    const on = isOn(line.items.map(item => item.id))
    if (after.has(line.key) !== on) toggle(line.items.map(item => item.id))
  }
}

/** Which nights a line came off, for the "why is this here" line beside it. */
function provenance(line: ReviewSection['lines'][number]): string | null {
  if (grouping.value === 'meal') return null
  const names = new Set<string>()
  for (const item of line.items) {
    const night = plan.nightOf(item)
    if (night) names.add(night.name)
  }
  return names.size ? [...names].join(' · ') : null
}

async function commit() {
  if (committing.value || !selectedCount.value) return
  committing.value = true
  failed.value = false
  try {
    const { added } = await plan.commitReview(weekStart, new Set(excluded))
    toast.add({
      title: added ? `${added} item${added === 1 ? '' : 's'} on the list` : 'Already on the list',
      icon: 'i-lucide-shopping-cart',
      color: 'success'
    })
    await navigateTo('/shopping')
  } catch {
    // Kept on screen with a way to try again rather than toasted and forgotten:
    // this is the one press the whole flow was for, and a week that silently
    // failed to reach the list is a week nobody shops for.
    failed.value = true
  } finally {
    committing.value = false
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <AppPageHeader content-class="max-w-xl">
      <template #title>
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to the week"
          class="-ml-2 shrink-0"
          @click="emit('back')"
        />
        <div class="min-w-0 flex-1">
          <!--
            Where this is in the flow, in words. The seven nights and this make
            eight steps; a bar saying so would be the third progress indicator on
            one screen, and the summary card below already draws the one that
            carries information.
          -->
          <p class="text-[11px] font-medium uppercase tracking-wider text-dimmed">
            Step 8 of 8 · {{ weekLabel }}
          </p>
          <h1 class="truncate text-lg font-semibold">
            Review ingredients
          </h1>
        </div>
      </template>
    </AppPageHeader>

    <main class="mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto px-3 pb-4">
      <div class="flex flex-col gap-3 pt-3">
        <!-- The same four numbers the wide screen's aside carries, unchanged. -->
        <PlanWeekStats :nights="nights" />

        <div class="flex items-center gap-2">
          <!--
            One choice between two arrangements, so a radio group — `card` with
            the indicator hidden is this app's chip, shared with the list's aisle
            filters and the recipe facets.
          -->
          <URadioGroup
            v-model="grouping"
            :items="groupingItems"
            variant="card"
            indicator="hidden"
            orientation="horizontal"
            size="sm"
            color="primary"
            :ui="{ fieldset: 'gap-1.5' }"
          />
          <span
            v-if="alreadyIn"
            class="ml-auto shrink-0 text-xs text-dimmed"
          >{{ alreadyIn }} already in</span>
        </div>

        <UEmpty
          v-if="!sections.length"
          variant="naked"
          size="sm"
          icon="i-lucide-shopping-basket"
          title="Nothing to buy"
          description="None of this week's nights has a recipe with ingredients on it yet."
        />

        <UCard
          v-for="section in sections"
          :key="section.id"
          variant="subtle"
          :ui="{ header: 'px-3.5 py-2.5 sm:px-3.5', body: 'p-0 sm:p-0' }"
        >
          <template #header>
            <div class="flex items-baseline gap-2">
              <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-highlighted">
                {{ section.name }}
              </h2>
              <span class="shrink-0 text-xs text-dimmed tabular-nums">{{ section.lines.length }}</span>
            </div>
          </template>

          <!--
            `list` rather than `card` for the same reason the shopping list uses
            it: the root stays a plain element, so only the text is a label and
            the row is still a full-width tap target.
          -->
          <UCheckboxGroup
            :model-value="checkedIn(section)"
            :items="section.lines.map(line => ({ value: line.key, label: line.name }))"
            variant="list"
            size="lg"
            color="primary"
            :ui="{
              fieldset: 'flex-col gap-0',
              item: 'items-center gap-3 px-3 py-3 border-b border-default last:border-b-0',
              wrapper: 'min-w-0 flex-1',
              base: 'size-5'
            }"
            @update:model-value="onUpdate(section, $event)"
          >
            <template #label="{ item }">
              <span
                v-for="line in section.lines.filter(l => l.key === item.value)"
                :key="line.key"
                class="block min-w-0"
              >
                <span
                  class="block truncate text-sm"
                  :class="isOn(line.items.map(i => i.id))
                    ? 'text-highlighted'
                    : 'text-dimmed line-through'"
                >{{ line.name }}</span>

                <!--
                  How much, and which night wanted it — the two things that make
                  "do we have this already" answerable without opening anything.
                  Under the name rather than after it: a recipe title and a
                  quantity do not both fit on a phone's width beside a name, and
                  the one that gets truncated is always the one you needed.

                  A line that is off says why instead.
                -->
                <span class="mt-0.5 block truncate text-xs text-dimmed">
                  <template v-if="!isOn(line.items.map(i => i.id))">
                    {{ line.covered ? 'In the cupboard' : 'Not buying this week' }}
                  </template>
                  <template v-else>
                    {{ [line.quantityLabel, provenance(line)].filter(Boolean).join(' · ') }}
                  </template>
                </span>
              </span>
            </template>
          </UCheckboxGroup>
        </UCard>

        <!--
          What the week assumes is in the house. Said once, at the bottom, and
          not as choices: an ingredient flagged as always in the cupboard is not
          a decision, and fifteen of them above would bury the four lines this
          week actually turns on.
        -->
        <UAlert
          v-if="byAisle.staples.length"
          color="neutral"
          variant="subtle"
          icon="i-lucide-archive"
          title="Check the cupboard"
          :description="[...new Set(byAisle.staples.map(row => row.name))].join(', ')"
          :ui="{ description: 'text-xs' }"
        />
      </div>
    </main>

    <div class="shrink-0 border-t border-default bg-default/85 px-3 py-3 backdrop-blur">
      <div class="mx-auto flex max-w-xl flex-col gap-2">
        <UAlert
          v-if="failed"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="That did not go through"
          description="Nothing was lost. Try again."
        />

        <div class="flex items-baseline justify-between gap-2 text-xs">
          <span class="text-muted tabular-nums">
            {{ selectedCount }} selected · {{ skippedCount }} skipped
          </span>
          <UButton
            color="primary"
            variant="link"
            size="xs"
            label="Edit the week"
            class="-me-2 shrink-0"
            @click="emit('back')"
          />
        </div>

        <UButton
          color="primary"
          size="xl"
          block
          icon="i-lucide-shopping-cart"
          :label="selectedCount
            ? `Add ${selectedCount} item${selectedCount === 1 ? '' : 's'} to shopping list`
            : 'Nothing selected'"
          :disabled="!selectedCount"
          :loading="committing"
          @click="commit"
        />
      </div>
    </div>
  </div>
</template>
