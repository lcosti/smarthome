import { describe, expect, it } from 'vitest'
import type { AggregateContext, IngredientWithUnit, ItemLike, PurchaseUnitLike, StapleCandidate } from '../app/utils/aggregate'
import { buildEntries, splitStaples } from '../app/utils/aggregate'
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

describe('buildEntries and the pantry', () => {
  const LEMONS = ingredient('lem', 'Lemons', 'count')

  function withPantry(
    ingredients: IngredientWithUnit[],
    pantry: Record<string, number>,
    purchaseUnits: PurchaseUnitLike[] = []
  ): AggregateContext {
    return { ...context(ingredients, purchaseUnits), pantry: new Map(Object.entries(pantry)) }
  }

  it('changes nothing at all when there is no pantry', () => {
    // The usual case, and it has to stay byte-for-byte what it was before the
    // feature existed.
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', '400g', 'tom')]
    const plain = buildEntries(rows, context([TOMATOES]))
    expect(plain[0]).toMatchObject({ quantityLabel: '800g', pantry: null })
  })

  it('changes nothing when the cupboard holds none of it', () => {
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', '400g', 'tom')]
    const entries = buildEntries(rows, withPantry([TOMATOES], { lem: 3 }))
    expect(entries[0]).toMatchObject({ quantityLabel: '800g', pantry: null })
  })

  it('asks only for what is left to buy', () => {
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', '400g', 'tom')]
    const entries = buildEntries(rows, withPantry([TOMATOES], { tom: 300 }))
    expect(entries[0]).toMatchObject({
      quantityLabel: '500g · 300g in the pantry',
      pantry: { need: 800, have: 300, toBuy: 500 }
    })
  })

  it('counts the buy amount in purchase units, not the whole need', () => {
    // Two tins on the list and one already in the cupboard is one tin to buy.
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', '400g', 'tom')]
    const entries = buildEntries(
      rows,
      withPantry([TOMATOES], { tom: 400 }, [purchaseUnit('tom', 'tin', 400)])
    )
    expect(entries[0]!.quantityLabel).toBe('400g · 1 tin · 400g in the pantry')
  })

  it('says a fully covered line is covered, and keeps it on the list', () => {
    const rows = [item('a', 'Lemon', '1', 'lem'), item('b', 'Lemons', '2', 'lem')]
    const entries = buildEntries(rows, withPantry([LEMONS], { lem: 5 }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      // The recipe's own amount, because that is what to take out of the cupboard.
      quantityLabel: '3 · from the pantry',
      pantry: { need: 3, have: 3, toBuy: 0 }
    })
  })

  it('never claims to cover more than the line asked for', () => {
    const rows = [item('a', 'Lemon', '1', 'lem'), item('b', 'Lemons', '1', 'lem')]
    const entries = buildEntries(rows, withPantry([LEMONS], { lem: 99 }))
    expect(entries[0]!.pantry).toMatchObject({ need: 2, have: 2, toBuy: 0 })
  })

  it('subtracts from a lone row too', () => {
    // One row is still one row, but "you already have this" is worth the rewrite
    // that a bare regrouping would not be.
    const rows = [item('a', 'Lemons', '3', 'lem')]
    const entries = buildEntries(rows, withPantry([LEMONS], { lem: 1 }))
    expect(entries[0]).toMatchObject({
      key: 'a',
      name: 'Lemons',
      quantityLabel: '2 · 1 in the pantry',
      pantry: { need: 3, have: 1, toBuy: 2 }
    })
  })

  it('leaves a lone row verbatim when the cupboard has nothing to say', () => {
    const rows = [item('a', 'Tinned tomatoes', '2 tins', 'tom')]
    const entries = buildEntries(rows, withPantry([TOMATOES], {}, [purchaseUnit('tom', 'tin', 400)]))
    expect(entries[0]).toMatchObject({ quantityLabel: '2 tins', ingredient: null, pantry: null })
  })

  it('never subtracts from words it cannot read', () => {
    // "A splash" is not zero and it is not a number. Taking the cupboard off it
    // would be inventing an amount nobody wrote.
    const rows = [item('a', 'Tomatoes', 'a splash', 'tom'), item('b', 'Tomatoes', 'a handful', 'tom')]
    const entries = buildEntries(rows, withPantry([TOMATOES], { tom: 800 }))
    expect(entries[0]).toMatchObject({ quantityLabel: 'a splash, a handful', pantry: null })
  })

  it('keeps unreadable words beside a subtracted total', () => {
    const rows = [item('a', 'Tomatoes', '400g', 'tom'), item('b', 'Tomatoes', 'a splash', 'tom')]
    const entries = buildEntries(rows, withPantry([TOMATOES], { tom: 100 }))
    expect(entries[0]!.quantityLabel).toBe('300g · 100g in the pantry + a splash')
  })
})

