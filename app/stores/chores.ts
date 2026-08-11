import { defineStore } from 'pinia'
import {
  choreCompletionId,
  choreOccurrencesOn,
  type ChoreOccurrence,
  type ChoreRule
} from '../utils/chores'
import type { ChoreRow } from '../utils/db'
import { plainCopy } from '../utils/sync'
import { nowIso, useSyncStore } from './sync'

/** What the editor hands back: a chore as somebody described it. */
export interface ChoreDraft {
  name: string
  personId: string | null
  /** Which shape the rest of this draft is. */
  rule: ChoreRule
  /** ISO weekdays, for a weekly rule. */
  weekdays: number[] | null
  /** Weeks between occurrences: 1 every week, 2 every other week. */
  weekInterval: number | null
  /** 'YYYY-MM-DD', the week an every-other-week rule starts in. */
  anchorDate: string | null
  /** Day of the month, 1-31, for a monthly rule by date. */
  monthDay: number | null
  /** 1-4 or -1 for last, for a monthly rule by weekday. */
  monthWeek: number | null
  /** ISO weekday paired with `monthWeek`. */
  monthWeekday: number | null
  /** 'YYYY-MM-DD' for a one-off. */
  dueDate: string | null
  /** 'HH:MM', or null for a chore with no particular time. */
  atTime: string | null
}

export const useChoresStore = defineStore('chores', () => {
  const sync = useSyncStore()

  const all = computed(() => sync.rowsOf('chores'))
  const allCompletions = computed(() => sync.rowsOf('chore_completions'))

  /** Every live chore, alphabetical — the order the settings list is read in. */
  const chores = computed(() =>
    [...all.value.values()]
      .filter(row => !row.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name))
  )

  function choreById(id: string): ChoreRow | null {
    const row = all.value.get(id)
    return row && !row.deleted_at ? row : null
  }

  /**
   * What falls on a given day, ticks resolved. Derived, never stored.
   *
   * Asks nothing of `sync.householdId`, deliberately. This used to return
   * nothing until the device had resolved which household it belongs to, which
   * made it the one read on the Today card that could come back empty while the
   * calendar, the plan and the meal beside it all rendered from the same cache —
   * a board that has plainly got its data, quietly missing its chores. The
   * household a tick is keyed on is written on the chore itself, so a device
   * that holds the chore already knows it.
   */
  function occurrencesOn(date: string): ChoreOccurrence[] {
    return choreOccurrencesOn(date, chores.value, [...allCompletions.value.values()])
  }

  /**
   * The household a chore's ticks are keyed on: the chore's own, never the
   * device's idea of which household it is in.
   *
   * They agree in every ordinary case. Where they do not — a device between
   * identities, or one that has not resolved one yet — the chore's is the answer
   * that matches the id the board derived and the id the other phone wrote.
   */
  function householdOf(choreId: string): string | null {
    return choreById(choreId)?.household_id ?? null
  }

  /**
   * Write a chore, new or edited.
   *
   * A draft has to say enough for its own rule — days for a weekly one, a day of
   * the month or an ordinal weekday for a monthly one, a date for a one-off —
   * and that is checked here rather than by the database: a check constraint
   * would classify a bad write as a permanent error, which drops it and leaves
   * the device holding a chore the server never saw. Refusing it in front of the
   * person who typed it is the version they can do something about.
   *
   * The columns belonging to the other three shapes are written null rather than
   * left alone, so a chore edited from "first Sunday" back to "Tuesdays" does not
   * keep a month rule nobody can see, waiting for the next reader that checks it
   * first.
   */
  async function saveChore(draft: ChoreDraft, id?: string): Promise<ChoreRow | null> {
    // A new chore has to be put in a household and only the device can say
    // which; an edit stays in the one it is already in, so renaming the bins
    // works on a device that has not resolved an identity yet.
    const householdId = (id ? householdOf(id) : null) ?? sync.householdId
    if (!householdId) return null

    const name = draft.name.trim()
    if (!name) return null

    const weekly = draft.rule === 'weekly'
    const monthly = draft.rule === 'monthly'
    const weekdays = weekly && draft.weekdays?.length
      ? [...draft.weekdays].sort((a, b) => a - b)
      : null
    const interval = weekly && draft.weekInterval && draft.weekInterval > 1 ? draft.weekInterval : null
    const monthDay = monthly ? draft.monthDay || null : null
    const monthWeek = monthly && !monthDay ? draft.monthWeek || null : null
    const monthWeekday = monthWeek ? draft.monthWeekday || null : null
    const dueDate = draft.rule === 'once' ? draft.dueDate || null : null

    if (weekly && !weekdays) return null
    // An interval without the week it counts from is a fortnight with no phase.
    if (interval && !draft.anchorDate) return null
    if (monthly && !monthDay && !(monthWeek && monthWeekday)) return null
    if (draft.rule === 'once' && !dueDate) return null

    const existing = id ? all.value.get(id) : undefined
    const timestamp = nowIso()
    return sync.commit('chores', {
      ...(existing ? plainCopy(existing) : {}),
      id: id ?? crypto.randomUUID(),
      household_id: householdId,
      name,
      person_id: draft.personId,
      rule: draft.rule,
      weekdays,
      week_interval: interval,
      anchor_date: interval ? draft.anchorDate || null : null,
      month_day: monthDay,
      month_week: monthWeek,
      month_weekday: monthWeekday,
      due_date: dueDate,
      at_time: draft.atTime || null,
      deleted_at: null,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    })
  }

  async function deleteChore(id: string): Promise<ChoreRow | null> {
    const existing = all.value.get(id)
    if (!existing) return null
    const timestamp = nowIso()
    return sync.commit('chores', {
      ...plainCopy(existing),
      deleted_at: timestamp,
      updated_at: timestamp
    })
  }

  /**
   * Say whether a chore has been done on a day.
   *
   * Writes a row either way rather than deleting one, for the reason attendance
   * does: two people disagreeing about the bins resolve by `updated_at` like
   * everything else, instead of one side's delete racing the other's absence.
   */
  async function setDone(choreId: string, date: string, done: boolean) {
    const householdId = householdOf(choreId)
    if (!householdId) return null

    const id = choreCompletionId(householdId, choreId, date)
    const existing = allCompletions.value.get(id)

    const timestamp = nowIso()
    return sync.commit('chore_completions', {
      ...(existing ? plainCopy(existing) : {}),
      id,
      household_id: householdId,
      chore_id: choreId,
      date,
      done,
      deleted_at: null,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    })
  }

  function isDone(choreId: string, date: string): boolean {
    const householdId = householdOf(choreId)
    if (!householdId) return false
    const row = allCompletions.value.get(choreCompletionId(householdId, choreId, date))
    return Boolean(row && !row.deleted_at && row.done)
  }

  async function toggleDone(choreId: string, date: string) {
    return setDone(choreId, date, !isDone(choreId, date))
  }

  return {
    chores,
    choreById,
    occurrencesOn,
    saveChore,
    deleteChore,
    setDone,
    isDone,
    toggleDone
  }
})
