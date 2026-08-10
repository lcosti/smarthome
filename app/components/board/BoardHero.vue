<script setup lang="ts">
import { NuxtLink } from '#components'
import type { BoardModel } from '../../utils/board'

/**
 * Tonight's dinner, beside the day rather than instead of it.
 *
 * This used to be the whole board — a wide hero carrying the meal, the roster,
 * what was still to buy, and four buttons. The calendar has that space now, and
 * what is left is the answer to one question: what is for dinner, and can I
 * start it. What the card dropped still exists where it belongs — who is eating
 * is the plan's roll-call, and what to buy is the list.
 *
 * One frame, two bodies: a meal, or the reason there is not one. When there is
 * no meal the card stops being about food and becomes about why — on a household
 * that has not been set up that means a checklist, because the honest answer is
 * an order of operations rather than a single button.
 *
 * The picture leads on a phone and follows the heading on a wide screen. Same
 * card, same fields: a phone is scrolled from the top, so the photograph is what
 * earns the scroll, while the wall board is read at a glance and wants the word
 * "Tonight" first.
 */
const { hero } = defineProps<{
  hero: BoardModel['hero']
}>()

defineEmits<{ open: [], skip: [], swap: [] }>()

const isWide = useWide()

/**
 * The first thing still to do, which is the only one worth pointing at.
 *
 * -1 when everything is done, which cannot happen while this body is on screen —
 * the last step is planning the week, and a planned week replaces this body with
 * a meal.
 */
const nextStep = computed(() => hero.noMeal?.steps.findIndex(step => !step.done) ?? -1)
</script>

