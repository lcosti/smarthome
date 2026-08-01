<script setup lang="ts">
import type { BoardModel } from '../../utils/board'

/**
 * The card that answers the question the board exists for.
 *
 * One frame, several bodies. The header, the footer and the card itself are the
 * same in every state — only the body and the badges swap — which is what lets
 * seven derived content states share one component instead of becoming seven
 * templates that drift apart.
 *
 * When there is no meal the card stops being about food and becomes about why.
 * On a household that has not been set up that means a checklist, because the
 * honest answer is an order of operations rather than a single button; on one
 * that simply has not generated yet, it is the single button.
 */
const { hero, generating = false, sending = false } = defineProps<{
  hero: BoardModel['hero']
  generating?: boolean
  sending?: boolean
}>()

defineEmits<{
  open: []
  generate: []
  toggle: [personId: string]
  skip: []
  swap: []
  send: []
}>()

/**
 * The first thing still to do, which is the only one worth pointing at.
 *
 * -1 when everything is done, which cannot happen while this body is on screen —
 * the last step is "generate the week", and generating it replaces this body
 * with a meal.
 */
const nextStep = computed(() => hero.noMeal?.steps.findIndex(step => !step.done) ?? -1)

/**
 * Resolved rather than named as a string in `:is`.
 *
 * A checklist row is a link when the work happens elsewhere and a button when it
 * happens here, and one `<component>` renders both rather than two near-identical
 * copies of the row drifting apart.
 */
const NuxtLink = resolveComponent('NuxtLink')
</script>

