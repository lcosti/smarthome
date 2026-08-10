import { describe, expect, it } from 'vitest'
import type { AggregateContext } from '../app/utils/aggregate'
import type { ItemRow, PlanEntryRow, RecipeIngredientRow, RecipeRow } from '../app/utils/db'
import { derive, derivedItemId, type DeriveInput } from '../app/utils/derive'
import { applyReviewSelection, reviewByAisle, reviewByMeal, weekReviewRows } from '../app/utils/review'

const HOUSEHOLD = '11111111-1111-1111-1111-111111111111'
const STAMP = '2026-08-08T10:00:00.000Z'
const NOW = '2026-08-10T09:00:00.000Z'
const LATER = '2026-08-11T09:00:00.000Z'

const TOMATOES = derivedItemId('entry-mon', 'line-tomatoes')
const OIL = derivedItemId('entry-mon', 'line-oil')

function recipe(overrides: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: 'recipe-chilli',
    household_id: HOUSEHOLD,
    name: 'Chilli',
    source_url: null,
    base_servings: 2,
    prep_minutes: 10,
    cook_minutes: 30,
    method: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function line(overrides: Partial<RecipeIngredientRow> = {}): RecipeIngredientRow {
  return {
    id: 'line-tomatoes',
    household_id: HOUSEHOLD,
    recipe_id: 'recipe-chilli',
    name: 'Chopped tomatoes',
    quantity: '2 tins',
    aisle_id: 'aisle-cupboard',
    sort_order: 1,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function entry(overrides: Partial<PlanEntryRow> = {}): PlanEntryRow {
  return {
    id: 'entry-mon',
    household_id: HOUSEHOLD,
    date: '2026-08-10',
    meal: 'dinner',
    recipe_id: 'recipe-chilli',
    servings: 2,
    note: null,
    leftover_of_entry_id: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  } as PlanEntryRow
}

function input(overrides: Partial<DeriveInput> = {}): DeriveInput {
  return {
    householdId: HOUSEHOLD,
    start: '2026-08-10',
    end: '2026-08-16',
    entries: [entry()],
    recipes: new Map([['recipe-chilli', recipe()]]),
    ingredients: [line()],
    planItems: [],
    rememberAisle: () => null,
    resolveIngredientId: () => null,
    ingredientAisle: () => null,
    now: NOW,
    ...overrides
  }
}

/** Apply the rows a commit would write, the way the store does. */
function applied(planItems: ItemRow[], writes: ItemRow[]): ItemRow[] {
  const byId = new Map(planItems.map(i => [i.id, i]))
  for (const row of writes) byId.set(row.id, row)
  return [...byId.values()]
}

const EMPTY_CONTEXT: AggregateContext = { ingredients: new Map(), purchaseUnits: [] }

describe('weekReviewRows', () => {
  it('shows every row the week asks for, whether or not it is on the list yet', () => {
    const first = derive(input())
    const rows = weekReviewRows(first, [])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ excluded: false, frozen: false, current: null })
    expect(rows[0]!.row.name).toBe('Chopped tomatoes')
  })

  /** The memory reading back: what somebody said no to last time is still off. */
  it('remembers a row somebody took off the list', () => {
    const planItems = applied([], derive(input()).creates)
      .map(item => ({ ...item, deleted_at: NOW }))
    const rows = weekReviewRows(derive(input({ planItems })), planItems)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.excluded).toBe(true)
    expect(rows[0]!.frozen).toBe(false)
  })

  it('shows a row in the trolley, but not as a decision', () => {
    const planItems = applied([], derive(input()).creates)
      .map(item => ({ ...item, checked: true, checked_at: NOW }))
    const rows = weekReviewRows(derive(input({ planItems })), planItems)

    expect(rows[0]!.frozen).toBe(true)
    expect(rows[0]!.excluded).toBe(false)
  })

  it('leaves out the rows of a night that is no longer planned', () => {
    const planItems = applied([], derive(input()).creates)
    const rows = weekReviewRows(
      derive(input({ entries: [entry({ deleted_at: NOW })], planItems })),
      planItems
    )

    expect(rows).toHaveLength(0)
  })

  it('leaves out another week entirely', () => {
    const planItems = applied([], derive(input()).creates)
    const nextWeek = derive(input({ start: '2026-08-17', end: '2026-08-23', planItems }))

    expect(weekReviewRows(nextWeek, planItems)).toHaveLength(0)
  })
})

