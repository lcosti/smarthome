import { defineStore } from 'pinia'
import { choreCompletionId, choreOccurrencesOn, type ChoreOccurrence } from '../utils/chores'
import type { ChoreRow } from '../utils/db'
import { plainCopy } from '../utils/sync'
import { nowIso, useSyncStore } from './sync'

/** What the editor hands back: a chore as somebody described it. */
export interface ChoreDraft {
  name: string
  personId: string | null
  /** ISO weekdays for a weekly rule, or null for a one-off. */
  weekdays: number[] | null
  /** 'YYYY-MM-DD' for a one-off, or null for a weekly rule. */
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

  /** What falls on a given day, ticks resolved. Derived, never stored. */
  function occurrencesOn(date: string): ChoreOccurrence[] {
    if (!sync.householdId) return []
    return choreOccurrencesOn(
      date,
      chores.value,
      [...allCompletions.value.values()],
      sync.householdId
    )
  }

  /**
   * Write a chore, new or edited.
   *
   * Exactly one of `weekdays` and `dueDate` has to be set, and that is checked
   * here rather than by the database: a check constraint would classify a bad
   * write as a permanent error, which drops it and leaves the device holding a
   * chore the server never saw. Refusing it in front of the person who typed it
   * is the version they can do something about.
   */
  async function saveChore(draft: ChoreDraft, id?: string): Promise<ChoreRow | null> {
    if (!sync.householdId) return null

    const name = draft.name.trim()
    const weekdays = draft.weekdays?.length
      ? [...draft.weekdays].sort((a, b) => a - b)
      : null
    const dueDate = draft.dueDate || null
    if (!name) return null
    if (Boolean(weekdays) === Boolean(dueDate)) return null

    const existing = id ? all.value.get(id) : undefined
    const timestamp = nowIso()
    return sync.commit('chores', {
      ...(existing ? plainCopy(existing) : {}),
      id: id ?? crypto.randomUUID(),
      household_id: sync.householdId,
      name,
      person_id: draft.personId,
      weekdays,
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
    if (!sync.householdId) return null
    if (!choreById(choreId)) return null

    const id = choreCompletionId(sync.householdId, choreId, date)
    const existing = allCompletions.value.get(id)

    const timestamp = nowIso()
    return sync.commit('chore_completions', {
      ...(existing ? plainCopy(existing) : {}),
      id,
      household_id: sync.householdId,
      chore_id: choreId,
      date,
      done,
      deleted_at: null,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    })
  }

  function isDone(choreId: string, date: string): boolean {
    if (!sync.householdId) return false
    const row = allCompletions.value.get(choreCompletionId(sync.householdId, choreId, date))
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
