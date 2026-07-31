import { describe, expect, it } from 'vitest'
import { matchOrderLines, parseOrderText, type MatchContext } from '../app/utils/order-paste'
import type { BaseUnit, PurchaseUnit } from '../app/utils/quantity'

/** The one line of a paste we care about, for the parser tests. */
function one(text: string) {
  const lines = parseOrderText(text)
  expect(lines).toHaveLength(1)
  return lines[0]!
}

describe('parseOrderText', () => {
  it('reads a plain line as one of something', () => {
    expect(one('Brown Onions')).toMatchObject({ count: 1, name: 'Brown Onions', packBase: null })
  })

  it('reads a leading multiplier', () => {
    expect(one('2 x Chopped Tomatoes')).toMatchObject({ count: 2, name: 'Chopped Tomatoes' })
    expect(one('3 × Chopped Tomatoes')).toMatchObject({ count: 3, name: 'Chopped Tomatoes' })
  })

  it('reads a bare leading count', () => {
    expect(one('2 Brown Onions')).toMatchObject({ count: 2, name: 'Brown Onions' })
  })

  it('reads a pack size off the end', () => {
    expect(one('Chopped Tomatoes 400g')).toMatchObject({
      count: 1, name: 'Chopped Tomatoes', packBase: 400, packUnit: 'g'
    })
    expect(one('Semi Skimmed Milk 2 litres')).toMatchObject({ packBase: 2000, packUnit: 'ml' })
  })

  it('does not read a pack size as a count', () => {
    // "500 g Flour" is one bag, not five hundred of them.
    expect(one('500 g Plain Flour')).toMatchObject({ count: 1, packBase: 500, packUnit: 'g', name: 'Plain Flour' })
  })

  it('multiplies a multipack out', () => {
    // 440g arrived, and reading only the 110 understates the shop fourfold.
    expect(one('Greek Yoghurt 4 x 110g')).toMatchObject({ count: 1, packBase: 440, packUnit: 'g' })
  })

  it('keeps a count and a pack size apart', () => {
    expect(one('2 x Chopped Tomatoes 400g')).toMatchObject({ count: 2, packBase: 400, packUnit: 'g' })
  })

  it('strips prices, however many trail the line', () => {
    expect(one('Brown Onions £1.20').name).toBe('Brown Onions')
    expect(one('Brown Onions 3 pack £1.20 £1.20').name).toBe('Brown Onions 3 pack')
    expect(one('Olive Oil 500ml £4.50/l')).toMatchObject({ name: 'Olive Oil', packBase: 500 })
  })

  it('skips the parts of a receipt that are not shopping', () => {
    const text = [
      'Your order',
      '',
      'Brown Onions £1.20',
      'Subtotal £24.10',
      'Delivery £3.50',
      'Total £27.60',
      '£1.20'
    ].join('\n')
    expect(parseOrderText(text).map(l => l.name)).toEqual(['Brown Onions'])
  })

  it('keeps a product whose name merely starts like a receipt line', () => {
    // "Total" is a receipt line. "Total Greek Yoghurt" is breakfast.
    expect(one('Total Greek Yoghurt 500g').name).toBe('Total Greek Yoghurt')
  })

  it('reads a whole order', () => {
    const text = [
      'Your order — 3 items',
      '2 x Brown Onions £1.20',
      'Chopped Tomatoes 400g £0.55',
      'Semi Skimmed Milk 2 litres £1.45',
      'Total £3.20'
    ].join('\n')
    expect(parseOrderText(text).map(l => [l.count, l.name, l.packBase])).toEqual([
      [2, 'Brown Onions', null],
      [1, 'Chopped Tomatoes', 400],
      [1, 'Semi Skimmed Milk', 2000]
    ])
  })
})

const BASE_UNITS: Record<string, BaseUnit> = { onion: 'count', tom: 'g', oil: 'ml' }
const UNITS: Record<string, PurchaseUnit[]> = { tom: [{ name: 'tin', amount: 400 }] }
const NAMES: Record<string, string> = {
  'brown onions': 'onion',
  'chopped tomatoes': 'tom',
  'olive oil': 'oil'
}

function context(needed: Record<string, number> = {}): MatchContext {
  return {
    resolve: (name) => {
      const id = NAMES[name.trim().toLowerCase()]
      return id ? { id, name: id } : null
    },
    baseUnitOf: id => BASE_UNITS[id] ?? 'count',
    purchaseUnitsOf: id => UNITS[id] ?? [],
    neededOf: id => needed[id] ?? 0
  }
}

describe('matchOrderLines', () => {
  it('counts what arrived for something counted', () => {
    const [match] = matchOrderLines(parseOrderText('2 x Brown Onions'), context())
    expect(match).toMatchObject({ ingredientId: 'onion', bought: 2, deposit: 2, include: true })
  })

  it('uses the pack size for something weighed', () => {
    const [match] = matchOrderLines(parseOrderText('2 x Chopped Tomatoes 400g'), context())
    expect(match).toMatchObject({ bought: 800, deposit: 800, include: true })
  })

  it('falls back to how the household buys it when the line says no size', () => {
    const [match] = matchOrderLines(parseOrderText('2 x Chopped Tomatoes'), context())
    expect(match).toMatchObject({ bought: 800, include: true })
  })

  it('deposits everything that arrived, not the surplus', () => {
    // The pantry is what is in the house. What gets cooked leaves it again when
    // the night settles; depositing only the surplus would take it off twice.
    const [match] = matchOrderLines(parseOrderText('3 x Brown Onions'), context({ onion: 1 }))
    expect(match).toMatchObject({ bought: 3, needed: 1, deposit: 3 })
  })

  it('shows an unmatched line without ticking it', () => {
    const [match] = matchOrderLines(parseOrderText('Carrier Bag'), context())
    expect(match).toMatchObject({ ingredientId: null, bought: null, deposit: 0, include: false })
    // The raw text survives, because a line the app drops is a line nobody can fix.
    expect(match?.line.raw).toBe('Carrier Bag')
  })

  it('shows a line it cannot size without ticking it', () => {
    // Millilitres, no size on the line, and the household has never said how big a
    // bottle is. A number here would be a guess.
    const [match] = matchOrderLines(parseOrderText('Olive Oil'), context())
    expect(match).toMatchObject({ ingredientId: 'oil', bought: null, include: false })
  })

  it('ignores a pack size measured in the wrong thing', () => {
    // 500ml of something sold by weight tells us nothing about the weight.
    const [match] = matchOrderLines(parseOrderText('Chopped Tomatoes 500ml'), context())
    expect(match?.bought).toBe(400)
  })
})
