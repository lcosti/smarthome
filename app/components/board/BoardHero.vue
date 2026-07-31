<script setup lang="ts">
import type { BoardModel } from '../../utils/board'
import { chipColors } from '../../utils/person-colors'

/**
 * The card that answers the question the board exists for.
 *
 * Two treatments of the same facts. Dish-led leads with what is being cooked and
 * lets the roster explain who it is for; roster-led leads with who is eating and
 * closes on the dish. The headline sizes differ on purpose — 42px when it shares
 * the top of the card with its meta and the whole roster, 68px when it is the
 * closing statement with air around it. They are not the same thing at two sizes.
 *
 * When there is no meal the card stops being about food and becomes about why,
 * with at most one action: generating a plan. That is the only filled button on
 * the entire board, because "no plan" is the only state with one obvious next move.
 */
const { hero, rosterLed, generating = false } = defineProps<{
  hero: BoardModel['hero']
  rosterLed: boolean
  generating?: boolean
}>()

defineEmits<{ open: [], generate: [], toggle: [personId: string] }>()

const cookStyle = computed(() => {
  if (!hero.cook) return {}
  const colors = chipColors(hero.cook.hue)
  return { background: colors.bg, borderColor: colors.border, color: colors.text }
})
</script>

<template>
  <UCard
    variant="outline"
    :ui="{
      root: 'flex min-h-0 flex-col rounded-2xl bg-elevated',
      body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0'
    }"
    class="px-11 py-10 transition-opacity duration-[80ms]"
  >
    <div class="flex items-center justify-between">
      <p class="font-mono text-[21px] uppercase tracking-[0.14em] text-muted">
        {{ hero.eyebrow }}
      </p>

      <div
        v-if="hero.hasMeal"
        class="flex items-center gap-3"
      >
        <div
          v-if="hero.cook"
          class="flex items-center gap-3 rounded-full border py-[7px] pl-2 pr-[22px]"
          :style="cookStyle"
        >
          <BoardAvatar
            :initial="hero.cook.initial"
            :hue="hero.cook.hue"
            :size="38"
            chip
          />
          <span class="text-[22px]">{{ hero.cook.label }}</span>
        </div>

        <UBadge
          v-if="hero.timing"
          color="neutral"
          variant="soft"
          :ui="{ base: 'rounded-full px-[22px] py-[10px] text-[22px] ring-1 ring-default' }"
        >
          {{ hero.timing }}
        </UBadge>
      </div>
    </div>

    <!-- With a meal -->
    <div
      v-if="hero.hasMeal"
      class="mt-[26px] flex min-h-0 flex-1 flex-col"
    >
      <p
        v-if="rosterLed"
        class="mb-[22px] text-[40px] font-medium text-muted"
      >
        {{ hero.eatingCount }}
      </p>

      <template v-else>
        <h2 class="mb-[14px] text-balance text-[42px] font-semibold leading-[1.02] tracking-[-0.025em] text-highlighted">
          {{ hero.dish }}
        </h2>
        <p class="mb-[38px] text-[28px] text-muted">
          {{ hero.dishMeta }}
        </p>
      </template>

      <div class="flex flex-col gap-[10px]">
        <BoardRosterRow
          v-for="person in hero.roster"
          :key="person.id"
          :person="person"
          @toggle="$emit('toggle', person.id)"
        />
      </div>

      <div
        v-if="rosterLed"
        class="mt-auto pt-6"
      >
        <h2 class="text-balance text-[68px] font-semibold leading-[1.05] tracking-[-0.025em] text-highlighted">
          {{ hero.dish }}
        </h2>
        <p class="mt-3 text-[26px] text-muted">
          {{ hero.dishMeta }}
        </p>
      </div>

      <button
        v-else
        type="button"
        class="mt-auto flex items-center gap-[14px] pt-6 font-mono text-[20px]
               text-dimmed transition-opacity duration-[80ms] active:opacity-85"
        @click="$emit('open')"
      >
        <span class="size-[9px] rounded-full bg-accented" />
        {{ hero.foot }}
      </button>
    </div>

    <!-- Without one -->
    <div
      v-else-if="hero.noMeal"
      class="flex min-h-0 flex-1 flex-col justify-center"
    >
      <h2 class="max-w-[15ch] text-balance text-[82px] font-semibold leading-[1.02] tracking-[-0.03em] text-highlighted">
        {{ hero.noMeal.title }}
      </h2>
      <p class="mt-[22px] max-w-[32ch] text-pretty text-[28px] leading-[1.4] text-muted">
        {{ hero.noMeal.body }}
      </p>

      <!--
        Nothing set up yet: the checklist turns a dead end into an order of
        operations, and gives the household something to watch tick over as they
        work through it on their phones.
      -->
      <ul
        v-if="hero.noMeal.steps.length"
        class="mt-[38px] flex flex-col gap-3"
      >
        <li
          v-for="step in hero.noMeal.steps"
          :key="step.label"
          class="flex items-center gap-4 text-[26px]"
          :class="step.done ? 'text-muted' : 'text-highlighted'"
        >
          <!--
            Two elements with literal names rather than one with a bound name:
            Nuxt Icon builds its client bundle from the names it can see in the
            source, so a dynamic one is simply absent at runtime and renders as
            a silent gap.
          -->
          <UIcon
            v-if="step.done"
            name="i-lucide-circle-check-big"
            class="size-7 shrink-0 text-primary"
          />
          <UIcon
            v-else
            name="i-lucide-circle-dashed"
            class="size-7 shrink-0 text-dimmed"
          />
          <span :class="step.done ? 'line-through' : ''">{{ step.label }}</span>
        </li>
      </ul>

      <!--
        Everybody out: the compact roster is the evidence for the headline, so it
        is shown rather than asserted.
      -->
      <div
        v-else-if="hero.roster.length && hero.roster.every(person => person.absent)"
        class="mt-[38px] flex gap-4"
      >
        <div
          v-for="person in hero.roster"
          :key="person.id"
          class="flex items-center gap-4 rounded-[14px] border border-default bg-default py-4 pl-4 pr-[22px]"
        >
          <BoardAvatar
            :initial="person.initial"
            :hue="person.hue"
            :size="60"
            absent
          />
          <div>
            <p class="text-[24px] font-medium text-dimmed line-through">
              {{ person.name }}
            </p>
            <p class="mt-1 text-[20px] text-dimmed">
              {{ person.note }}
            </p>
          </div>
        </div>
      </div>

      <!--
        `to` set means the next step is somewhere else — a roster or a library
        that has to exist before the generator can do anything. Only the
        generator's own button shows the pending label, because it is the only
        one that does work here rather than navigating away.
      -->
      <UButton
        v-if="hero.noMeal.action"
        color="warning"
        variant="solid"
        :to="hero.noMeal.action.to ?? undefined"
        :label="!hero.noMeal.action.to && generating ? 'Generating…' : hero.noMeal.action.label"
        class="mt-11 h-[84px] self-start rounded-[14px] px-11 text-[30px] font-semibold"
        @click="hero.noMeal.action.to || $emit('generate')"
      />
    </div>
  </UCard>
</template>
