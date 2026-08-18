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

/**
 * Whose version differs tonight, drawn where it applies: a swap on the line
 * being measured, an amendment on the step being done, and anything untargeted
 * under the ingredients, to be read before the hob is on. Same matching as the
 * recipe panels — anyone at home the audience fits — so nothing here needs to
 * know a date.
 */
const adaptations = useRecipeAdaptations(() => id.value)
const generalNotes = computed(() =>
  adaptations.matched.value.filter(view => view.note)
)

const minutes = computed(() => {
  const total = (recipe.value?.prep_minutes ?? 0) + (recipe.value?.cook_minutes ?? 0)
  return total || null
})

const dayName = computed(() => now.value.toLocaleDateString('en-GB', { weekday: 'long' }))
const dateLabel = computed(() =>
  now.value.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
)

// What the dish costs you, in one line. Set in the mono face — figures you
// compare, never prose.
const metaLine = computed(() => [
  minutes.value ? `${minutes.value} min` : null,
  recipe.value?.kcal ? `${recipe.value.kcal} kcal` : null,
  `serves ${recipe.value?.base_servings}`
].filter(Boolean).join(' · '))

// --- the ingredients you have already got out --------------------------------

const checked = ref(new Set<string>())

function toggleLine(lineId: string) {
  const next = new Set(checked.value)
  if (!next.delete(lineId)) next.add(lineId)
  checked.value = next
}

const checkedCount = computed(() => lines.value.filter(line => checked.value.has(line.id)).length)

/**
 * Which pane the phone is showing.
 *
 * A wide screen puts the step and the ingredients side by side, because it has
 * the room and glancing across costs nothing. A phone has room for exactly one
 * of them, and stacking the two — the old answer — meant the step you are
 * cooking scrolled off the top the moment you checked what was in it.
 *
 * So on a phone they are two tabs, and the tab you are not on carries its own
 * count: "Ingredients 3/11" answers the question most glances at that list were
 * asking anyway, without switching.
 *
 * Session state like the ticks and the step, and only consulted below `lg` —
 * the wide layout renders both panes whatever this says.
 */
const pane = ref<'steps' | 'ingredients'>('steps')

const panes = computed(() => [
  { label: 'Steps', value: 'steps' },
  { label: `Ingredients ${checkedCount.value}/${lines.value.length}`, value: 'ingredients' }
])

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
 * The step bar, and the timers living in it.
 *
 * The whole reason to time something is that you then go and do the next thing,
 * which on this screen means the timer scrolls out of view exactly when it
 * starts to matter. So a timer left running does not scroll away with its step —
 * that step's segment of the bar opens out into the timer, named, and pressing
 * it goes back to the pan.
 *
 * Putting it here rather than in a tray of its own is the point: the bar is
 * already the answer to "where am I in this", and a pan on the heat is a place
 * you still are. Two steps back with three minutes on it reads off the bar's own
 * geometry, which no chip in a corner can say.
 *
 * The step you are on never opens out: its timer is already on screen at four
 * times the size, and two of the same number is a reason to look twice.
 */
const track = computed(() => steps.value.map((step, index) => {
  const end = endings.get(step.id)
  const running = end !== undefined && index !== stepIndex.value
  const left = running ? Math.max(0, Math.ceil((end - nowMs.value) / 1000)) : 0

  return {
    id: step.id,
    index,
    filled: index <= stepIndex.value,
    timer: running
      ? {
          left,
          done: left === 0,
          name: findStepDuration(splitStepBody(step.body).main)?.name ?? `Step ${index + 1}`
        }
      : null
  }
}))

// A phone has not got the width for "Step 3 of 6", two open timers and a bar
// that still looks like a bar. When one opens, the bar takes a line of its own.
const anyTimerOpen = computed(() => track.value.some(seg => seg.timer))

/**
 * A countdown, one character slot at a time.
 *
 * Each slot holds a Transition keyed on its character, so each second only the
 * digits whose value changed roll — the old one slides down and out as the new
 * one slides in from above, an odometer wheel turning one notch. 4:59 to 4:58
 * moves one digit; the rest of the number holds still, which is what makes it
 * read as a countdown rather than a flicker. The classes live in main.css as
 * `.tick-*`.
 */
