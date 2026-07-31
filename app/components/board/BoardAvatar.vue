<script setup lang="ts">
import { personColors } from '../../utils/person-colors'

/**
 * A person's initial in their own colour.
 *
 * Sized in pixels rather than by Nuxt UI's size tokens: the board is one fixed
 * 1920×1200 frame with four avatar sizes drawn into it, and the token scale does
 * not have a 68px step. Everything else — the ring, the fill, the ink — comes
 * from the hue, so a fifth household member needs no work here at all.
 */
const { initial, hue, size, absent = false, chip = false } = defineProps<{
  initial: string
  hue: number
  size: number
  absent?: boolean
  /** Chips carry a slightly brighter ring than a roster row does. */
  chip?: boolean
}>()

const colors = computed(() => personColors(hue, { absent }))

const style = computed(() => ({
  width: `${size}px`,
  height: `${size}px`,
  fontSize: `${Math.round(size * 0.44)}px`,
  background: colors.value.tint,
  color: colors.value.ink,
  border: `2px solid ${chip && !absent ? `oklch(0.76 0.13 ${hue})` : colors.value.ring}`,
  opacity: absent ? '0.45' : '1'
}))
</script>

<template>
  <UAvatar
    :text="initial"
    :style="style"
    :ui="{
      root: 'shrink-0 rounded-full font-semibold',
      fallback: 'text-[length:inherit] font-semibold leading-none'
    }"
  />
</template>
