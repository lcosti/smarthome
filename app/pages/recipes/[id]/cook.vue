<script setup lang="ts">
import { useRecipesStore } from '../../../stores/recipes'
import { findStepDuration, formatCountdown, splitStepBody } from '../../../utils/cook'

/**
 * Cook mode: one step at a time, at the size you can read from the hob.
 *
 * The recipe page is the right way to read a recipe and the wrong way to cook
 * one. Standing at the pan with your hands full you are doing exactly one thing,
 * and finding your place again in a numbered list of nine is the thing that
 * actually goes wrong.
 *
 * So the step is enormous and there is only ever one of it. The ingredients stay
 * visible because you check them off before you start and glance back mid-way,
 * and the timer is here because the alternative is the oven clock across the
 * room and a memory of when you set it.
 *
 * Everything the cook touches — ticks, which step, a running timer — is session
 * state, deliberately. None of it belongs to the recipe, and a checkbox that
 * was still ticked next Tuesday would be a small lie.
 */

definePageMeta({
  // Read by the app shell, which drops its chrome for this view: the header —
  // clock, weather, the four other places you could be — is four things you are
  // not doing.
  chromeless: true
})

const route = useRoute()
const recipes = useRecipesStore()
const now = useBoardClock()

const id = computed(() => String(route.params.id))
const recipe = computed(() => recipes.recipeById(id.value))
const lines = computed(() => recipes.ingredientsFor(id.value))
const steps = computed(() => recipes.stepsFor(id.value))

const minutes = computed(() => {
  const total = (recipe.value?.prep_minutes ?? 0) + (recipe.value?.cook_minutes ?? 0)
  return total || null
})

const dayName = computed(() => now.value.toLocaleDateString('en-GB', { weekday: 'long' }))
const dateLabel = computed(() =>
  now.value.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
)

// --- the ingredients you have already got out --------------------------------

const checked = ref(new Set<string>())

function toggleLine(lineId: string) {
  const next = new Set(checked.value)
  if (!next.delete(lineId)) next.add(lineId)
  checked.value = next
}

const checkedCount = computed(() => lines.value.filter(line => checked.value.has(line.id)).length)

/**
 * The next one to get out.
 *
 * Working down a list of eleven things, the only one you care about is the top
 * one you have not done. It gets the amber ring, so a glance from across the
 * kitchen lands in the right place.
 */
const activeLineId = computed(() => lines.value.find(line => !checked.value.has(line.id))?.id ?? null)

// --- where you are in the method ---------------------------------------------

const stepIndex = ref(0)
const currentStep = computed(() => steps.value[stepIndex.value] ?? null)
const content = computed(() => currentStep.value ? splitStepBody(currentStep.value.body) : null)
const duration = computed(() => content.value ? findStepDuration(content.value.main) : null)

const isLastStep = computed(() => stepIndex.value >= steps.value.length - 1)

function goTo(index: number) {
  stepIndex.value = Math.min(Math.max(index, 0), Math.max(steps.value.length - 1, 0))
}

// A step edited away on another device while this sits on it. Not an error, and
// not worth throwing the cook back to step one over.
watch(() => steps.value.length, (length) => {
  if (stepIndex.value > length - 1) goTo(length - 1)
})

// --- timers -------------------------------------------------------------------

/**
 * Timers are kept per step, keyed by step id, and stored as the instant they
 * finish rather than as a number counting down.
 *
 * An end time survives a missed tick, a throttled background tab and the cook
 * walking forward two steps and back — come back to a step that was simmering
 * and it is still simmering, with the right number of seconds left.
 */
const endings = reactive(new Map<string, number>())
const nowMs = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined

const endsAt = computed(() => (currentStep.value ? endings.get(currentStep.value.id) ?? null : null))

const remaining = computed(() => {
  if (endsAt.value === null) return duration.value?.seconds ?? 0
  return Math.max(0, Math.ceil((endsAt.value - nowMs.value) / 1000))
})

const timerPhase = computed<'idle' | 'running' | 'finished'>(() => {
  if (endsAt.value === null) return 'idle'
  return remaining.value > 0 ? 'running' : 'finished'
})

