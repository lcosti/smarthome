<script setup lang="ts">
/**
 * A tickable line with an action on the end of it: the shopping list, the
 * derived list, and the ingredients in cook mode are all this row.
 *
 * Not a `UCheckbox`, and this is the one place in the app where that is a
 * decision rather than an oversight. Three things rule it out:
 *
 *  - The whole row is the tap target, and the row also carries an edit button.
 *    `UCheckbox` puts its target on a `<label>`; a label wrapping a button
 *    double-fires on iOS, and a label that stops short of the button is exactly
 *    the small target this row exists to avoid. This gets tapped one-handed, in
 *    a coat, pushing a trolley.
 *  - There is a third state. `covered` means the cupboard already has it — not
 *    checked, not unchecked — and a checkbox has nowhere to put it.
 *  - `aria-pressed` says the same thing to a screen reader that `checked` would.
 *
 * min-w-0 is load-bearing. A flex item defaults to min-width:auto, which floors
 * it at its content's width, so a long ingredient name ("skinless, boneless
 * chicken thighs, each cut into 3 pieces") pushes the row wider than the screen
 * and the truncate inside never gets to do anything. The whole page then
 * scrolls sideways.
 */
const {
  state = 'unchecked',
  label,
  meta = null,
  actionIcon = null,
  actionLabel = null
} = defineProps<{
  /** `covered` is "the pantry has all of it", which is neither ticked nor not. */
  state?: 'unchecked' | 'checked' | 'covered'
  label: string
  /** The quantity/aisle/source line under the name, already joined. */
  meta?: string | null
  /** Omitted when the row has nothing to open. */
  actionIcon?: string | null
  actionLabel?: string | null
}>()

defineEmits<{
  toggle: []
  action: []
}>()

const icon = computed(() => ({
  unchecked: 'i-lucide-circle',
  checked: 'i-lucide-circle-check-big',
  covered: 'i-lucide-package-check'
}[state]))
</script>

<template>
  <li class="flex items-stretch border-b border-default last:border-b-0">
    <button
      type="button"
      :aria-pressed="state === 'checked'"
      class="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-3 pl-1 pr-2 text-left active:bg-elevated/60"
      @click="$emit('toggle')"
    >
      <UIcon
        :name="icon"
        class="size-6 shrink-0"
        :class="state === 'checked' ? 'text-primary' : 'text-dimmed'"
      />
      <span class="min-w-0 flex-1">
        <span
          class="block truncate"
          :class="{
            'text-muted line-through': state === 'checked',
            'text-muted': state === 'covered'
          }"
        >{{ label }}</span>
        <span
          v-if="meta"
          class="block truncate text-xs text-dimmed"
        >{{ meta }}</span>
      </span>
    </button>

    <UButton
      v-if="actionIcon"
      :icon="actionIcon"
      color="neutral"
      variant="ghost"
      :aria-label="actionLabel ?? undefined"
      class="self-center"
      @click="$emit('action')"
    />
  </li>
</template>
