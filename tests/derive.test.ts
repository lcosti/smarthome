import { describe, expect, it } from 'vitest'
import { derive, derivedItemId, servingsHint, type DeriveInput } from '../app/utils/derive'
import type { ItemRow, PlanEntryRow, RecipeIngredientRow, RecipeRow } from '../app/utils/db'

const HOUSEHOLD = '11111111-1111-1111-1111-111111111111'
const STAMP = '2026-07-30T10:00:00.000Z'
const NOW = '2026-08-01T09:00:00.000Z'

function recipe(overrides: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: 'recipe-chilli',
    household_id: HOUSEHOLD,
    name: 'Chilli',
    source_url: null,
    base_servings: 2,
    prep_minutes: null,
    cook_minutes: null,
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
    aisle_id: null,
    sort_order: 1,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function entry(overrides: Partial<PlanEntryRow> = {}): PlanEntryRow {
  return {
    id: 'entry-tuesday',
    household_id: HOUSEHOLD,
    date: '2026-08-04',
    meal: 'dinner',
    recipe_id: 'recipe-chilli',
    servings: 2,
    note: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  }
}

function input(overrides: Partial<DeriveInput> = {}): DeriveInput {
  return {
    householdId: HOUSEHOLD,
    start: '2026-08-03',
    end: '2026-08-09',
    entries: [entry()],
    recipes: new Map([['recipe-chilli', recipe()]]),
    ingredients: [line()],
    planItems: [],
    rememberAisle: () => null,
    now: NOW,
    ...overrides
  }
}

/** Apply a result the way the store does, to test the next run against it. */
function applied(planItems: ItemRow[], result: ReturnType<typeof derive>): ItemRow[] {
  const byId = new Map(planItems.map(i => [i.id, i]))
  for (const row of [...result.creates, ...result.updates, ...result.removes]) byId.set(row.id, row)
  return [...byId.values()]
}

describe('servingsHint', () => {
  it('leaves the quantity alone when the servings match', () => {
    expect(servingsHint('2 tins', 2, 2)).toBe('2 tins')
  })

  it('annotates rather than rescaling, because the quantity is free text', () => {
    expect(servingsHint('2 tins', 4, 2)).toBe('2 tins ×2')
    expect(servingsHint('a bunch', 3, 2)).toBe('a bunch ×1.5')
  })

  it('still says something useful with no quantity', () => {
    expect(servingsHint(null, 4, 2)).toBe('×2')
    expect(servingsHint(null, 2, 2)).toBeNull()
  })

  it('does not divide by a nonsense base', () => {
    expect(servingsHint('2 tins', 4, 0)).toBe('2 tins')
  })
})

describe('derive', () => {
  it('puts one item on the list per ingredient of every planned night', () => {
    const result = derive(input())

    expect(result.creates).toHaveLength(1)
    expect(result.updates).toHaveLength(0)
    expect(result.removes).toHaveLength(0)
    expect(result.creates[0]).toMatchObject({
      id: derivedItemId('entry-tuesday', 'line-tomatoes'),
      name: 'Chopped tomatoes',
      quantity: '2 tins',
      source: 'plan',
      plan_entry_id: 'entry-tuesday',
      recipe_ingredient_id: 'line-tomatoes',
      checked: false,
      deleted_at: null
    })
  })

  it('does nothing at all the second time', () => {
    const first = derive(input())
    const second = derive(input({ planItems: applied([], first) }))

    expect(second).toEqual({ creates: [], updates: [], removes: [] })
  })

  it('lands on the same ids on two devices that never spoke', () => {
    const phone = derive(input())
    const tablet = derive(input())

    expect(phone.creates.map(i => i.id)).toEqual(tablet.creates.map(i => i.id))
  })

  it('takes unchecked items off when the night is removed', () => {
    const existing = applied([], derive(input()))
    const result = derive(input({
      entries: [entry({ deleted_at: NOW })],
      planItems: existing
    }))

    expect(result.removes).toHaveLength(1)
    expect(result.removes[0]!.deleted_at).toBe(NOW)
    expect(result.creates).toHaveLength(0)
  })

  it('leaves a checked item alone when the night is removed', () => {
    // Already in the trolley. Removing it mid-shop would be worse than useless.
    const existing = applied([], derive(input()))
      .map(i => ({ ...i, checked: true, checked_at: NOW }))
    const result = derive(input({
      entries: [entry({ deleted_at: NOW })],
      planItems: existing
    }))

    expect(result).toEqual({ creates: [], updates: [], removes: [] })
  })

  it('swaps the ingredients over when the night changes recipe', () => {
    const existing = applied([], derive(input()))
    const result = derive(input({
      entries: [entry({ recipe_id: 'recipe-curry' })],
      recipes: new Map([
        ['recipe-chilli', recipe()],
        ['recipe-curry', recipe({ id: 'recipe-curry', name: 'Curry' })]
      ]),
      ingredients: [line(), line({ id: 'line-coconut', recipe_id: 'recipe-curry', name: 'Coconut milk', quantity: '1 tin' })],
      planItems: existing
    }))

    expect(result.creates.map(i => i.name)).toEqual(['Coconut milk'])
    expect(result.removes.map(i => i.name)).toEqual(['Chopped tomatoes'])
  })

  it('does not resurrect an item a person deleted', () => {
    // The night is still planned, so the id is still wanted — but somebody took
    // it off the list on purpose, probably because it is already in the cupboard.
    const existing = applied([], derive(input())).map(i => ({ ...i, deleted_at: NOW }))
    const result = derive(input({ planItems: existing }))

    expect(result).toEqual({ creates: [], updates: [], removes: [] })
  })

  it('refreshes an unchecked item when the recipe line is edited', () => {
    const existing = applied([], derive(input()))
    const result = derive(input({
      ingredients: [line({ name: 'Tinned tomatoes', quantity: '3 tins' })],
      planItems: existing
    }))

    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]).toMatchObject({ name: 'Tinned tomatoes', quantity: '3 tins' })
  })

  it('does not rewrite a checked item when the recipe line is edited', () => {
    const existing = applied([], derive(input())).map(i => ({ ...i, checked: true }))
    const result = derive(input({
      ingredients: [line({ name: 'Tinned tomatoes', quantity: '3 tins' })],
      planItems: existing
    }))

    expect(result.updates).toHaveLength(0)
  })

  it('adds a servings hint when the night feeds more than the recipe', () => {
    const result = derive(input({ entries: [entry({ servings: 4 })] }))
    expect(result.creates[0]!.quantity).toBe('2 tins ×2')
  })

  it('updates the hint when the servings change after a derive', () => {
    const existing = applied([], derive(input()))
    const result = derive(input({ entries: [entry({ servings: 6 })], planItems: existing }))

    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]!.quantity).toBe('2 tins ×3')
  })

  it('never overwrites an aisle somebody chose', () => {
    // Re-filing something into the right aisle mid-shop has to outlive a plan
    // tweak made at home five minutes later.
    const existing = applied([], derive(input())).map(i => ({ ...i, aisle_id: 'aisle-chosen' }))
    const result = derive(input({
      ingredients: [line({ aisle_id: 'aisle-from-recipe' })],
      planItems: existing
    }))

    expect(result.updates).toHaveLength(0)
  })

  it('fills an empty aisle from the recipe, then from memory', () => {
    const fromRecipe = derive(input({ ingredients: [line({ aisle_id: 'aisle-cupboard' })] }))
    expect(fromRecipe.creates[0]!.aisle_id).toBe('aisle-cupboard')

    const fromMemory = derive(input({ rememberAisle: () => 'aisle-remembered' }))
    expect(fromMemory.creates[0]!.aisle_id).toBe('aisle-remembered')
  })

  it('leaves the items of another week completely alone', () => {
    const otherWeek = applied([], derive(input({
      start: '2026-08-10', end: '2026-08-16',
      entries: [entry({ id: 'entry-next', date: '2026-08-11' })]
    })))

    const result = derive(input({
      entries: [entry(), entry({ id: 'entry-next', date: '2026-08-11' })],
      planItems: otherWeek
    }))

    expect(result.removes).toHaveLength(0)
    expect(result.creates).toHaveLength(1)
  })

  it('ignores nights whose recipe has been deleted', () => {
    const result = derive(input({
      recipes: new Map([['recipe-chilli', recipe({ deleted_at: NOW })]])
    }))
    expect(result.creates).toHaveLength(0)
  })

  it('ignores ingredient lines that have been deleted', () => {
    const result = derive(input({ ingredients: [line({ deleted_at: NOW })] }))
    expect(result.creates).toHaveLength(0)
  })

  it('treats the same recipe on two nights as two separate sets of items', () => {
    const result = derive(input({
      entries: [entry(), entry({ id: 'entry-thursday', date: '2026-08-06' })]
    }))

    expect(result.creates).toHaveLength(2)
    expect(new Set(result.creates.map(i => i.id)).size).toBe(2)
  })

  it('never touches an ad-hoc item, even one handed to it by mistake', () => {
    // "Bin bags" disappearing because somebody changed Tuesday's dinner is the
    // kind of thing that stops a household trusting the list.
    const adhoc: ItemRow = {
      id: 'adhoc-1', household_id: HOUSEHOLD, name: 'Bin bags', quantity: null,
      aisle_id: null, checked: false, checked_at: null, source: 'adhoc',
      plan_entry_id: null, recipe_ingredient_id: null, deleted_at: null,
      created_at: STAMP, updated_at: STAMP
    }
    const result = derive(input({ entries: [], planItems: [adhoc] }))

    expect(result).toEqual({ creates: [], updates: [], removes: [] })
  })
})