function startTimer() {
  const step = currentStep.value
  const spec = duration.value
  if (!step || !spec) return
  // Tapping a running timer does nothing. A cook reaching past a pan with the
  // back of a wrist should not be able to put twenty minutes back on it.
  if (timerPhase.value === 'running') return

  nowMs.value = Date.now()
  endings.set(step.id, nowMs.value + spec.seconds * 1000)

  // The second hand only runs while something is counting. A tablet left on
  // this view for an hour after dinner should not be waking the tab every
  // second.
  if (!tick) {
    tick = setInterval(() => {
      nowMs.value = Date.now()
      if (![...endings.values()].some(end => end > nowMs.value)) stopTick()
    }, 1000)
  }
}

function resetTimer() {
  if (currentStep.value) endings.delete(currentStep.value.id)
}

/**
 * Timers running on steps you have walked away from.
 *
 * The whole reason to time something is that you then go and do the next thing,
 * which on this screen means the timer scrolls out of view exactly when it
 * starts to matter. So it detaches and sits in the top bar, named, and pressing
 * it goes back to the step that set it.
 *
 * The step you are on is left out: its timer is already on screen at four times
 * the size, and two of the same number is a reason to look twice.
 */
const pinned = computed(() => steps.value.flatMap((step, index) => {
  const end = endings.get(step.id)
  if (end === undefined || index === stepIndex.value) return []

  const left = Math.max(0, Math.ceil((end - nowMs.value) / 1000))
  return [{
    id: step.id,
    index,
    left,
    done: left === 0,
    name: findStepDuration(splitStepBody(step.body).main)?.name ?? `Step ${index + 1}`
  }]
}))

function stopTick() {
  if (tick) clearInterval(tick)
  tick = undefined
}

// --- keys ----------------------------------------------------------------------

// The kitchen screen is a touchscreen, but this gets used on a laptop too, and
// reaching for the mouse between nine steps is how you stop looking at it.
function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowRight') goTo(stepIndex.value + 1)
  if (event.key === 'ArrowLeft') goTo(stepIndex.value - 1)
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  stopTick()
})
</script>

