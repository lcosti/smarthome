import { defineStore } from 'pinia'
import {
  constraintId,
  isHardConstraint,
  normaliseTag,
  type ConstraintKind
} from '../utils/attendance'
import type { DietaryConstraintRow, PersonRow } from '../utils/db'
import { readIdentity } from '../utils/identity'
import { deriveLifeStage, type LifeStage } from '../utils/people'
import { plainCopy } from '../utils/sync'
import { todayIso } from '../utils/week'
import { nowIso, useSyncStore } from './sync'

/**
 * The check constraint on `kind` does not become a TypeScript union, so narrow at
 * the boundary rather than casting — same reasoning as asBaseUnit in the
 * ingredients store. An unknown kind read from a future build is treated as the
 * gentlest thing it could be, because guessing "allergy" would silently delete
 * recipes from the library's reach.
 */
export function asConstraintKind(value: string): ConstraintKind {
  if (value === 'allergy' || value === 'intolerance' || value === 'dislike' || value === 'diet') return value
  return 'preference'
}

/** Youngest last, so the adults doing the cooking are at the top of the page. */
const STAGE_ORDER: LifeStage[] = ['adult', 'child', 'toddler', 'weaning', 'baby']

export const usePeopleStore = defineStore('people', () => {
  const sync = useSyncStore()
  // A reactive today, not todayIso() inside the computed: that would only
  // re-evaluate when a row changes, never when the date does.
  const today = useToday()

  const all = computed(() => sync.rowsOf('people'))
  const allConstraints = computed(() => sync.rowsOf('dietary_constraints'))

  /** Adults first, then by name. */
  const people = computed(() => {
    const onDate = today.value
    return [...all.value.values()]
      .filter(person => !person.deleted_at)
      .sort((a, b) => {
        const byStage = STAGE_ORDER.indexOf(deriveLifeStage(a.date_of_birth, onDate))
          - STAGE_ORDER.indexOf(deriveLifeStage(b.date_of_birth, onDate))
        return byStage !== 0 ? byStage : a.name.localeCompare(b.name)
      })
  })

  const constraints = computed(() =>
    [...allConstraints.value.values()].filter(row => !row.deleted_at)
  )

  /**
   * The person this device is signed in as, if any.
   *
   * Undefined on the shared kitchen tablet, which belongs to the household rather
   * than to anybody — so callers must treat "no me" as ordinary, not as an error.
   */
  const me = computed(() => {
    const userId = readIdentity()?.userId
    if (!userId) return undefined
    return people.value.find(person => person.auth_user_id === userId)
  })

  function personById(id: string | null | undefined): PersonRow | undefined {
    if (!id) return undefined
    const person = all.value.get(id)
    return person && !person.deleted_at ? person : undefined
  }

  function lifeStageOf(id: string, onDate: string = todayIso()): LifeStage {
    return deriveLifeStage(personById(id)?.date_of_birth ?? null, onDate)
  }

  function constraintsFor(personId: string): DietaryConstraintRow[] {
    return constraints.value
      .filter(row => row.person_id === personId)
      // Hard ones first: an allergy is the thing you want to see on the row.
      .sort((a, b) => {
        const byKind = Number(isHardConstraint(b.kind)) - Number(isHardConstraint(a.kind))
        return byKind !== 0 ? byKind : a.tag.localeCompare(b.tag)
      })
  }

  /** What the generator must never violate, across everybody present. */
  function hardConstraintsFor(personIds: Iterable<string>): DietaryConstraintRow[] {
    const ids = new Set(personIds)
    return constraints.value.filter(row => ids.has(row.person_id) && isHardConstraint(row.kind))
  }

  /** What merely costs a recipe points. */
  function softConstraintsFor(personIds: Iterable<string>): DietaryConstraintRow[] {
    const ids = new Set(personIds)
    return constraints.value.filter(row => ids.has(row.person_id) && !isHardConstraint(row.kind))
  }

  /**
   * Add somebody with no login: a child, a baby, a grandparent who visits.
   *
   * Adults who sign in get their row from create_household or join_household
   * instead, which is the only path that ever links an auth user.
   */
  async function addPerson(name: string, dateOfBirth: string | null = null): Promise<PersonRow | null> {
    const trimmed = name.trim()
    if (!trimmed || !sync.householdId) return null

    const timestamp = nowIso()
    return sync.commit('people', {
      id: crypto.randomUUID(),
      household_id: sync.householdId,
      name: trimmed,
      date_of_birth: dateOfBirth || null,
      avatar: null,
      auth_user_id: null,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp
    })
  }

  async function updatePerson(
    id: string,
    patch: Partial<Pick<PersonRow, 'name' | 'date_of_birth' | 'avatar'>>
  ) {
    const current = all.value.get(id)
    if (!current) return
    const next = { ...plainCopy(current), ...patch }
    // An empty date input arrives as '', which is not a date. Null means unknown.
    if (next.date_of_birth === '') next.date_of_birth = null
    return sync.commit('people', next)
  }

  /**
   * Take somebody off the roster.
   *
   * Refuses anybody holding a login, which is where the rule the migration could
   * not enforce actually lives: a person row with auth_user_id set *is* the
   * household membership record, so soft-deleting one would be a member removing
   * another member — or themselves — with one tap and no way back in the UI.
   * Signing out is the thing they want; this is not.
   */
  async function removePerson(id: string) {
    const current = all.value.get(id)
    if (!current || current.auth_user_id) return
    return sync.commit('people', { ...plainCopy(current), deleted_at: nowIso() })
  }

  /**
   * Record something a person cannot or will not eat.
   *
   * The id is derived from (person, kind, tag), so both parents recording the
   * peanut allergy mint one row. A previously removed constraint of the same shape
   * is revived rather than duplicated — same as recordAlias.
   */
  async function addConstraint(
    personId: string,
    kind: ConstraintKind,
    tag: string
  ): Promise<DietaryConstraintRow | null> {
    const text = tag.trim()
    if (!text || !normaliseTag(text) || !sync.householdId) return null
    if (!personById(personId)) return null

    const id = constraintId(sync.householdId, personId, kind, text)
    const existing = allConstraints.value.get(id)
    if (existing && !existing.deleted_at) return existing

    const timestamp = nowIso()
    return sync.commit('dietary_constraints', {
      id,
      household_id: sync.householdId,
      person_id: personId,
      kind,
      tag: text,
      deleted_at: null,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    })
  }

  async function removeConstraint(id: string) {
    const current = allConstraints.value.get(id)
    if (!current) return
    return sync.commit('dietary_constraints', { ...plainCopy(current), deleted_at: nowIso() })
  }

  return {
    people,
    constraints,
    me,
    personById,
    lifeStageOf,
    constraintsFor,
    hardConstraintsFor,
    softConstraintsFor,
    addPerson,
    updatePerson,
    removePerson,
    addConstraint,
    removeConstraint
  }
})
