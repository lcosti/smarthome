<script setup lang="ts">
import { CalendarDate, type DateValue } from '@internationalized/date'
import { dayLabel, todayIso } from '../utils/week'

/**
 * A date, picked from a calendar the app drew.
 *
 * `UInput type="date"` was here and is a stock component, so this is not the
 * house rule being enforced — it is the one control in the app the browser
 * renders itself. Chromium's picker comes up in the operating system's colours
 * against a form that is dark, sizes itself in the OS's units, and says
 * "10/08/2026" in a house that writes "Mon 10 Aug" everywhere else. `UCalendar`
 * is the library's answer and it was already installed; all it wanted was
 * `@internationalized/date`, its optional peer.
 *
 * The value stays a plain 'YYYY-MM-DD' string on the way in and out, because
 * that is what every date in this app is — a calendar fact with no instant
 * behind it, the same shape the columns hold and `dayLabel` and `isoWeekday`
 * read. `CalendarDate` lives inside this component and goes no further.
 */
const model = defineModel<string>({ required: true })

const { placeholder = 'Pick a date' } = defineProps<{
  /** What the button says with no date chosen yet. */
  placeholder?: string
}>()

const open = ref(false)

/** 'YYYY-MM-DD' -> the calendar's own type, and back. */
function toCalendar(iso: string): CalendarDate | null {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return null
  return new CalendarDate(year, month, day)
}

function toIso(date: DateValue): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

const value = computed({
  get: () => (model.value ? toCalendar(model.value) : null),
  set: (date: DateValue | null) => {
    model.value = date ? toIso(date) : ''
    // A date is one press and the task is over, so the calendar closes on it.
    open.value = false
  }
})

/**
 * "Mon 10 Aug", the way every other date in the app is written, with the year
 * added only when it is not this one — a chore starting next week does not need
 * telling which year that is, and one in January does.
 */
const label = computed(() => {
  if (!model.value) return placeholder
  const written = dayLabel(model.value)
  const year = model.value.slice(0, 4)
  return year === todayIso().slice(0, 4) ? written : `${written} ${year}`
})
</script>

<template>
  <UPopover v-model:open="open">
    <UButton
      color="neutral"
      variant="subtle"
      size="lg"
      block
      class="justify-start"
      icon="i-lucide-calendar"
      :label="label"
      :class="model ? undefined : 'text-dimmed'"
    />

    <template #content>
      <!--
        Monday first, as the week is read everywhere else in the app — the
        chore editor's own Days row, the plan's grid, `isoWeekday`. The
        library's default is Sunday.
      -->
      <UCalendar
        v-model="value"
        :week-starts-on="1"
        class="p-2"
      />
    </template>
  </UPopover>
</template>
