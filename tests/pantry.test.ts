import { describe, expect, it } from 'vitest'
import type { PantryItemRow, PantryReservationRow, PlanEntryRow, RecipeIngredientRow, RecipeRow } from '../app/utils/db'
import {
  derivePantryReservations,
  lineNeedBase,
  pantryAvailable,
  pantryItemId,
  pantryOnHand,
  pantryReservationId,
  settleDuePantry
} from '../app/utils/pantry'
import type { BaseUnit, PurchaseUnit } from '../app/utils/quantity'

const HOUSEHOLD = 'house-1'
const STAMP = '2026-07-01T00:00:00.000Z'
const NOW = '2026-08-03T09:00:00.000Z'

/** Onions are counted, tomatoes are weighed. Enough to exercise both paths. */
const BASE_UNITS: Record<string, BaseUnit> = { onion: 'count', tom: 'g' }
const UNITS: Record<string, PurchaseUnit[]> = { tom: [{ name: 'tin', amount: 400 }] }

const baseUnitOf = (id: string): BaseUnit => BASE_UNITS[id] ?? 'count'
const purchaseUnitsOf = (id: string): PurchaseUnit[] => UNITS[id] ?? []

function recipe(extra: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: 'r-1',
    household_id: HOUSEHOLD,
    name: 'Chilli',
    source_url: null,
    image_url: null,
    base_servings: 4,
    prep_minutes: null,
    cook_minutes: null,
    method: null,
    tags: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra
  } as RecipeRow
}

function line(extra: Partial<RecipeIngredientRow> = {}): RecipeIngredientRow {
  return {
    id: 'l-1',
    household_id: HOUSEHOLD,
    recipe_id: 'r-1',
    ingredient_id: 'onion',
    name: 'Onions',
    quantity: '2',
    aisle_id: null,
    sort_order: 0,
    optional: false,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra
  } as RecipeIngredientRow
}

function entry(extra: Partial<PlanEntryRow> = {}): PlanEntryRow {
  return {
    id: 'e-1',
    household_id: HOUSEHOLD,
    date: '2026-08-05',
    meal: 'dinner',
    recipe_id: 'r-1',
    servings: 4,
    note: null,
    cook_person_id: null,
    eat_time: null,
    leftover_of_entry_id: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra
  } as PlanEntryRow
}

function stock(ingredientId: string, onHand: number, extra: Partial<PantryItemRow> = {}): PantryItemRow {
  return {
    id: pantryItemId(HOUSEHOLD, ingredientId),
    household_id: HOUSEHOLD,
    ingredient_id: ingredientId,
    on_hand: onHand,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra
  }
}

function reservation(extra: Partial<PantryReservationRow> = {}): PantryReservationRow {
  const planEntryId = extra.plan_entry_id ?? 'e-1'
  const ingredientId = extra.ingredient_id ?? 'onion'
  return {
    id: pantryReservationId(planEntryId, ingredientId),
    household_id: HOUSEHOLD,
    plan_entry_id: planEntryId,
    ingredient_id: ingredientId,
    amount: 2,
    date: '2026-08-05',
    settled_at: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra
  }
}

function reserve(overrides: Partial<Parameters<typeof derivePantryReservations>[0]> = {}) {
  return derivePantryReservations({
    householdId: HOUSEHOLD,
    start: '2026-08-03',
    end: '2026-08-09',
    entries: [entry()],
    recipes: new Map([['r-1', recipe()]]),
    ingredients: [line()],
    reservations: [],
    resolveIngredientId: l => l.ingredient_id,
    baseUnitOf,
    purchaseUnitsOf,
    now: NOW,
    ...overrides
  })
}

describe('pantry ids', () => {
  it('always mints the same id for the same facts', () => {
    // The whole reason there is no unique constraint on either table: two devices
    // recording the same thing offline have to converge on one row.
    expect(pantryItemId(HOUSEHOLD, 'onion')).toBe(pantryItemId(HOUSEHOLD, 'onion'))
    expect(pantryReservationId('e-1', 'onion')).toBe(pantryReservationId('e-1', 'onion'))
  })

  it('keeps different facts apart', () => {
    expect(pantryItemId(HOUSEHOLD, 'onion')).not.toBe(pantryItemId(HOUSEHOLD, 'tom'))
    expect(pantryItemId(HOUSEHOLD, 'onion')).not.toBe(pantryItemId('house-2', 'onion'))
    expect(pantryReservationId('e-1', 'onion')).not.toBe(pantryReservationId('e-2', 'onion'))
    // And a pantry row is never mistaken for a reservation on the same ingredient.
    expect(pantryItemId(HOUSEHOLD, 'onion')).not.toBe(pantryReservationId(HOUSEHOLD, 'onion'))
  })
})

