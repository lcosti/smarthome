<script setup lang="ts">
import { buildHeader } from '../utils/board'

/**
 * Whether there is a plan, and how long ago it was made.
 *
 * One component because two headers ask — the wide shell's bar and the phone's
 * plan page — and the answer must not depend on which one you are looking at.
 * Relative rather than absolute: the useful question is "is this still the
 * plan", and "2 hours ago" answers it without arithmetic.
 */
const { short = false } = defineProps<{
  /** Drop the leading "Plan" beside a heading that already says it. */
  short?: boolean
}>()

const now = useBoardClock()
const nights = useBoardNights(now)

const plan = computed(() =>
  buildHeader({
    now: now.value,
    nights: nights.value,
    offline: false,
    lastSyncedAt: null,
    weather: null
  }).plan
)

const label = computed(() => {
  if (!short) return plan.value.label
  const trimmed = plan.value.label.replace(/^Plan /, '')
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
})
</script>

<template>
  <!--
    Neutral with an amber dot either way. The state is in the words — "generated
    · 2 hours ago" or "not generated" — and swapping the whole badge to amber
    made a fact about the plan read as an alert about it.
  -->
  <UBadge
    color="neutral"
    variant="subtle"
    class="gap-1.5"
  >
    <span class="size-1.5 shrink-0 rounded-full bg-primary" />
    {{ label }}
  </UBadge>
</template>
