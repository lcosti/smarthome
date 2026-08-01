<script setup lang="ts">
/**
 * What one shopping row says, inside the checkbox's own label.
 *
 * Its own component because the `#label` slot hands back only the normalised
 * item, so everything else about the row has to be looked up — and doing that
 * lookup once, here, beats repeating it for every chip in the template.
 */
const {
  label,
  quantity = null,
  source = null,
  covered = false,
  checked = false,
  grouped = false
} = defineProps<{
  label: string
  /** How much to get: "800g · 2 tins", "+ a splash". */
  quantity?: string | null
  /** The recipes behind this line, so "why is this here?" has an answer. */
  source?: string | null
  /** The pantry has all of it — neither ticked nor still to buy. */
  covered?: boolean
  checked?: boolean
  /** Several rows behind one line, so editing has to pick one of them first. */
  grouped?: boolean
}>()

const emit = defineEmits<{ edit: [] }>()
</script>

<template>
  <span class="flex items-center gap-2">
    <span class="min-w-0 flex-1">
      <span
        class="block truncate text-highlighted"
        :class="{
          'text-muted line-through': checked,
          'text-muted': covered
        }"
      >{{ label }}</span>

      <span
        v-if="quantity || source || covered"
        class="mt-1 flex flex-wrap items-center gap-1.5"
      >
        <UBadge
          v-if="quantity"
          color="neutral"
          variant="subtle"
          size="sm"
        >
          {{ quantity }}
        </UBadge>
        <!--
          The third state a checkbox has nowhere to put, said in words rather
          than drawn — which is clearer anyway. The line stays on the list
          because a plan that hid something is a plan nobody can check, and this
          is why it needs no trolley.
        -->
        <UBadge
          v-if="covered"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-package-check"
        >
          In the cupboard
        </UBadge>
        <UBadge
          v-if="source"
          color="neutral"
          variant="soft"
          size="sm"
          icon="i-lucide-book-open"
        >
          {{ source }}
        </UBadge>
      </span>
    </span>

    <!--
      .prevent stops the surrounding <label> forwarding this click on to the
      checkbox, which would tick the row you were trying to edit.
    -->
    <UButton
      :icon="grouped ? 'i-lucide-layers' : 'i-lucide-pencil'"
      color="neutral"
      variant="ghost"
      :aria-label="grouped ? `Show what makes up ${label}` : `Edit ${label}`"
      class="shrink-0 text-dimmed"
      @click.prevent.stop="emit('edit')"
    />
  </span>
</template>