describe('lineNeedBase', () => {
  it('reads a quantity in the ingredient own base unit', () => {
    expect(lineNeedBase('2', 'count')).toBe(2)
    expect(lineNeedBase('400g', 'g')).toBe(400)
    expect(lineNeedBase('2 tins', 'g', UNITS.tom)).toBe(800)
  })

  it('gives up rather than guessing', () => {
    // "A splash" counting as zero would quietly make a recipe look cookable.
    expect(lineNeedBase('a splash', 'ml')).toBe(null)
    expect(lineNeedBase(null, 'count')).toBe(null)
    expect(lineNeedBase('400', 'g')).toBe(null)
    expect(lineNeedBase('0', 'count')).toBe(null)
  })

  it('follows the servings hint derive writes', () => {
    expect(lineNeedBase('400g ×1.5', 'g')).toBe(600)
  })
})

describe('derivePantryReservations', () => {
  it('reserves what a planned night needs', () => {
    const { upserts, releases } = reserve()
    expect(releases).toHaveLength(0)
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      id: pantryReservationId('e-1', 'onion'),
      plan_entry_id: 'e-1',
      ingredient_id: 'onion',
      amount: 2,
      date: '2026-08-05',
      settled_at: null,
      deleted_at: null
    })
  })

  it('writes nothing the second time, which is the whole point', () => {
    const first = reserve()
    const again = reserve({ reservations: first.upserts })
    expect(again.upserts).toHaveLength(0)
    expect(again.releases).toHaveLength(0)
  })

  it('scales with the servings the night is cooked for', () => {
    const { upserts } = reserve({ entries: [entry({ servings: 6 })] })
    // 4 serves the recipe, 6 are eating: 2 onions becomes 3.
    expect(upserts[0]?.amount).toBe(3)
  })

  it('takes a leftovers night off the shelf with the night that cooks it', () => {
    // Four at the table Wednesday and two more finishing it Thursday: six
    // portions off a recipe for four, so 2 onions becomes 3 — reserved once,
    // dated to the cooking, because that is the day the shelf actually empties.
    const { upserts } = reserve({
      entries: [
        entry(),
        entry({ id: 'e-2', date: '2026-08-06', servings: 2, leftover_of_entry_id: 'e-1' })
      ]
    })

    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      id: pantryReservationId('e-1', 'onion'),
      amount: 3,
      date: '2026-08-05'
    })
  })

  it('gives the portions back when the leftovers night goes', () => {
    const leftovers = entry({ id: 'e-2', date: '2026-08-06', servings: 2, leftover_of_entry_id: 'e-1' })
    const first = reserve({ entries: [entry(), leftovers] })

    const after = reserve({
      entries: [entry(), { ...leftovers, deleted_at: NOW }],
      reservations: first.upserts
    })

    expect(after.releases).toHaveLength(0)
    expect(after.upserts).toHaveLength(1)
    // The same row, shrunk back — not a second reservation against the same food.
    expect(after.upserts[0]?.id).toBe(first.upserts[0]?.id)
    expect(after.upserts[0]?.amount).toBe(2)
  })

  it('sums two lines of one recipe naming the same ingredient', () => {
    const { upserts } = reserve({
      ingredients: [line(), line({ id: 'l-2', name: 'Onion, to garnish', quantity: '1' })]
    })
    expect(upserts).toHaveLength(1)
    expect(upserts[0]?.amount).toBe(3)
  })

  it('reserves nothing for a line no arithmetic can read', () => {
    const { upserts } = reserve({ ingredients: [line({ quantity: 'a handful' })] })
    expect(upserts).toHaveLength(0)
  })

  it('reserves nothing for a line with no canonical ingredient', () => {
    const { upserts } = reserve({ resolveIngredientId: () => null })
    expect(upserts).toHaveLength(0)
  })

  it('gives the stock back when the night comes off the plan', () => {
    const held = reservation()
    const { upserts, releases } = reserve({ entries: [entry({ deleted_at: NOW })], reservations: [held] })
    expect(upserts).toHaveLength(0)
    expect(releases).toHaveLength(1)
    expect(releases[0]?.deleted_at).toBe(NOW)
  })

  it('follows a night that changed size', () => {
    const held = reservation({ amount: 2 })
    const { upserts } = reserve({ entries: [entry({ servings: 8 })], reservations: [held] })
    expect(upserts).toHaveLength(1)
    expect(upserts[0]?.amount).toBe(4)
  })

  it('follows a night that moved to another day in the week', () => {
    const held = reservation({ date: '2026-08-05' })
    const { upserts } = reserve({ entries: [entry({ date: '2026-08-07' })], reservations: [held] })
    expect(upserts[0]?.date).toBe('2026-08-07')
  })

  it('never touches a settled reservation', () => {
    // Its night has been eaten and its stock has already come off. Rewriting it
    // would either double-spend or resurrect food.
    const settled = reservation({ settled_at: NOW, amount: 99 })
    const { upserts, releases } = reserve({ reservations: [settled] })
    expect(upserts).toHaveLength(0)
    expect(releases).toHaveLength(0)
  })

  it('leaves another week alone', () => {
    const other = reservation({
      plan_entry_id: 'e-9',
      id: pantryReservationId('e-9', 'onion')
    })
    const { releases } = reserve({
      entries: [entry(), entry({ id: 'e-9', date: '2026-09-01' })],
      reservations: [other]
    })
    expect(releases).toHaveLength(0)
  })

  it('releases a reservation whose plan entry has vanished entirely', () => {
    // Not merely out of range — gone. Leaving it would hold stock forever.
    const orphan = reservation({ plan_entry_id: 'e-gone', id: pantryReservationId('e-gone', 'onion') })
    const { releases } = reserve({ reservations: [orphan] })
    expect(releases.map(r => r.id)).toEqual([pantryReservationId('e-gone', 'onion')])
  })

  it('revives a released reservation when the night comes back', () => {
    const released = reservation({ deleted_at: NOW })
    const { upserts } = reserve({ reservations: [released] })
    expect(upserts).toHaveLength(1)
    expect(upserts[0]?.deleted_at).toBe(null)
  })
})

