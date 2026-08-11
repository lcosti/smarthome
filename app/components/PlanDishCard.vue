<script setup lang="ts">
import { useAttendanceStore } from '../stores/attendance'
import { usePeopleStore } from '../stores/people'
import { dishLabel, type PlannedEntry } from '../stores/plan'
import { useRecipesStore } from '../stores/recipes'
import type { Meal } from '../utils/meal'
import { initialOf } from '../utils/person-colors'
import { pictureOf } from '../utils/photo'
import { defaultCook } from '../utils/plan-cook'
import { skipIcon } from '../utils/skip'

/**
 * A dish planned into a slot — what it is, what it costs, and whether it has been
 * shopped for.
 *
 * One component for all three meals. A lunch that is a recipe costs the same two
 * things a dinner does — minutes at the stove and things to buy — so it is worth
 * the same block, and a day row drawing its three slots three different ways read
 * as three unrelated widgets rather than as one day. This is the whole of the
 * answer to "what does a planned meal look like"; the cell around it
 * (`PlanMealCell`, `PlanNightCard`) owns only what an *empty* slot says and where
 * the drop target is.
 *
 * The thing you pick up, too. A dish is what moves between days — the date and
 * the table around it belong to the day and stay where they are — so the press
 * that starts a drag starts here. A mouse picks it up on the first few pixels of
 * travel; a finger holds it for a moment first, so that scrolling a column of
 * these still scrolls. It is a drag *source* only: the cell around it is what
 * registers as somewhere a dish can land, because an empty slot is a target too.
 */
const { planned, date, meal } = defineProps<{
  planned: PlannedEntry
  date: string
  meal: Meal
  /**
   * What the × says it does, phrased by the caller — it is the caller that knows
   * what the slot is called on screen ("off Mon", "off Monday's lunch").
   */
  removeLabel: string
}>()

defineEmits<{ open: [], remove: [] }>()

const recipes = useRecipesStore()
const people = usePeopleStore()
const attendance = useAttendanceStore()

/**
 * Who's at the stove. An explicit choice first; failing that, the sole adult
 * eating that day claims the night by default (see plan-cook.ts) — derived, so
 * the roster changing reassigns it with nothing going stale. Nobody cooks a
 * skipped or a leftovers night, and the id of a person since removed resolves
 * to nothing — the card just goes back to the default.
 */
const cook = computed(() =>
  planned.skipped || planned.leftover
    ? undefined
    : people.personById(planned.entry.cook_person_id)
      ?? defaultCook(attendance.presentOn(date), date)
      ?? undefined
)

/**
 * The picture of what is being eaten — which on a leftovers night is the picture
 * of the night it came off, as the wall board already has it. Thursday's plate
 * looks like Tuesday's because it is Tuesday's.
 */
const picture = computed(() =>
  pictureOf(planned.leftoverSource?.recipe ?? planned.recipe)
)

/**
 * What the dish costs, in the two units a Tuesday evening is spent in: time at
 * the stove and things to buy. A leftovers night costs neither and says so.
 *
 * Icons rather than words because there are two of them on one short line and
 * the card is a quarter of a screen wide. The names are listed in nuxt.config's
 * client bundle: chosen here rather than in a template, the scanner cannot see
 * them, and an unbundled icon on a kitchen tablet with no signal is a blank.
 */
const dishMeta = computed<{ icon: string, label: string }[]>(() => {
  const out: { icon: string, label: string }[] = []
  // A skipped night says the same thing a leftovers night says — nobody is at
  // the stove — and the icon is what tells you which kind of evening it is. The
  // name above already says "Takeaway", so this line does not repeat it.
  if (planned.skipped) {
    out.push({ icon: skipIcon(planned.entry.skip_reason), label: 'no cooking' })
    return out
  }
  if (planned.leftover) {
    out.push({ icon: 'i-lucide-refrigerator', label: 'no cooking' })
  } else {
    const minutes = (planned.recipe?.prep_minutes ?? 0) + (planned.recipe?.cook_minutes ?? 0)
    if (minutes > 0) out.push({ icon: 'i-lucide-clock', label: `${minutes}m` })
  }

  const items = planned.recipe ? recipes.ingredientsFor(planned.recipe.id).length : 0
  if (items) out.push({ icon: 'i-lucide-utensils', label: `${items} items` })

  return out
})

const drag = usePlanDrag()

/**
 * Whether this is the dish currently in the air. The entry rather than the date:
 * a day has three slots, and a lunch being carried must not fade the dinner
 * underneath it.
 */
const isSource = computed(() =>
  drag.payload.value?.kind === 'night' && drag.payload.value.entryId === planned.entry.id
)

function pickUp(event: PointerEvent) {
  drag.press(event, {
    kind: 'night',
    entryId: planned.entry.id,
    date,
    meal,
    label: dishLabel(planned),
    image: picture.value
  })
}
</script>

<template>
  <UCard
    variant="soft"
    :ui="{ root: 'relative min-h-0 touch-manipulation select-none', body: 'h-full p-3 sm:p-3' }"
    :class="isSource ? 'cursor-grabbing opacity-40' : 'cursor-grab'"
    @pointerdown="pickUp"
  >
    <!--
      A raw button, per the card-and-row exception in CLAUDE.md: this is a
      stacked block — dish, meta, badge — not a label, and a `UButton` lays its
      content out as a flex row through slots it would take four overrides to
      undo. It fills the card so the whole dish is the target, and keeps its
      right edge clear of the remove button — which is a sibling rather than a
      child, because a button inside a button is not a thing a browser will
      render.
    -->
    <button
      type="button"
      class="flex h-full w-full items-start gap-3 pr-7 text-left transition-opacity duration-[80ms] active:opacity-85"
      @click="$emit('open')"
    >
      <RecipeThumb
        :src="picture"
        :alt="dishLabel(planned)"
      />

      <!--
        `min-w-0` is what lets the name wrap beside the picture: a flex child
        defaults to its content's width, and a long dish name would push the
        card wider than its column rather than running onto a second line.
      -->
      <span class="flex min-w-0 flex-1 flex-col items-start">
        <span class="line-clamp-3 text-pretty text-[15px] font-medium leading-tight tracking-[-0.01em] text-highlighted">
          {{ dishLabel(planned) }}
        </span>

        <span class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dimmed">
          <span
            v-for="fact in dishMeta"
            :key="fact.label"
            class="flex items-center gap-1"
          >
            <UIcon
              :name="fact.icon"
              class="size-3.5 shrink-0"
            />
            {{ fact.label }}
          </span>

          <span
            v-if="cook"
            class="flex items-center gap-1"
          >
            <UAvatar
              :src="cook.avatar ?? undefined"
              :alt="cook.name"
              :text="initialOf(cook.name)"
              size="3xs"
            />
            {{ cook.name }}
          </span>

          <!--
            Shopped-for is the third fact about the slot, and sits on the line
            with the other two rather than under them — a card is a fixed height
            with a picture in it now, and a block of its own was the line that
            fell off the bottom.
          -->
          <UBadge
            v-if="planned.derived"
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lucide-check"
            label="On list"
          />
        </span>
      </span>
    </button>

    <UButton
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="xs"
      data-no-drag
      :aria-label="removeLabel"
      class="absolute right-1.5 top-1.5"
      @click="$emit('remove')"
    />
  </UCard>
</template>