<template>
  <UCard
    variant="subtle"
    class="flex min-h-0 flex-col"
    :ui="{
      header: 'flex flex-none items-center justify-between gap-3 px-6 py-4 sm:px-6',
      body: 'flex min-h-0 flex-1 flex-col overflow-y-auto p-6 sm:p-6',
      footer: 'flex flex-none flex-wrap items-center gap-3 px-6 py-4 sm:px-6'
    }"
  >
    <template #header>
      <div class="flex items-center gap-2.5">
        <h2 class="text-base font-semibold text-highlighted">
          {{ hero.eyebrow }}
        </h2>
        <UBadge
          :color="hero.hasMeal ? 'primary' : 'neutral'"
          variant="subtle"
          :label="hero.timing ?? 'Empty'"
          class="font-mono"
        />
      </div>

      <UButton
        v-if="hero.hasMeal"
        color="neutral"
        variant="ghost"
        label="Skip"
        @click="$emit('skip')"
      />
    </template>

    <!-- With a meal -->
    <div
      v-if="hero.hasMeal"
      class="flex min-w-0 flex-1 gap-6"
    >
      <!--
        The picture sits beside the text rather than above it, so a photograph
        spends width — of which the hero column has plenty — and not height.
      -->
      <div class="flex min-w-0 flex-1 flex-col gap-5">
        <div class="flex flex-col gap-2">
          <h3 class="text-pretty text-2xl font-semibold leading-[1.2] tracking-[-0.025em] text-highlighted lg:text-3xl">
            {{ hero.dish }}
          </h3>
          <div class="flex items-center gap-2 font-mono text-xs text-dimmed">
            <span>{{ hero.dishMeta }}</span>
            <span
              v-if="hero.cook"
              class="flex items-center gap-1.5"
            >
              <span>·</span>
              <BoardAvatar
                :initial="hero.cook.initial"
                :src="hero.cook.avatar"
                :hue="hero.cook.hue"
                :size="16"
                chip
              />
              {{ hero.cook.label }}
            </span>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <p class="text-xs font-medium uppercase tracking-[0.04em] text-dimmed">
            Eating tonight
          </p>
          <div class="flex flex-wrap gap-2">
            <BoardPersonChip
              v-for="person in hero.roster"
              :key="person.id"
              :person="person"
              @toggle="$emit('toggle', person.id)"
            />
          </div>
        </div>

        <!--
          The gap, not the inventory. An earlier version listed what the
          household already had; on a board whose job is to prompt action that
          read as counter-intuitive. Absent entirely when there is nothing
          outstanding, because an empty "still to buy" is not news.
        -->
        <div
          v-if="hero.toBuy.length"
          class="flex flex-col gap-2"
        >
          <p class="text-xs font-medium uppercase tracking-[0.04em] text-dimmed">
            Still to buy
          </p>
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="line in hero.toBuy"
              :key="line.name"
              color="primary"
              variant="subtle"
              class="items-baseline gap-1.5 px-2.5 text-[13px]"
            >
              {{ line.name }}
              <span
                v-if="line.qty"
                class="font-mono text-[11px] opacity-70"
              >{{ line.qty }}</span>
            </UBadge>
            <UBadge
              color="neutral"
              variant="outline"
              label="everything else in the pantry"
              class="bg-default/60 px-2.5 text-[13px] font-normal text-dimmed"
            />
          </div>
        </div>
      </div>

      <!--
        Wide screens only. The same component renders on a phone, where 200px of
        photograph beside the dish name would leave the name a column two words
        wide.
      -->
      <div
        v-if="hero.image"
        class="hidden w-[200px] shrink-0 self-stretch overflow-hidden rounded-lg bg-elevated/50 xl:block"
      >
        <RecipeImage
          :src="hero.image"
          :alt="hero.dish"
        />
      </div>
    </div>

    <!-- Without one -->
    <div
      v-else-if="hero.noMeal"
      class="flex min-w-0 flex-1 flex-col gap-5"
    >
      <div class="flex flex-col gap-2">
        <h3 class="text-pretty text-2xl font-semibold leading-[1.2] tracking-[-0.025em] text-highlighted lg:text-3xl">
          {{ hero.noMeal.title }}
        </h3>
        <p class="max-w-[520px] text-pretty text-sm leading-[1.6] text-muted">
          {{ hero.noMeal.body }}
        </p>
      </div>

      <!--
        Nothing set up yet: the checklist turns a dead end into an order of
        operations, and gives the household something to watch tick over as they
        work through it on their phones.
      -->
      <div
        v-if="hero.noMeal.steps.length"
        class="flex flex-col gap-2"
      >
        <!--
          The whole row is the target, not the badge on the end of it. On a wall
          the difference between a 700px hit area and a 50px one is the
          difference between pressing it and prodding at it, and the badge is
          there to say which step is next rather than to be aimed at.
        -->
        <component
          :is="step.to ? NuxtLink : 'button'"
          v-for="(step, index) in hero.noMeal.steps"
          :key="step.label"
          :to="step.to ?? undefined"
          :type="step.to ? undefined : 'button'"
          :disabled="step.to ? undefined : index !== nextStep"
          class="flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors
                 disabled:cursor-default"
          :class="index === nextStep
            ? 'bg-primary/10 ring ring-primary/25 hover:bg-primary/15'
            : 'ring ring-default hover:bg-elevated/50'"
          @click="step.to || $emit('generate')"
        >
          <!--
            pointer-events-none so the disabled input cannot swallow a press
            aimed at the row it sits in.
          -->
          <UCheckbox
            :model-value="step.done"
            disabled
            :ui="{ base: 'pointer-events-none size-4 rounded ring-accented disabled:opacity-100' }"
          />
          <span
            class="text-sm"
            :class="index === nextStep ? 'font-medium text-highlighted' : 'text-muted'"
          >{{ step.label }}</span>
          <UBadge
            v-if="index === nextStep"
            color="primary"
            variant="solid"
            :label="!step.to && generating ? 'Generating…' : 'Next'"
            class="ml-auto"
          />
        </component>
      </div>

      <!--
        Everybody out: the roster is the evidence for the headline, so it is
        shown rather than asserted.
      -->
      <div
        v-else-if="hero.roster.length && hero.roster.every(person => person.absent)"
        class="flex flex-wrap gap-2"
      >
        <BoardPersonChip
          v-for="person in hero.roster"
          :key="person.id"
          :person="person"
          @toggle="$emit('toggle', person.id)"
        />
      </div>
    </div>

    <template #footer>
      <!--
        `to` set means the next step is somewhere else — a roster or a library
        that has to exist before the generator can do anything. Only the
        generator's own button shows a pending label, because it is the only one
        that does work here rather than navigating away.
      -->
      <template v-if="hero.hasMeal">
        <UButton
          color="primary"
          variant="solid"
          label="Start cooking"
          trailing-icon="i-lucide-arrow-right"
          size="lg"
          @click="$emit('open')"
        />
        <UButton
          color="neutral"
          variant="subtle"
          label="Swap meal"
          size="lg"
          @click="$emit('swap')"
        />
        <UButton
          color="neutral"
          variant="ghost"
          :label="sending ? 'Sending…' : 'Send to list'"
          size="lg"
          @click="$emit('send')"
        />
        <p
          v-if="hero.startBy || hero.foot"
          class="ml-auto font-mono text-xs text-dimmed"
        >
          {{ hero.startBy ?? hero.foot }}
        </p>
      </template>

      <template v-else-if="hero.noMeal?.action">
        <UButton
          color="primary"
          variant="solid"
          :to="hero.noMeal.action.to ?? undefined"
          :label="!hero.noMeal.action.to && generating ? 'Generating…' : hero.noMeal.action.label"
          trailing-icon="i-lucide-arrow-right"
          size="lg"
          @click="hero.noMeal.action.to || $emit('generate')"
        />
        <UButton
          v-if="hero.noMeal.action.to !== '/recipes'"
          color="neutral"
          variant="subtle"
          to="/recipes"
          label="Browse recipes"
          size="lg"
        />
        <p class="ml-auto font-mono text-xs text-dimmed">
          {{ hero.noMeal.hint }}
        </p>
      </template>

      <!--
        Nobody home has no action, but the card still gets its footer: the frame
        is the same in every state, and a card that lost its bottom edge on one
        of them would look like a rendering fault.
      -->
      <p
        v-else
        class="ml-auto font-mono text-xs text-dimmed"
      >
        {{ hero.noMeal?.hint }}
      </p>
    </template>
  </UCard>
</template>
