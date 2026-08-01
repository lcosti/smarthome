<script setup lang="ts">
import { personColors } from '../../utils/person-colors'

/**
 * A person: their face when there is one, their initial in their own colour
 * when there is not.
 *
 * A `UAvatar` throughout — this is the one place that knows a person's pixel
 * size and their generated hue, and everything else is the component's own.
 * Sized in pixels rather than by Nuxt UI's size tokens because the board is one
 * fixed 1280×800 frame with a handful of avatar sizes drawn into it, and the
 * token scale does not have a 45px step.
 *
 * The picture is a data URL held on the person's row rather than an address, so
 * it needs no network and cannot 404 — see the migration that added the column.
 * `UAvatar` falls back to the initial on its own if one ever fails to decode,
 * and the ring and the tint are the person's colour either way, so a household
 * where two people have photographs and two do not still reads as one set of
 * people.
 */
const { initial, hue, size, src = null, absent = false, chip = false } = defineProps<{
  initial: string
  hue: number
  size: number
  /** The person's photograph, or null for their initial. */
  src?: string | null
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
  // A 2px ring around a 24px circle is a doughnut. Below the roster sizes the
  // ring thins to a hairline and the fill does the identifying.
  border: `${size >= 32 ? 2 : 1}px solid ${chip && !absent ? `oklch(0.76 0.13 ${hue})` : colors.value.ring}`,
  opacity: absent ? '0.45' : '1'
}))
</script>

<template>
  <UAvatar
    :src="src ?? undefined"
    :alt="initial"
    :text="initial"
    :style="style"
    :ui="{
      root: 'shrink-0 rounded-full font-semibold',
      image: 'rounded-full object-cover',
      fallback: 'text-[length:inherit] font-semibold leading-none'
    }"
  />
</template>