describe('settleDuePantry', () => {
  const settle = (overrides: Partial<Parameters<typeof settleDuePantry>[0]> = {}) =>
    settleDuePantry({
      today: '2026-08-10',
      reservations: [reservation({ date: '2026-08-05', amount: 2 })],
      pantryByIngredient: new Map([['onion', stock('onion', 5)]]),
      now: NOW,
      ...overrides
    })

  it('takes a passed night off the shelf, once', () => {
    const { pantryUpdates, settled } = settle()
    expect(pantryUpdates).toHaveLength(1)
    expect(pantryUpdates[0]?.on_hand).toBe(3)
    expect(settled[0]?.settled_at).toBe(NOW)
  })

  it('does nothing the second time', () => {
    const first = settle()
    const again = settle({ reservations: first.settled })
    expect(again.pantryUpdates).toHaveLength(0)
    expect(again.settled).toHaveLength(0)
  })

  it('leaves nights still to come alone', () => {
    const { pantryUpdates, settled } = settle({ today: '2026-08-01' })
    expect(pantryUpdates).toHaveLength(0)
    expect(settled).toHaveLength(0)
  })

  it('never lets the shelf go negative', () => {
    // The app insisting the household owes it two onions helps nobody.
    const { pantryUpdates } = settle({ pantryByIngredient: new Map([['onion', stock('onion', 1)]]) })
    expect(pantryUpdates[0]?.on_hand).toBe(0)
  })

  it('settles a reservation with nothing on the shelf to spend', () => {
    const { pantryUpdates, settled } = settle({ pantryByIngredient: new Map() })
    expect(pantryUpdates).toHaveLength(0)
    // Still settled: it was eaten either way, and leaving it open would spend it
    // the moment somebody recorded some stock.
    expect(settled).toHaveLength(1)
  })

  it('adds up several passed nights against one shelf', () => {
    const { pantryUpdates } = settle({
      reservations: [
        reservation({ date: '2026-08-05', amount: 2 }),
        reservation({ plan_entry_id: 'e-2', id: pantryReservationId('e-2', 'onion'), date: '2026-08-06', amount: 1 })
      ]
    })
    expect(pantryUpdates).toHaveLength(1)
    expect(pantryUpdates[0]?.on_hand).toBe(2)
  })

  it('ignores a released reservation', () => {
    const { settled } = settle({ reservations: [reservation({ date: '2026-08-05', deleted_at: NOW })] })
    expect(settled).toHaveLength(0)
  })

  it('lands on the same numbers whichever device runs it', () => {
    // Two phones settling the same nights offline write the same rows, so
    // last-write-wins converges on the truth rather than on whoever went last.
    const a = settle()
    const b = settle()
    expect(a.pantryUpdates.map(r => [r.id, r.on_hand])).toEqual(b.pantryUpdates.map(r => [r.id, r.on_hand]))
  })
})

