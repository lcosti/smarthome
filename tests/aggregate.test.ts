import { describe, expect, it } from 'vitest'
import type { AggregateContext, IngredientWithUnit, ItemLike, PurchaseUnitLike } from '../app/utils/aggregate'
import { buildEntries } from '../app/utils/aggregate'
import type { BaseUnit } from '../app/utils/quantity'

let clock = 0
/** Ascending created_at, so ordering assertions mean something. */
function stamp(): string {
  clock += 1000
  return new Date(Date.UTC(2026, 6, 1, 0, 0, 0, 0) + clock).toISOString()
}

function item(id: string, name: string, quantity: string | null, ingredientId: string | null = null): ItemLike {
  return { id, name, quantity, ingredient_id: ingredientId, created_at: stamp() }
}

function ingredient(id: string, name: string, baseUnit: BaseUnit, extra: Partial<IngredientWithUnit> = {}): IngredientWithUnit {
  return {
    id,
    name,
    base_unit: baseUnit,
    merged_into: null,
    deleted_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...extra
  }
}

function purchaseUnit(ingredientId: string, name: string, amount: number, extra: Partial<PurchaseUnitLike> = {}): PurchaseUnitLike {
  return {
    ingredient_id: ingredientId,
    name,
    amount,
    deleted_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...extra
  }
}

function context(ingredients: IngredientWithUnit[], purchaseUnits: PurchaseUnitLike[] = []): AggregateContext {
  return { ingredients: new Map(ingredients.map(i => [i.id, i])), purchaseUnits }
}

const TOMATOES = ingredient('tom', 'Chopped tomatoes', 'g')