describe('applyReviewSelection', () => {
  it('writes the whole week when nothing is unticked', () => {
    const result = derive(input())
    const writes = applyReviewSelection(result, [], new Set(), NOW)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ id: TOMATOES, deleted_at: null })
  })

  /**
   * The row still gets written — soft-deleted. That is exactly the shape a
   * person deleting an item off the list leaves behind, which is what makes the
   * choice stick through every later derive.
   */
  it('writes an unticked line soft-deleted rather than not writing it', () => {
    const result = derive(input())
    const writes = applyReviewSelection(result, [], new Set([TOMATOES]), NOW)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ id: TOMATOES, deleted_at: NOW })
  })

  it('takes an unticked line back off a list it is already on', () => {
    const planItems = applied([], derive(input()).creates)
    const writes = applyReviewSelection(
      derive(input({ planItems })),
      planItems,
      new Set([TOMATOES]),
      LATER
    )

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ id: TOMATOES, deleted_at: LATER })
  })

  it('puts a line back, refreshed, when somebody changes their mind', () => {
    const planItems = applied([], derive(input()).creates)
      .map(item => ({ ...item, deleted_at: NOW }))
    const result = derive(input({
      planItems,
      ingredients: [line({ name: 'Tinned tomatoes', quantity: '3 tins' })]
    }))
    const writes = applyReviewSelection(result, planItems, new Set(), LATER)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      id: TOMATOES,
      deleted_at: null,
      name: 'Tinned tomatoes',
      quantity: '3 tins'
    })
  })

  it('writes nothing at all for a week already reviewed the same way', () => {
    const planItems = applied([], applyReviewSelection(derive(input()), [], new Set(), NOW))
    const again = applyReviewSelection(derive(input({ planItems })), planItems, new Set(), LATER)

    expect(again).toEqual([])
  })

  it('writes nothing for an unticked line that is already off', () => {
    const planItems = applied([], applyReviewSelection(derive(input()), [], new Set([TOMATOES]), NOW))
    const again = applyReviewSelection(
      derive(input({ planItems })),
      planItems,
      new Set([TOMATOES]),
      LATER
    )

    expect(again).toEqual([])
  })

  it('never touches a row in the trolley, ticked or unticked', () => {
    const planItems = applied([], derive(input()).creates)
      .map(item => ({ ...item, checked: true, checked_at: NOW }))

    expect(applyReviewSelection(derive(input({ planItems })), planItems, new Set(), LATER)).toEqual([])
    expect(
      applyReviewSelection(derive(input({ planItems })), planItems, new Set([TOMATOES]), LATER)
    ).toEqual([])
  })

  it('still takes off the rows of a night that has gone', () => {
    const planItems = applied([], derive(input()).creates)
    const writes = applyReviewSelection(
      derive(input({ entries: [entry({ deleted_at: LATER })], planItems })),
      planItems,
      new Set(),
      LATER
    )

    expect(writes).toHaveLength(1)
    // Stamped by the derive that decided it was unwanted, not by the review.
    expect(writes[0]).toMatchObject({ id: TOMATOES, deleted_at: NOW })
  })

  /**
   * The whole point of borrowing derive's rule rather than storing a list of
   * exclusions: filling the rest of the week, or the other phone deriving it,
   * must not put back what somebody took off.
   */
  it('survives an ordinary derive of the same week', () => {
    const planItems = applied([], applyReviewSelection(derive(input()), [], new Set([TOMATOES]), NOW))
    const next = derive(input({ planItems }))

    expect(next.creates).toEqual([])
    expect(next.updates).toEqual([])
    expect(next.removes).toEqual([])
  })
})