describe('splitStaples', () => {
  const OIL = ingredient('oil', 'Olive oil', 'ml', { staple: true })
  const SALT = ingredient('salt', 'Salt', 'g', { staple: true })

  function planItem(id: string, name: string, ingredientId: string | null): StapleCandidate {
    return { ...item(id, name, null, ingredientId), source: 'plan' }
  }

  function adhocItem(id: string, name: string, ingredientId: string | null): StapleCandidate {
    return { ...item(id, name, null, ingredientId), source: 'adhoc' }
  }

  it('sets a plan row aside when its ingredient is a staple', () => {
    const rows = [planItem('a', 'Chicken thighs', null), planItem('b', 'Olive oil', 'oil')]
    const { rest, staples } = splitStaples(rows, context([OIL]))
    expect(rest.map(r => r.id)).toEqual(['a'])
    expect(staples).toMatchObject({ names: ['Olive oil'] })
    expect(staples!.items.map(r => r.id)).toEqual(['b'])
  })

  it('leaves an ad-hoc row alone however the ingredient is flagged', () => {
    // Somebody typed "olive oil" into the box. That is the escape hatch for the
    // week the bottle is empty, and swallowing it would be the app overruling a
    // person who was standing in the kitchen looking at the shelf.
    const rows = [adhocItem('a', 'Olive oil', 'oil')]
    const { rest, staples } = splitStaples(rows, context([OIL]))
    expect(rest.map(r => r.id)).toEqual(['a'])
    expect(staples).toBeNull()
  })

  it('never takes a row that resolved to nothing', () => {
    const rows = [planItem('a', 'Olive oil', null)]
    const { rest, staples } = splitStaples(rows, context([OIL]))
    expect(rest.map(r => r.id)).toEqual(['a'])
    expect(staples).toBeNull()
  })

  it('follows a merge to the winner’s flag', () => {
    const merged = ingredient('evoo', 'Extra virgin olive oil', 'ml', { merged_into: 'oil' })
    const rows = [planItem('a', 'Extra virgin olive oil', 'evoo')]
    const { rest, staples } = splitStaples(rows, context([OIL, merged]))
    expect(rest).toHaveLength(0)
    expect(staples).toMatchObject({ names: ['Olive oil'] })
  })

  it('names an ingredient once however many nights want it', () => {
    const rows = [
      planItem('a', 'Olive oil', 'oil'),
      planItem('b', 'Olive oil', 'oil'),
      planItem('c', 'Sea salt', 'salt')
    ]
    const { staples } = splitStaples(rows, context([OIL, SALT]))
    expect(staples!.names).toEqual(['Olive oil', 'Salt'])
    expect(staples!.items).toHaveLength(3)
  })

  it('leaves everything where it was when nothing is flagged', () => {
    const rows = [planItem('a', 'Tinned tomatoes', 'tom')]
    const { rest, staples } = splitStaples(rows, context([TOMATOES]))
    expect(rest).toHaveLength(1)
    expect(staples).toBeNull()
  })
})
