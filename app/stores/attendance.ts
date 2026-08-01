import { defineStore } from 'pinia'
import {
  attendanceId,
  awayPeople,
  isPresent as isPresentIn,
  nightsPresent as nightsPresentIn,
  presentPeople
} from '../utils/attendance'
import type { AttendanceRow, PersonRow } from '../utils/db'
import { plainCopy } from '../utils/sync'
import { nowIso, useSyncStore } from './sync'
import { usePeopleStore } from './people'

/** The only meal the app writes today, matching meal_plan_entries. */
export const DEFAULT_MEAL = 'dinner'

export const useAttendanceStore = defineStore('attendance', () => {
  const sync = useSyncStore()
  const peopleStore = usePeopleStore()

  const all = computed(() => sync.rowsOf('attendance'))
  const rows = computed(() => [...all.value.values()])

  function isPresent(personId: string, date: string, meal: string = DEFAULT_MEAL): boolean {
    return isPresentIn(personId, date, meal, rows.value)
  }

  /** How many of a week's nights somebody is eating here — the roster's count. */
  function nightsPresent(
    personId: string,
    dates: Iterable<string>,
    meal: string = DEFAULT_MEAL
  ): number {
    return nightsPresentIn(personId, dates, meal, rows.value)
  }

  /** Everybody eating that night — the generator's input, and the editor's chips. */
  function presentOn(date: string, meal: string = DEFAULT_MEAL): PersonRow[] {
    return presentPeople(peopleStore.people, rows.value, date, meal)
  }

  /** Only who is out, which is the shorter list and the one worth showing. */
  function awayOn(date: string, meal: string = DEFAULT_MEAL): PersonRow[] {
    return awayPeople(peopleStore.people, rows.value, date, meal)
  }

  /**
   * Say whether somebody is eating on a given night.
   *
   * Writes a row even when marking them present, rather than deleting one. That
   * costs a row nobody strictly needs, and buys the thing that matters: two
   * devices disagreeing about one night resolve by `updated_at` like everything
   * else, instead of one side's delete racing the other side's absence.
   */
  async function setPresence(
    personId: string,
    date: string,
    present: boolean,
    meal: string = DEFAULT_MEAL
  ): Promise<AttendanceRow | null> {
    if (!sync.householdId) return null
    if (!peopleStore.personById(personId)) return null

    const id = attendanceId(sync.householdId, personId, date, meal)
    const existing = all.value.get(id)

    const timestamp = nowIso()
    return sync.commit('attendance', {
      ...(existing ? plainCopy(existing) : {}),
      id,
      household_id: sync.householdId,
      person_id: personId,
      date,
      meal,
      present,
      // A row that was soft-deleted and is now being set again comes back.
      deleted_at: null,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    })
  }

  async function togglePresence(personId: string, date: string, meal: string = DEFAULT_MEAL) {
    return setPresence(personId, date, !isPresent(personId, date, meal), meal)
  }

  return {
    isPresent,
    nightsPresent,
    presentOn,
    awayOn,
    setPresence,
    togglePresence
  }
})
