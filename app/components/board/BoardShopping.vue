<script setup lang="ts">
import type { BoardModel } from '../../utils/board'
import { chipColors } from '../../utils/person-colors'

/**
 * How much is left to buy, and the next few things.
 *
 * Three levels of information, not four. An earlier version also carried
 * per-category counts; they were the least actionable thing on the card and they
 * went. An empty list is a result worth stating in green rather than a card with
 * nothing in it.
 */
const { shopping } = defineProps<{ shopping: BoardModel['shopping'] }>()

defineEmits<{ open: [] }>()

const toastStyle = computed(() => {
  if (!shopping.recentAdd) return {}
  const colors = chipColors(shopping.recentAdd.hue)
  return { background: colors.bg, borderColor: colors.border, color: colors.text }
})
</script>

<template>
  <UCard
    variant="outline"
    :ui="{
      root: 'flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-2xl bg-elevated',
      body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0'
    }"
    class="cursor-pointer px-8 py-[22px] transition-opacity duration-[80ms] active:opacity-85"
    @click="$emit('open')"
  >
    <div class="mb-[18px] flex items-center justify-between">
      <p class="font-mono text-[21px] uppercase tracking-[0.14em] text-muted">
        Shopping
      </p>
      <p class="font-mono text-[19px] text-dimmed">
        {{ shopping.foot }}
      </p>
    </div>

    <!-- Green only when the list was cleared, never when it was never used. -->
    <UEmpty
      v-if="shopping.empty"
      :title="shopping.emptyTitle"
      :description="shopping.emptyBody"
      class="min-h-[260px] flex-1"
      :ui="{
        header: 'items-start text-left',
        title: shopping.resolved
          ? 'text-[56px] font-semibold tracking-[-0.02em] text-primary'
          : 'text-[56px] font-semibold tracking-[-0.02em] text-muted',
        description: 'text-pretty text-[24px] text-muted'
      }"
    />

    <div
      v-else
      class="flex min-h-0 flex-1 flex-col"
    >
      <div class="flex items-baseline gap-[18px]">
        <span class="text-[58px] font-semibold leading-none tracking-[-0.03em] text-highlighted">
          {{ shopping.count }}
        </span>
        <span class="text-[28px] text-muted">items</span>
      </div>

      <ul class="mt-5 flex flex-col gap-[10px]">
        <li
          v-for="item in shopping.next"
          :key="item"
          class="flex items-center gap-4"
        >
          <span class="size-2 shrink-0 rounded-full bg-accented" />
          <span class="truncate text-[26px] text-default">{{ item }}</span>
        </li>
      </ul>

      <div
        v-if="shopping.recentAdd"
        class="mt-3 flex items-center gap-3.5 rounded-xl border px-4 py-[11px]"
        :style="toastStyle"
      >
        <BoardAvatar
          :initial="shopping.recentAdd.initial"
          :hue="shopping.recentAdd.hue"
          :size="34"
          chip
        />
        <span class="truncate text-[21px]">{{ shopping.recentAdd.label }}</span>
      </div>
    </div>
  </UCard>
</template>