describe('buildEntries', () => {
  it('leaves an unresolved row exactly as it was', () => {
    const rows = [item('a', 'Bin bags', '1 pack')]
    const entries = buildEntries(rows, context([]))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ key: 'a', name: 'Bin bags', quantityLabel: '1 pack', ingredient: null })
  })

  it('leaves a lone resolved row under its own name', () => {
    // Renaming one row to its canonical name would change what the recipe said
    // for no benefit at all.
    const rows = [item('a', 'Tinned tomatoes', '2 tins', 'tom')]
    const entries = buildEntries(rows, context([TOMATOES], [purchaseUnit('tom', 'tin', 400)]))
    expect(entries[0]).toMatchObject({ name: 'Tinned tomatoes', quantityLabel: '2 tins', ingredient: null })
  })

  it('groups two rows sharing an ingredient and adds them up', () => {
    const rows = [
      item('a', 'Chopped tomatoes', '400g', 'tom'),
      item('b', 'Tinned tomatoes', '400g', 'tom')
    ]
    const entries = buildEntries(rows, context([TOMATOES]))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      key: 'ingredient:tom',
      name: 'Chopped tomatoes',
      quantityLabel: '800g'
    })
    expect(entries[0]!.items.map(i => i.id)).toEqual(['a', 'b'])
  })

  it('converts a purchase unit into the base unit before adding', () => {
    const rows = [
      item('a', 'Chopped tomatoes', '2 tins', 'tom'),
      item('b', 'Passata', '400g', 'tom')
    ]
    const entries = buildEntries(rows, context([TOMATOES], [purchaseUnit('tom', 'tin', 400)]))
    expect(entries[0]!.quantityLabel).toBe('1.2kg · 3 tins')
  })

  it('says how many to buy, rounded up', () => {
    const rows = [
      item('a', 'Tomatoes', '500g', 'tom'),
      item('b', 'Tomatoes', '400g', 'tom')
    ]
    const entries = buildEntries(rows, context([TOMATOES], [purchaseUnit('tom', 'tin', 400)]))
    expect(entries[0]!.quantityLabel).toBe('900g · ~3 tins')
  })

  it('keeps a quantity it cannot read, rather than quietly asking for less', () => {
    const rows = [
      item('a', 'Chopped tomatoes', '400g', 'tom'),
      item('b', 'Passata', 'a splash', 'tom')
    ]
    const entries = buildEntries(rows, context([TOMATOES]))
    expect(entries[0]!.quantityLabel).toBe('400g + a splash')
  })

  it('shows only the words when nothing at all could be read', () => {
    const rows = [
      item('a', 'Tomatoes', 'a splash', 'tom'),
      item('b', 'Tomatoes', 'a handful', 'tom')
    ]
    const entries = buildEntries(rows, context([TOMATOES]))
    expect(entries[0]!.quantityLabel).toBe('a splash, a handful')
  })

  it('has no quantity to show when the rows carry none', () => {
    const rows = [item('a', 'Tomatoes', null, 'tom'), item('b', 'Tomatoes', null, 'tom')]
    const entries = buildEntries(rows, context([TOMATOES]))
    expect(entries[0]!.quantityLabel).toBeNull()
  })

  it('ignores a blank quantity instead of listing it as a tail', () => {
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', '   ', 'tom')]
    const entries = buildEntries(rows, context([TOMATOES]))
    expect(entries[0]!.quantityLabel).toBe('400g')
  })

  it('applies the servings hint derive wrote, as real arithmetic', () => {
    const rows = [
      item('a', 'Tomatoes', '400g', 'tom'),
      item('b', 'Tomatoes', '400g ×1.5', 'tom')
    ]
    const entries = buildEntries(rows, context([TOMATOES]))
    expect(entries[0]!.quantityLabel).toBe('1kg')
  })

  it('does not annotate a counted ingredient with a count', () => {
    // "3 · 3 lemons" says the same thing twice.
    const lemons = ingredient('lem', 'Lemons', 'count')
    const rows = [item('a', 'Lemon', '1', 'lem'), item('b', 'Lemons', '2', 'lem')]
    const entries = buildEntries(rows, context([lemons], [purchaseUnit('lem', 'lemon', 1)]))
    expect(entries[0]!.quantityLabel).toBe('3')
  })

  it('groups a counted ingredient bought in packs', () => {
    const eggs = ingredient('egg', 'Eggs', 'count')
    const rows = [item('a', 'Eggs', '2', 'egg'), item('b', 'Eggs', '1 pack', 'egg')]
    const entries = buildEntries(rows, context([eggs], [purchaseUnit('egg', 'pack', 6)]))
    expect(entries[0]!.quantityLabel).toBe('8')
  })

  it('groups an ad-hoc row with the plan rows it matches', () => {
    const rows = [
      item('a', 'Chopped tomatoes', '400g', 'tom'),
      item('adhoc', 'tomatoes', '400g', 'tom')
    ]
    const entries = buildEntries(rows, context([TOMATOES]))
    expect(entries).toHaveLength(1)
    expect(entries[0]!.items.map(i => i.id)).toEqual(['a', 'adhoc'])
  })

  it('follows a merge, so rows still pointing at the loser join the winner', () => {
    const loser = ingredient('old', 'Toms', 'g', { merged_into: 'tom', deleted_at: '2026-07-02T00:00:00.000Z' })
    const rows = [
      item('a', 'Chopped tomatoes', '400g', 'tom'),
      item('b', 'Toms', '400g', 'old')
    ]
    const entries = buildEntries(rows, context([TOMATOES, loser]))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ key: 'ingredient:tom', quantityLabel: '800g' })
  })

  it('treats a row pointing at a deleted ingredient as unresolved', () => {
    const gone = ingredient('tom', 'Chopped tomatoes', 'g', { deleted_at: '2026-07-02T00:00:00.000Z' })
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', '400g', 'tom')]
    const entries = buildEntries(rows, context([gone]))
    expect(entries).toHaveLength(2)
    expect(entries.every(e => e.ingredient === null)).toBe(true)
  })

  it('treats a row pointing at an ingredient this device lacks as unresolved', () => {
    const rows = [item('a', 'Tomatoes', '400g', 'missing'), item('b', 'Tomatoes', '400g', 'missing')]
    const entries = buildEntries(rows, context([]))
    expect(entries).toHaveLength(2)
  })

  it('keeps different ingredients apart', () => {
    const rice = ingredient('rice', 'Basmati rice', 'g')
    const rows = [
      item('a', 'Tomatoes', '400g', 'tom'),
      item('b', 'Tomatoes', '400g', 'tom'),
      item('c', 'Rice', '250g', 'rice')
    ]
    const entries = buildEntries(rows, context([TOMATOES, rice]))
    expect(entries).toHaveLength(2)
    expect(entries.map(e => e.key)).toEqual(['ingredient:tom', 'c'])
  })

  it('ignores a purchase unit belonging to another ingredient', () => {
    const rice = ingredient('rice', 'Basmati rice', 'g')
    const rows = [item('a', 'Rice', '2 tins', 'rice'), item('b', 'Rice', '250g', 'rice')]
    const entries = buildEntries(rows, context([TOMATOES, rice], [purchaseUnit('tom', 'tin', 400)]))
    expect(entries[0]!.quantityLabel).toBe('250g + 2 tins')
  })

  it('ignores a deleted purchase unit', () => {
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', '400g', 'tom')]
    const units = [purchaseUnit('tom', 'tin', 400, { deleted_at: '2026-07-02T00:00:00.000Z' })]
    expect(buildEntries(rows, context([TOMATOES], units))[0]!.quantityLabel).toBe('800g')
  })

  it('describes a total in the purchase unit set up first', () => {
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', '400g', 'tom')]
    const units = [
      purchaseUnit('tom', 'tin', 400, { created_at: '2026-07-01T00:00:00.000Z' }),
      purchaseUnit('tom', 'carton', 500, { created_at: '2026-07-05T00:00:00.000Z' })
    ]
    expect(buildEntries(rows, context([TOMATOES], units))[0]!.quantityLabel).toBe('800g · 2 tins')
  })

  it('orders lines by the oldest row each stands for', () => {
    const first = item('first', 'Bread', null)
    const tomA = item('a', 'Tomatoes', '400g', 'tom')
    const last = item('last', 'Milk', null)
    const tomB = item('b', 'Tomatoes', '400g', 'tom')
    const entries = buildEntries([first, tomA, last, tomB], context([TOMATOES]))
    // The group takes the position of its earliest row, so adding a second recipe
    // does not make the line jump up the aisle.
    expect(entries.map(e => e.key)).toEqual(['first', 'ingredient:tom', 'last'])
  })

  it('gives every line a distinct key', () => {
    const rows = [
      item('a', 'Tomatoes', '400g', 'tom'),
      item('b', 'Tomatoes', '400g', 'tom'),
      item('c', 'Bin bags', null)
    ]
    const keys = buildEntries(rows, context([TOMATOES])).map(e => e.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has nothing to show for nothing', () => {
    expect(buildEntries([], context([]))).toEqual([])
  })
})