function countdownChars(seconds: number) {
  return formatCountdown(seconds).split('')
}

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
    class="flex h-full min-h-0 flex-col"
  >
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-default px-4 py-3 lg:px-6 lg:py-3.5">
      <div class="flex min-w-0 flex-1 items-center gap-3 lg:flex-none lg:gap-3.5">
        <!--
          Leaving is a labelled button on a laptop and a cross on a phone, where
          the width it would cost is width the recipe's name is using. Same
          destination, same place on the screen it was already looked for.
        -->
        <UButton
          to="/"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="lg"
          aria-label="Exit cook mode"
          class="-ms-2 shrink-0 lg:hidden"
        />

        <!--
          The day on a wall board, the dish on a phone. A tablet propped in the
          kitchen is also a calendar and wants to say which day it is; a phone
          in your hand was opened from the recipe and needs to confirm which one
          it opened.
        -->
        <div class="hidden items-center gap-3.5 lg:flex">
          <span class="text-lg font-semibold tracking-[-0.02em] text-highlighted lg:text-xl">{{ dayName }}</span>
          <span class="h-5 w-px shrink-0 bg-accented" />
          <span class="text-lg text-muted lg:text-xl">{{ dateLabel }}</span>
        </div>

        <div class="min-w-0 lg:hidden">
          <h1 class="truncate text-base font-semibold tracking-[-0.02em] text-highlighted">
            {{ recipe.name }}
          </h1>
          <p class="truncate font-mono text-xs text-dimmed">
            {{ metaLine }}
          </p>
        </div>

        <!--
          One badge, at the end of the day on a wide screen and pushed to the
          far edge on a phone by `ms-auto` — the group it sits in is the whole
          header row there, because everything to its right is hidden.
        -->
        <UBadge
          color="primary"
          variant="outline"
          label="Cook mode"
          class="shrink-0 max-lg:ms-auto"
        />
      </div>

      <div class="flex shrink-0 items-center gap-3 lg:gap-4">
        <!-- Both already under the recipe's name on a phone. -->
        <span class="hidden font-mono text-sm text-dimmed lg:inline">{{ metaLine }}</span>
        <UButton
          to="/"
          color="neutral"
          variant="subtle"
          size="lg"
          label="Exit"
          class="hidden shrink-0 lg:inline-flex"
        />
      </div>
    </div>

    <!-- The phone's pane switch. Absent above `lg`, which shows both. -->
    <UTabs
      v-model="pane"
      :items="panes"
      color="neutral"
      variant="pill"
      size="lg"
      :ui="{ root: 'shrink-0 p-3 lg:hidden', list: 'w-full', trigger: 'flex-1' }"
    />

    <!--
      Side by side on a wide screen, one at a time on a phone. Cooking is the
      step; the ingredients are what you glance back at.

      Nothing here scrolls at any width — each pane does its own, so the step's
      footer stays under your thumb rather than being chased down a long method.
    -->
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-0 lg:grid-cols-[1fr_1.9fr] lg:p-6">
      <UCard
        variant="outline"
        :ui="{
          root: `flex min-h-0 flex-col overflow-hidden bg-elevated
                 max-lg:rounded-none max-lg:bg-default max-lg:ring-0
                 ${pane === 'ingredients' ? '' : 'max-lg:hidden'}`,
          // The recipe's name is in the top bar on a phone and the tab above
          // says what this list is, so the header has nothing left to add.
          header: 'px-5 py-4 max-lg:hidden sm:px-5',
          body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0',
          footer: 'flex flex-none items-center justify-between px-5 py-3.5 sm:px-5'
        }"
      >
        <template #header>
          <h3 class="text-xs font-medium uppercase tracking-wide text-dimmed">
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
            <UCheckbox
              :model-value="checked.has(line.id)"
              size="lg"
              :ui="{
                root: 'items-center rounded-md px-2 py-2.5 transition-colors hover:bg-default/60',
                base: line.id === activeLineId ? 'ring-primary' : '',
                wrapper: 'ms-3'
              }"
              @update:model-value="toggleLine(line.id)"
            >
              <template #label>
                <span class="flex items-center gap-3">
                  <span
                    class="min-w-0 flex-1 text-base font-normal"
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
                </span>

                <!-- Whose version touches this line — said on the line, so the
                     swap is read in the same glance as the quantity it changes. -->
                <span
                  v-for="entry in adaptations.byLine.value.get(line.id) ?? []"
                  :key="`${entry.label}:${entry.text}`"
                  class="mt-1 flex items-baseline gap-1.5"
                >
                  <UBadge
                    variant="subtle"
                    size="sm"
                    class="shrink-0"
                  >
                    {{ entry.label }}
                  </UBadge>
                  <span class="min-w-0 text-sm font-normal text-muted">{{ entry.text }}</span>
                </span>
              </template>
            </UCheckbox>
          </li>
        </ul>

        <p
          v-else
          class="px-5 py-4 text-base text-dimmed"
        >
          No ingredients listed.
        </p>

        <!-- Adaptation notes that name no line and no step: read before the
             hob is on, which is what this pane is for. -->
        <div
          v-if="generalNotes.length"
          class="shrink-0 space-y-2 px-3 pb-3"
        >
          <UAlert
            v-for="view in generalNotes"
            :key="view.id"
            color="primary"
            variant="subtle"
            icon="i-lucide-utensils"
            :title="`${view.label} — ${view.forWho}`"
            :description="view.note ?? undefined"
            :ui="{ description: 'text-pretty text-sm leading-relaxed' }"
          />
        </div>

        <template #footer>
          <span class="text-sm text-muted">Checked off</span>
          <span class="font-mono text-sm text-default">{{ checkedCount }} / {{ lines.length }}</span>
        </template>
      </UCard>

      <UCard
        variant="outline"
        :ui="{
          root: `flex min-h-0 flex-col overflow-hidden bg-elevated
                 max-lg:rounded-none max-lg:bg-default max-lg:ring-0
                 ${pane === 'steps' ? '' : 'max-lg:hidden'}`,
          header: 'flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-4 sm:px-6 lg:flex-nowrap lg:gap-x-6',
          // Scrolls itself, so a nine-line step on a phone never pushes Next
          // step off the bottom of the screen.
          body: 'flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 sm:p-0 sm:px-6 sm:py-6',
          footer: 'flex flex-none items-center justify-between gap-3 px-5 py-4 sm:px-6 lg:gap-4'
        }"
      >
        <template #header>
          <h3 class="shrink-0 text-xs font-medium uppercase tracking-wide text-dimmed">
            Step {{ steps.length ? stepIndex + 1 : 0 }} of {{ steps.length }}
          </h3>
          <!--
            The bar fills as you go rather than lighting only the current
            segment: at step seven of nine you want to see that you are nearly
            done, not one lit stripe adrift in the grey.

            Custom, replacing UProgress: that draws one value against one track,
            and this is n discrete segments where n is the number of steps —
            the count is the information, because it is also how far there is
            left to go, and a segment can carry a running timer.

            The row holds `h-7` whether or not anything is timing, and every
            segment keeps its equal share of the width. A timer starting must
            not move the bar: the geometry is what you read your position off,
            and a bar that reshuffles when a pan goes on is a bar you have to
            re-read rather than glance at.
          -->
          <div
            v-if="steps.length"
            class="flex h-7 min-w-0 flex-1 items-center gap-1.5"
            :class="anyTimerOpen ? 'max-lg:basis-full' : ''"
          >
            <!--
              One element per step, which grows into its timer rather than being
              swapped for one. The fill is the same rounded strip throughout —
              it just gets taller and takes the room for a name and a number —
              so a timer starting reads as this step opening up, not as a chip
              appearing from somewhere else.

              It takes its equal share of the width like every other segment,
              and `min-w-fit` lets it keep whatever more the reading needs. That
              nudges its neighbours a little, which is a fair price: a countdown
              you cannot read is not worth a bar that never moves.
            -->
            <div
              v-for="seg in track"
              :key="seg.id"
              class="relative flex h-full flex-1 items-center"
              :class="seg.timer ? 'min-w-fit' : 'min-w-0'"
            >
              <span
                class="w-full rounded-full transition-[height,background-color] duration-300 ease-out"
                :class="[
                  seg.timer ? 'h-full' : 'h-1',
                  seg.timer || seg.filled ? 'bg-primary' : 'bg-accented',
                  seg.timer?.done ? 'animate-pulse' : ''
                ]"
              />

              <!--
                The tap target, laid over the fill with nothing of its own to
                draw — the strip underneath is already the right shape and the
                right amber. Ghost rather than solid for exactly that reason.
              -->
              <UButton
                v-if="seg.timer"
                data-cook-pinned
                color="primary"
                variant="ghost"
                size="xs"
                class="absolute inset-0 justify-center gap-1.5 rounded-full px-2.5 text-inverted transition-opacity duration-300 hover:bg-transparent starting:opacity-0"
                @click="goTo(seg.index)"
              >
                <span class="text-xs font-medium">{{ seg.timer.name }}</span>
                <span class="inline-flex font-mono text-xs tabular-nums"><span
                  v-for="(char, slot) in countdownChars(seg.timer.left)"
                  :key="slot"
                  class="relative overflow-hidden"
                ><Transition name="tick"><span
                  :key="char"
                  class="inline-block"
                >{{ char }}</span></Transition></span></span>
              </UButton>
            </div>
          </div>
        </template>

        <template v-if="content">
          <!--
            The one serif thing on the screen. Everything around it — the
            ingredients, the timer, the tip — is interface, and interface is
            Public Sans; this is the sentence you are actually reading.

            No negative tracking, unlike every other heading here. That was
            compensating for a sans set large, and Source Serif 4 is drawn with
            its own fit — tightening it closes the counters at exactly the size
            they have to survive being read from across a kitchen.
          -->
          <p class="text-pretty font-serif text-3xl leading-[1.15] text-highlighted lg:text-4xl">
            {{ content.main }}
          </p>

          <!-- No time in the prose, no timer. A guess is not worth a button. -->
          <div v-if="duration">
            <div class="flex items-center gap-3 lg:flex-wrap">
              <UButton
                color="primary"
                :variant="timerPhase === 'finished' ? 'solid' : 'subtle'"
                size="xl"
                class="h-14 gap-2.5 max-lg:flex-1 max-lg:justify-center lg:h-16 lg:gap-5 lg:px-6"
                @click="startTimer()"
              >
                <span class="size-2.5 shrink-0 rounded-full bg-current" />
                <!--
                  "Start soak 20 min" while it is offered, then just "Soak"
                  once it is running — at that point the number beside it is
                  the sentence, and repeating how long it was is noise.
                -->
                <!--
                  One line, always. "Start soak 20 min" broken over two is the
                  button changing height between steps, which is the one thing
                  a control you aim at with the back of a wrist must not do.
                -->
                <span class="whitespace-nowrap text-base font-medium lg:text-lg">
                  {{ timerPhase === 'idle'
                    ? `Start ${duration.name ? `${duration.name.toLowerCase()} ` : ''}${duration.label}`
                    : timerPhase === 'running' ? (duration.name ?? 'Timer') : `${duration.name ?? 'Timer'} done` }}
                </span>
                <span class="h-7 w-px shrink-0 bg-current opacity-25" />
                <span class="inline-flex font-mono text-lg tabular-nums lg:text-2xl"><span
                  v-for="(char, slot) in countdownChars(remaining)"
                  :key="slot"
                  class="relative overflow-hidden"
                ><Transition name="tick"><span
                  :key="char"
                  class="inline-block"
                >{{ char }}</span></Transition></span></span>
              </UButton>

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
          <UAlert
            v-if="content.tip"
            color="neutral"
            variant="subtle"
            icon="i-lucide-lightbulb"
            :description="content.tip"
            :ui="{ description: 'whitespace-pre-line text-pretty text-base leading-[1.45] text-default' }"
          />

          <!-- What this step does differently for somebody at the table —
               drawn on the step it amends, exactly when the pan is in hand. -->
          <UAlert
            v-for="entry in (currentStep ? adaptations.byStep.value.get(currentStep.id) ?? [] : [])"
            :key="`${entry.label}:${entry.text}`"
            color="primary"
            variant="subtle"
            icon="i-lucide-utensils"
            :title="`${entry.label} — ${entry.forWho}`"
            :description="entry.text"
            :ui="{ description: 'text-pretty text-base leading-[1.45]' }"
          />

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
          <!--
            Back is an arrow on a phone and a labelled button on a laptop. It is
            the one you press by mistake, and the width it gives up goes to the
            one you meant — which on a phone runs the rest of the row, because a
            wet hand aiming at it should not have to aim.

            `sr-only` rather than hidden: the label is still the button's name
            for anything reading the screen out.
          -->
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="subtle"
            size="xl"
            label="Previous"
            :disabled="stepIndex === 0"
            class="h-14 shrink-0"
            :ui="{ label: 'sr-only lg:not-sr-only' }"
            @click="goTo(stepIndex - 1)"
          />
          <UButton
            v-if="isLastStep"
            to="/"
            color="primary"
            variant="solid"
            size="xl"
            label="Finish"
            trailing-icon="i-lucide-check"
            class="h-14 font-semibold max-lg:flex-1 max-lg:justify-center"
          />
          <UButton
            v-else
            color="neutral"
            variant="subtle"
            size="xl"
            label="Next step"
            trailing-icon="i-lucide-arrow-right"
            class="h-14 max-lg:flex-1 max-lg:justify-center"
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
    class="h-full p-6"
    :ui="{ avatar: 'size-11', title: 'text-2xl font-semibold lg:text-3xl', description: 'text-base text-muted' }"
  />
</template>