describe('pantryOnHand', () => {
  it('reports the shelf, and says nothing about what the plan wants', () => {
    expect(pantryOnHand([stock('onion', 4)]).get('onion')).toBe(4)
  })

  it('adds up rows a merge has made the same ingredient', () => {
    const merged = { ...stock('onion', 1), id: 'other-row' }
    expect(pantryOnHand([stock('onion', 4), merged]).get('onion')).toBe(5)
  })

  it('leaves out an empty or deleted shelf rather than reporting a zero', () => {
    expect(pantryOnHand([stock('onion', 0)]).has('onion')).toBe(false)
    expect(pantryOnHand([stock('onion', 4, { deleted_at: NOW })]).has('onion')).toBe(false)
  })

  it('is what the shopping list measures a derived line against', () => {
    // The invariant the pantry acceptance run caught the app breaking. A night
    // wanting three onions with two in the house derives a line asking for one
    // and reserves the two it is taking. Both are the same claim, so the list
    // reads the shelf: netting the reservation off as well sends the line back
    // to asking for all three, with no mention of the cupboard.
    const shelf = [stock('onion', 2)]
    const claimed = [reservation({ amount: 3 })]
    expect(pantryOnHand(shelf).get('onion')).toBe(2)
    expect(pantryAvailable(shelf, claimed, '2026-08-03').has('onion')).toBe(false)
  })
})

describe('pantryAvailable', () => {
  const TODAY = '2026-08-03'

  it('reports what is on the shelf when nothing is planned', () => {
    expect(pantryAvailable([stock('onion', 4)], [], TODAY).get('onion')).toBe(4)
  })

  it('takes off what the nights ahead have claimed', () => {
    const available = pantryAvailable([stock('onion', 4)], [reservation({ amount: 3 })], TODAY)
    expect(available.get('onion')).toBe(1)
  })

  it('drops an ingredient that is entirely spoken for', () => {
    // Absent rather than zero: every reader treats a missing key as "none", and
    // two ways of saying none is one too many.
    const available = pantryAvailable([stock('onion', 2)], [reservation({ amount: 2 })], TODAY)
    expect(available.has('onion')).toBe(false)
  })

  it('does not charge for a night already settled', () => {
    const available = pantryAvailable(
      [stock('onion', 4)],
      [reservation({ amount: 3, settled_at: NOW })],
      TODAY
    )
    expect(available.get('onion')).toBe(4)
  })

  it('ignores released and past reservations', () => {
    const available = pantryAvailable(
      [stock('onion', 4)],
      [
        reservation({ amount: 1, deleted_at: NOW }),
        reservation({ plan_entry_id: 'e-2', id: pantryReservationId('e-2', 'onion'), amount: 1, date: '2026-07-30' })
      ],
      TODAY
    )
    expect(available.get('onion')).toBe(4)
  })

  it('adds up two rows that now mean the same ingredient', () => {
    // What a caller hands over after chasing a merge. Overwriting rather than
    // adding would lose whichever row it saw first.
    const merged = { ...stock('onion', 3), id: 'other-row' }
    expect(pantryAvailable([stock('onion', 2), merged], [], TODAY).get('onion')).toBe(5)
  })

  it('leaves out a shelf that is empty or deleted', () => {
    expect(pantryAvailable([stock('onion', 0)], [], TODAY).has('onion')).toBe(false)
    expect(pantryAvailable([stock('onion', 2, { deleted_at: NOW })], [], TODAY).has('onion')).toBe(false)
  })
})