describe('reviewByAisle', () => {
  const aisles = [{ id: 'aisle-cupboard', name: 'Cupboard' }, { id: 'aisle-fresh', name: 'Fresh' }]

  function rowsOf(result: ReturnType<typeof derive>) {
    return [...result.wanted.values()]
  }

  it('files rows under their aisle, in the order the shop is walked', () => {
    const result = derive(input({
      ingredients: [
        line(),
        line({ id: 'line-onion', name: 'Onion', quantity: '1', aisle_id: 'aisle-fresh', sort_order: 2 })
      ]
    }))
    const { sections } = reviewByAisle(rowsOf(result), EMPTY_CONTEXT, aisles)

    expect(sections.map(s => s.name)).toEqual(['Cupboard', 'Fresh'])
    expect(sections[0]!.lines.map(l => l.name)).toEqual(['Chopped tomatoes'])
  })

  it('files a row with no aisle into a trailing Other, so nothing goes missing', () => {
    const result = derive(input({ ingredients: [line({ aisle_id: null })] }))
    const { sections } = reviewByAisle(rowsOf(result), EMPTY_CONTEXT, aisles)

    expect(sections.map(s => s.name)).toEqual(['Other'])
  })

  it('sets the staples aside rather than offering them as choices', () => {
    const result = derive(input({
      ingredients: [line(), line({ id: 'line-oil', name: 'Olive oil', quantity: 'a glug', sort_order: 2 })],
      resolveIngredientId: l => (l.id === 'line-oil' ? 'ing-oil' : null)
    }))
    const context: AggregateContext = {
      ingredients: new Map([
        ['ing-oil', { id: 'ing-oil', name: 'Olive oil', base_unit: 'ml' as const, staple: true, merged_into_id: null }]
      ]),
      purchaseUnits: []
    }
    const { sections, staples } = reviewByAisle(rowsOf(result), context, aisles)

    expect(staples.map(row => row.id)).toEqual([OIL])
    expect(sections.flatMap(s => s.lines).map(l => l.name)).toEqual(['Chopped tomatoes'])
  })

  it('marks a line the cupboard already covers', () => {
    const result = derive(input({
      ingredients: [line({ quantity: '400g' })],
      resolveIngredientId: () => 'ing-tomatoes'
    }))
    const context: AggregateContext = {
      ingredients: new Map([
        ['ing-tomatoes', { id: 'ing-tomatoes', name: 'Tomatoes', base_unit: 'g' as const, merged_into_id: null }]
      ]),
      purchaseUnits: [],
      pantry: new Map([['ing-tomatoes', 800]])
    }
    const { sections, covered } = reviewByAisle(rowsOf(result), context, aisles)

    expect(sections[0]!.lines[0]!.covered).toBe(true)
    expect(covered.has(TOMATOES)).toBe(true)
  })
})

describe('reviewByMeal', () => {
  it('files each row under the night that asked for it, in week order', () => {
    const result = derive(input({
      entries: [entry(), entry({ id: 'entry-wed', date: '2026-08-12' })],
      ingredients: [line()]
    }))
    const names = new Map([
      ['entry-mon', { id: 'entry-mon', name: 'Mon · Chilli', order: '2026-08-10' }],
      ['entry-wed', { id: 'entry-wed', name: 'Wed · Chilli', order: '2026-08-12' }]
    ])
    const sections = reviewByMeal(
      [...result.wanted.values()],
      item => names.get(item.plan_entry_id!) ?? null,
      { covered: new Set(), staples: new Set() }
    )

    expect(sections.map(s => s.name)).toEqual(['Mon · Chilli', 'Wed · Chilli'])
    expect(sections[0]!.lines.map(l => l.name)).toEqual(['Chopped tomatoes'])
  })

  it('puts a day’s breakfast above its dinner rather than sorting them by dish', () => {
    // Two meals on one date tie on the date alone, and the tiebreak is the
    // section name — which would file "Mon · Chilli" above "Mon breakfast ·
    // Porridge". `nightOf` carries the slot in `order` for exactly this.
    const result = derive(input({
      entries: [
        entry(),
        entry({ id: 'entry-mon-breakfast', meal: 'breakfast', recipe_id: 'recipe-porridge' })
      ],
      recipes: new Map([
        ['recipe-chilli', recipe()],
        ['recipe-porridge', recipe({ id: 'recipe-porridge', name: 'Porridge' })]
      ]),
      ingredients: [line(), line({ id: 'line-oats', recipe_id: 'recipe-porridge', name: 'Oats' })]
    }))
    const names = new Map([
      ['entry-mon', { id: 'entry-mon', name: 'Mon · Chilli', order: '2026-08-10#2' }],
      ['entry-mon-breakfast', {
        id: 'entry-mon-breakfast',
        name: 'Mon breakfast · Porridge',
        order: '2026-08-10#0'
      }]
    ])
    const sections = reviewByMeal(
      [...result.wanted.values()],
      item => names.get(item.plan_entry_id!) ?? null,
      { covered: new Set(), staples: new Set() }
    )

    expect(sections.map(s => s.name)).toEqual(['Mon breakfast · Porridge', 'Mon · Chilli'])
  })

  it('leaves the staples out, exactly as the aisle read does', () => {
    const result = derive(input())
    const sections = reviewByMeal(
      [...result.wanted.values()],
      () => ({ id: 'entry-mon', name: 'Mon · Chilli', order: '2026-08-10' }),
      { covered: new Set(), staples: new Set([TOMATOES]) }
    )

    expect(sections).toEqual([])
  })
})