<template>
  <div
    v-if="recipe"
    data-cook-mode
    :data-cook-step="`${steps.length ? stepIndex + 1 : 0}/${steps.length}`"
    class="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0"
  >
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-default px-4 py-3 lg:px-6 lg:py-3.5">
      <div class="flex min-w-0 items-center gap-3.5">
        <span class="text-lg font-semibold tracking-[-0.02em] text-highlighted lg:text-xl">{{ dayName }}</span>
        <span class="h-5 w-px shrink-0 bg-accented" />
        <span class="text-lg text-muted lg:text-xl">{{ dateLabel }}</span>
        <UBadge
          color="primary"
          variant="outline"
          label="Cook mode"
          :ui="{ base: 'shrink-0 rounded-md px-2 py-1 text-xs font-medium leading-none' }"
        />
      </div>

      <div class="flex shrink-0 items-center gap-3 lg:gap-4">
        <!--
          A timer left running on another step. Amber while it counts, solid
          when it goes off, and pressing it takes you back to the pan.
        -->
        <button
          v-for="timer in pinned"
          :key="timer.id"
          type="button"
          data-cook-pinned
          class="flex h-[34px] items-center gap-2.5 rounded-full px-3.5 transition-opacity duration-[80ms] active:opacity-85"
          :class="timer.done ? 'bg-primary text-inverted' : 'bg-primary/10 text-primary ring ring-primary/25'"
          @click="goTo(timer.index)"
        >
          <span class="size-2 shrink-0 rounded-full bg-current" />
          <span class="text-sm font-medium">{{ timer.name }}</span>
          <span class="font-mono text-sm tabular-nums">{{ formatCountdown(timer.left) }}</span>
        </button>

        <span class="hidden font-mono text-sm text-dimmed sm:inline">
          <template v-if="minutes">{{ minutes }} min · </template>serves {{ recipe.base_servings }}
        </span>
        <UButton
          to="/today"
          color="neutral"
          variant="subtle"
          size="lg"
          label="Exit"
          class="shrink-0"
        />
      </div>
    </div>

    <!--
      The step first on a phone and the ingredients under it; side by side with
      room to spare on a wide screen. Cooking is the step — the ingredients are
      what you glance back at — and on a narrow screen whichever comes first is
      the one you are looking at.
    -->
    <div class="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:grid lg:grid-cols-[1fr_1.9fr] lg:gap-4 lg:overflow-hidden lg:p-6">
      <UCard
        variant="outline"
        :ui="{
          root: 'order-2 flex min-h-0 flex-col overflow-hidden rounded-lg bg-elevated lg:order-1',
          header: 'px-5 py-4 sm:px-5',
          body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0',
          footer: 'flex flex-none items-center justify-between px-5 py-3.5 sm:px-5'
        }"
      >
        <template #header>
          <h3 class="font-mono text-xs uppercase tracking-[0.14em] text-dimmed">
            Ingredients
          </h3>
          <h2 class="mt-1.5 truncate text-xl font-semibold tracking-[-0.02em] text-highlighted">
            {{ recipe.name }}
          </h2>
        </template>

        <ul
          v-if="lines.length"
          class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2"
        >
          <li
            v-for="line in lines"
            :key="line.id"
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-default/60"
              @click="toggleLine(line.id)"
            >
              <span
                v-if="checked.has(line.id)"
                class="flex size-5 shrink-0 items-center justify-center rounded bg-primary"
              >
                <UIcon
                  name="i-lucide-check"
                  class="size-3.5 text-inverted"
                />
              </span>
              <span
                v-else
                class="size-5 shrink-0 rounded bg-transparent ring"
                :class="line.id === activeLineId ? 'ring-primary' : 'ring-accented'"
              />

              <span
                class="min-w-0 flex-1 text-base"
                :class="checked.has(line.id)
                  ? 'text-dimmed line-through'
                  : line.id === activeLineId
                    ? 'font-medium text-highlighted'
                    : 'text-default'"
              >{{ line.name }}</span>

              <span
                v-if="line.quantity"
                class="shrink-0 whitespace-nowrap font-mono text-sm"
                :class="checked.has(line.id) ? 'text-dimmed' : 'text-muted'"
              >{{ line.quantity }}</span>
            </button>
          </li>
        </ul>

        <p
          v-else
          class="px-5 py-4 text-base text-dimmed"
        >
          No ingredients listed.
        </p>

        <template #footer>
          <span class="text-sm text-muted">Checked off</span>
          <span class="font-mono text-sm text-default">{{ checkedCount }} / {{ lines.length }}</span>
        </template>
      </UCard>

      <UCard
        variant="outline"
        :ui="{
          root: 'order-1 flex min-h-0 flex-col overflow-hidden rounded-lg bg-elevated lg:order-2',
          header: 'flex items-center gap-6 px-5 py-4 sm:px-6',
          body: 'flex min-h-0 flex-1 flex-col gap-6 px-5 py-5 sm:p-0 sm:px-6 sm:py-6',
          footer: 'flex flex-none items-center justify-between gap-4 px-5 py-4 sm:px-6'
        }"
      >
        <template #header>
          <h3 class="shrink-0 font-mono text-xs uppercase tracking-[0.14em] text-dimmed">
            Step {{ steps.length ? stepIndex + 1 : 0 }} of {{ steps.length }}
          </h3>
          <!--
            The bar fills as you go rather than lighting only the current
            segment: at step seven of nine you want to see that you are nearly
            done, not one lit stripe adrift in the grey.
          -->
          <div
            v-if="steps.length"
            class="flex flex-1 items-center gap-1.5"
          >
            <span
              v-for="(step, index) in steps"
              :key="step.id"
              class="h-1 flex-1 rounded-full"
              :class="index <= stepIndex ? 'bg-primary' : 'bg-accented'"
            />
          </div>
        </template>

        <template v-if="content">
          <p class="text-pretty text-2xl font-semibold leading-[1.15] tracking-[-0.02em] text-highlighted lg:text-4xl">
            {{ content.main }}
          </p>

          <!-- No time in the prose, no timer. A guess is not worth a button. -->
          <div v-if="duration">
            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button"
                class="flex h-14 items-center gap-4 rounded-lg px-5 transition-opacity duration-[80ms] active:opacity-85 lg:h-16 lg:gap-5 lg:px-6"
                :class="timerPhase === 'finished'
                  ? 'bg-primary text-inverted'
                  : 'bg-primary/10 text-primary ring ring-primary/25'"
                @click="startTimer()"
              >
                <span class="size-2.5 shrink-0 rounded-full bg-current" />
                <!--
                  "Start soak 20 min" while it is offered, then just "Soak"
                  once it is running — at that point the number beside it is
                  the sentence, and repeating how long it was is noise.
                -->
                <span class="text-base font-medium lg:text-lg">
                  {{ timerPhase === 'idle'
                    ? `Start ${duration.name ? `${duration.name.toLowerCase()} ` : ''}${duration.label}`
                    : timerPhase === 'running' ? (duration.name ?? 'Timer') : `${duration.name ?? 'Timer'} done` }}
                </span>
                <span class="h-7 w-px shrink-0 bg-current opacity-25" />
                <span class="font-mono text-xl tabular-nums lg:text-2xl">{{ formatCountdown(remaining) }}</span>
              </button>

              <UButton
                color="neutral"
                variant="subtle"
                size="xl"
                label="Reset"
                :disabled="timerPhase === 'idle'"
                class="h-14 shrink-0 lg:h-16"
                @click="resetTimer()"
              />
            </div>
            <p
              v-if="timerPhase === 'idle'"
              class="mt-2 text-sm text-dimmed"
            >
              Tap to start
            </p>
          </div>

          <!-- The aside the recipe wrote in its own paragraph, kept as an aside. -->
          <div
            v-if="content.tip"
            class="flex items-start gap-3.5 rounded-lg bg-default/60 px-5 py-4 ring ring-default"
          >
            <span class="mt-2.5 size-2 shrink-0 rounded-full bg-primary" />
            <p class="whitespace-pre-line text-pretty text-base leading-[1.45] text-default">
              {{ content.tip }}
            </p>
          </div>

          <!--
            The step is set at the top and the slack falls to the bottom. A step
            whose text and timer floated apart to fill the card would put the
            Start button somewhere different on every step.
          -->
          <div class="min-h-0 flex-1" />
        </template>

        <p
          v-else
          class="text-base text-dimmed"
        >
          No method written down. It is on the recipe page, or in somebody's head.
        </p>

        <template
          v-if="steps.length"
          #footer
        >
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="subtle"
            size="xl"
            label="Previous"
            :disabled="stepIndex === 0"
            class="h-14"
            @click="goTo(stepIndex - 1)"
          />
          <UButton
            v-if="isLastStep"
            to="/today"
            color="primary"
            variant="solid"
            size="xl"
            label="Finish"
            trailing-icon="i-lucide-check"
            class="h-14 font-semibold"
          />
          <UButton
            v-else
            color="neutral"
            variant="subtle"
            size="xl"
            label="Next step"
            trailing-icon="i-lucide-arrow-right"
            class="h-14"
            @click="goTo(stepIndex + 1)"
          />
        </template>
      </UCard>
    </div>
  </div>

  <!-- A recipe deleted on another device while this was open. Not an error. -->
  <UEmpty
    v-else
    icon="i-lucide-book-open"
    title="That recipe is gone"
    description="It was deleted on another device while this was open."
    :actions="[{ label: 'All recipes', to: '/recipes', color: 'neutral', variant: 'subtle', size: 'xl' }]"
    class="min-h-dvh p-6"
    :ui="{
      avatar: 'size-11 bg-transparent text-dimmed',
      title: 'text-2xl font-semibold text-muted lg:text-3xl',
      description: 'text-base text-muted'
    }"
  />
</template>