<template>
  <UCard
    variant="subtle"
    :ui="{
      header: 'flex flex-none items-center justify-between gap-3 px-5 py-3.5',
      body: 'flex min-h-0 flex-col p-0 sm:p-0'
    }"
    class="flex flex-none flex-col"
  >
    <template
      v-if="isWide"
      #header
    >
      <div class="flex min-w-0 items-center gap-2.5">
        <h2 class="truncate text-base font-semibold text-highlighted">
          {{ hero.eyebrow }}
        </h2>
        <UBadge
          :color="hero.hasMeal ? 'primary' : 'neutral'"
          variant="subtle"
          class="font-mono"
          :label="hero.timing ?? 'Empty'"
        />
      </div>
      <!--
        "Clear", not "Skip". Skipping a night is now a thing the plan can record
        — a takeaway, a meal out — and this button does the other thing: it takes
        tonight off the plan altogether and leaves the night empty. Two buttons
        called Skip that do opposite things is worse than a plainer word.
      -->
      <UButton
        v-if="hero.hasMeal"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-x"
        label="Clear"
        @click="$emit('skip')"
      />
    </template>

    <!-- Tonight is planned. -->
    <template v-if="hero.hasMeal">
      <!--
        Only when there is one. `RecipeImage` renders nothing rather than a
        broken frame, so reserving the space unconditionally would leave a hole
        the height of a photograph on every recipe that has not got one — and on
        a wide screen that hole is taken straight out of the shopping list below.
      -->
      <div
        v-if="hero.image"
        class="aspect-[16/10] w-full shrink-0 overflow-hidden bg-elevated/50 lg:max-h-40"
      >
        <RecipeImage
          :src="hero.image"
          :alt="hero.dish"
          class="size-full object-cover"
        />
      </div>

      <div class="flex flex-col gap-3 px-5 pb-5 pt-4">
        <div
          v-if="!isWide"
          class="flex items-center gap-2.5"
        >
          <span class="text-xs font-medium uppercase tracking-[0.06em] text-dimmed">
            {{ hero.eyebrow }}
          </span>
          <UBadge
            color="primary"
            variant="subtle"
            class="font-mono"
            :label="hero.timing ?? ''"
          />
        </div>

        <h3 class="text-2xl font-semibold leading-tight text-highlighted">
          {{ hero.dish }}
        </h3>

        <!--
          Three facts, each with its own mark, rather than one run-on line of
          middots: on a phone this is the row read at arm's length.
        -->
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span
            v-if="hero.minutes"
            class="flex items-center gap-1.5"
          >
            <UIcon
              name="i-lucide-clock"
              class="size-4 text-dimmed"
            />
            {{ hero.minutes }} min
          </span>
          <span
            v-if="hero.servings"
            class="flex items-center gap-1.5"
          >
            <UIcon
              name="i-lucide-users"
              class="size-4 text-dimmed"
            />
            {{ hero.servings }}
          </span>
          <UBadge
            v-if="hero.cook"
            color="neutral"
            variant="subtle"
            size="lg"
            class="gap-1.5 rounded-full ps-1"
          >
            <BoardAvatar
              :initial="hero.cook.initial"
              :hue="hero.cook.hue"
              :src="hero.cook.avatar"
              :size="20"
              chip
            />
            {{ hero.cook.name }}
          </UBadge>
        </div>

        <!--
          A night nobody is cooking on has nothing to start: no recipe, no
          method, nothing behind the button. What it offers instead is the way
          out of it — pick a dinner after all — which is the same action Swap
          performs, promoted to being the only one.
        -->
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <UButton
            v-if="hero.recipeId"
            size="lg"
            icon="i-lucide-chef-hat"
            label="Start cooking"
            class="flex-1 justify-center"
            @click="$emit('open')"
          />
          <UButton
            v-if="isWide || !hero.recipeId"
            :color="hero.recipeId ? 'neutral' : 'primary'"
            :variant="hero.recipeId ? 'subtle' : 'solid'"
            size="lg"
            icon="i-lucide-refresh-cw"
            :label="hero.recipeId ? 'Swap' : 'Plan a dinner'"
            :class="hero.recipeId ? '' : 'flex-1 justify-center'"
            @click="$emit('swap')"
          />
        </div>

        <p
          v-if="isWide && hero.startBy"
          class="font-mono text-xs text-dimmed"
        >
          {{ hero.startBy }}
        </p>
      </div>
    </template>

    <!-- Nothing planned: whatever the household has to do about it. -->
    <div
      v-else-if="hero.noMeal"
      class="flex flex-col gap-4 p-5"
    >
      <div
        v-if="!isWide"
        class="text-xs font-medium uppercase tracking-[0.06em] text-dimmed"
      >
        {{ hero.eyebrow }}
      </div>

      <div class="flex flex-col gap-1.5">
        <h3 class="text-xl font-semibold leading-tight text-highlighted">
          {{ hero.noMeal.title }}
        </h3>
        <p class="text-sm leading-[1.6] text-muted">
          {{ hero.noMeal.body }}
        </p>
      </div>

      <!--
        The setup checklist. Every step is a page to open, so every row is a link
        and the badge marks which one to open first.
      -->
      <div
        v-if="hero.noMeal.steps.length"
        class="flex flex-col gap-1.5"
      >
        <NuxtLink
          v-for="(step, index) in hero.noMeal.steps"
          :key="step.label"
          :to="step.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left"
          :class="index === nextStep
            ? 'bg-primary/10 ring ring-primary/25'
            : 'ring ring-default'"
        >
          <UCheckbox
            :model-value="step.done"
            disabled
            class="pointer-events-none"
          />
          <span
            class="flex-1 truncate text-sm"
            :class="step.done ? 'text-dimmed line-through' : 'text-highlighted'"
          >{{ step.label }}</span>
          <UBadge
            v-if="index === nextStep"
            color="primary"
            size="sm"
            label="Next"
          />
        </NuxtLink>
      </div>

      <UButton
        v-if="hero.noMeal.action"
        size="lg"
        :to="hero.noMeal.action.to"
        :label="hero.noMeal.action.label"
        class="justify-center"
        trailing-icon="i-lucide-arrow-right"
      />
    </div>
  </UCard>
</template>
