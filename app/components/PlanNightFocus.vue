<script setup lang="ts">
import { usePlanStore, type PlannedNight } from '../stores/plan'
import { SKIP_REASONS } from '../utils/skip'

/**
 * One night, on a page that is only showing that night.
 *
 * A night with something on it is the same card the week grid draws, minus its
 * own day heading — the page above already says "Monday", and a card repeating
 * it under a heading that big is the same sentence twice. That keeps one answer
 * to "what does a planned night look like", including the picture, the "On
 * list" badge, the × and being draggable onto another day.
 *
 * An empty one is where the two shapes part company. In a grid an empty night
 * is a cell you can press; here it is the whole question the screen is asking,
 * so it states what to do about it and offers both answers. "Skip" opens the
 * four reasons rather than skipping outright: not cooking is a decision the rest
 * of the app reads — the board says takeaway, the generator stops offering — and
 * a night marked "something else" because that was the fastest button is the
 * kind of data that quietly rots.
 *
 * Unless nobody is eating on it, in which case the screen has no question to
 * ask: it says so and offers the one answer that still means anything. "Not
 * cooking" is not one of them — there is nothing to not cook, and a takeaway
 * logged for an empty house is a decision about nothing.
 */
const { night, today, past = false, events = [] } = defineProps<{
  night: PlannedNight
  today: string
  past?: boolean
  events?: PlanEvent[]
}>()

const emit = defineEmits<{ open: [], remove: [], skip: [reason: string] }>()

const plan = usePlanStore()

/** The same fact the grid's cards fade on, asked of the one night on screen. */
const nobodyHome = computed(() => plan.nobodyEatingOn(night.date))

const reasonItems = computed(() =>
  SKIP_REASONS.map(reason => ({
    label: reason.label,
    icon: reason.icon,
    onSelect: () => emit('skip', reason.value)
  }))
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <PlanNightCard
      v-if="night.entries.length || past"
      :night="night"
      :today="night.date === today"
      :past="past"
      :header="false"
      :table="false"
      :events="events"
      @open="emit('open')"
      @remove="emit('remove')"
    />

    <template v-else>
      <!--
        `outline` is the dashed variant in this app's theme, which is the shape
        the empty night wants — an outline around a space where a dinner goes,
        rather than a filled card pretending something is there.
      -->
      <UEmpty
        variant="outline"
        :icon="nobodyHome ? 'i-lucide-house' : 'i-lucide-utensils'"
        :title="nobodyHome ? 'Nobody home' : 'No dinner planned'"
        :description="nobodyHome
          ? 'Nobody is down as eating tonight, so there is nothing to plan.'
          : 'Pick something to cook, or say nobody is cooking tonight.'"
        :ui="{ description: 'text-balance' }"
      >
        <template #actions>
          <!--
            Still offered on a night nobody is in for — you can be hosting, and
            the roster can be wrong — but it stops being the thing the screen is
            asking for, so it drops out of the accent.
          -->
          <UButton
            :color="nobodyHome ? 'neutral' : 'primary'"
            :variant="nobodyHome ? 'subtle' : 'solid'"
            icon="i-lucide-plus"
            label="Add dinner"
            @click="emit('open')"
          />

          <!--
            A menu rather than a button, because the reason is not a detail: it
            is what makes a skipped night different from an empty one everywhere
            else in the app.
          -->
          <UDropdownMenu
            v-if="!nobodyHome"
            :items="reasonItems"
            :ui="{ content: 'min-w-48' }"
          >
            <UButton
              color="neutral"
              variant="subtle"
              icon="i-lucide-circle-slash"
              label="Not cooking"
            />
          </UDropdownMenu>
        </template>
      </UEmpty>

      <!-- The diary is why a night gets skipped, so it is legible next to that choice. -->
      <PlanEventRail
        v-if="events.length"
        :events="events"
        :max="4"
      />
    </template>
  </div>
</template>
