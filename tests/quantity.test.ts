import { describe, expect, it } from 'vitest'
import {
  foldUnit,
  formatBaseAmount,
  formatPurchase,
  intrinsicBaseUnit,
  parseQuantity,
  pluralise,
  purchaseCount,
  toBaseAmount
} from '../app/utils/quantity'

const TIN = { name: 'tin', amount: 400 }

describe('foldUnit', () => {
  it('lowercases', () => {
    expect(foldUnit('Tins')).toBe('tin')
  })

  it('strips a plural s', () => {
    expect(foldUnit('packs')).toBe('pack')
  })

  it('strips es where an s alone would leave a non-word', () => {
    expect(foldUnit('bunches')).toBe('bunch')
    expect(foldUnit('boxes')).toBe('box')
  })

  it('leaves a word that merely ends in s alone', () => {
    expect(foldUnit('glass')).toBe('glass')
  })

  it('leaves a singular word alone', () => {
    expect(foldUnit('tin')).toBe('tin')
  })
})

describe('pluralise', () => {
  it('leaves one alone', () => {
    expect(pluralise('tin', 1)).toBe('tin')
  })

  it('adds an s for more than one', () => {
    expect(pluralise('tin', 2)).toBe('tins')
  })

  it('adds es where an s would not read', () => {
    expect(pluralise('bunch', 3)).toBe('bunches')
  })
})

describe('parseQuantity', () => {
  it('reads grams written tight against the number', () => {
    expect(parseQuantity('400g')).toEqual({ amount: 400, unit: 'g' })
  })

  it('reads grams written with a space', () => {
    expect(parseQuantity('400 g')).toEqual({ amount: 400, unit: 'g' })
  })

  it('reads a plural purchase unit as its singular', () => {
    expect(parseQuantity('2 tins')).toEqual({ amount: 2, unit: 'tin' })
  })

  it('reads a bare number as a unitless count', () => {
    expect(parseQuantity('3')).toEqual({ amount: 3, unit: null })
  })

  it('reads a decimal', () => {
    expect(parseQuantity('1.5 l')).toEqual({ amount: 1.5, unit: 'l' })
  })

  it('reads a decimal comma, which a phone keyboard will happily produce', () => {
    expect(parseQuantity('1,5 kg')).toEqual({ amount: 1.5, unit: 'kg' })
  })

  it('gives up on a thousands-separator comma rather than reading it as a decimal', () => {
    // "1,500g" as 1.5g would be a silent thousandfold under-count.
    expect(parseQuantity('1,500g')).toBeNull()
    expect(parseQuantity('1,500')).toBeNull()
  })

  it('reads a written fraction', () => {
    expect(parseQuantity('1/2 tsp')).toEqual({ amount: 0.5, unit: 'tsp' })
  })

  it('reads a mixed number', () => {
    expect(parseQuantity('1 1/2 tins')).toEqual({ amount: 1.5, unit: 'tin' })
  })

  it('reads a vulgar fraction', () => {
    expect(parseQuantity('½ lemon')).toEqual({ amount: 0.5, unit: 'lemon' })
  })

  it('reads a vulgar fraction joined to an integer', () => {
    expect(parseQuantity('1½ tins')).toEqual({ amount: 1.5, unit: 'tin' })
  })

  it('is case insensitive', () => {
    expect(parseQuantity('2 Tins')).toEqual({ amount: 2, unit: 'tin' })
  })

  it('applies a servings hint written by derive', () => {
    expect(parseQuantity('2 tins ×1.5')).toEqual({ amount: 3, unit: 'tin' })
  })

  it('applies a servings hint to grams', () => {
    expect(parseQuantity('400g ×2')).toEqual({ amount: 800, unit: 'g' })
  })

  it('accepts an ascii x in the hint', () => {
    expect(parseQuantity('400g x2')).toEqual({ amount: 800, unit: 'g' })
  })

  it('does not read "2 x 400" as a hint', () => {
    // That is a person writing two-of-something, and guessing 800 would put a
    // confident wrong number on the list.
    expect(parseQuantity('2 x 400')).toBeNull()
    expect(parseQuantity('2x400')).toBeNull()
  })

  it('still reads the × derive writes after a bare number', () => {
    expect(parseQuantity('2 ×1.5')).toEqual({ amount: 3, unit: null })
  })

  it('rejects a hint with nothing in front of it', () => {
    // servingsHint emits this when the recipe line had no quantity at all. There
    // is no number to scale, so there is nothing to add up.
    expect(parseQuantity('×1.5')).toBeNull()
  })

  it('rejects prose', () => {
    expect(parseQuantity('a splash')).toBeNull()
  })

  it('rejects a quantity with trailing words', () => {
    expect(parseQuantity('2 tins drained')).toBeNull()
  })

  it('rejects a range', () => {
    expect(parseQuantity('2-3')).toBeNull()
  })

  it('rejects nothing at all', () => {
    expect(parseQuantity(null)).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity('   ')).toBeNull()
  })
})

describe('intrinsicBaseUnit', () => {
  it('knows every spelled-out weight and volume the parser converts', () => {
    // Base-unit inference asks this table, so a unit the parser converts but
    // this misses would create an ingredient its own lines cannot aggregate on.
    for (const unit of ['g', 'kg', 'kilo', 'kilogram', 'kilogramme', 'gram', 'gramme']) {
      expect(intrinsicBaseUnit(unit), unit).toBe('g')
    }
    for (const unit of ['ml', 'millilitre', 'milliliter', 'cl', 'centilitre', 'l', 'litre', 'liter']) {
      expect(intrinsicBaseUnit(unit), unit).toBe('ml')
    }
  })

  it('has nothing to say about household units or bare numbers', () => {
    expect(intrinsicBaseUnit('tin')).toBeNull()
    expect(intrinsicBaseUnit(null)).toBeNull()
  })
})

describe('toBaseAmount', () => {
  it('passes grams straight through for a gram ingredient', () => {
    expect(toBaseAmount({ amount: 400, unit: 'g' }, 'g')).toBe(400)
  })

  it('converts kilograms to grams', () => {
    expect(toBaseAmount({ amount: 1.5, unit: 'kg' }, 'g')).toBe(1500)
  })

  it('converts litres and centilitres to millilitres', () => {
    expect(toBaseAmount({ amount: 1.5, unit: 'l' }, 'ml')).toBe(1500)
    expect(toBaseAmount({ amount: 25, unit: 'cl' }, 'ml')).toBe(250)
  })

  it('converts a purchase unit into the base unit', () => {
    expect(toBaseAmount({ amount: 2, unit: 'tin' }, 'g', [TIN])).toBe(800)
  })

  it('counts a bare number for a counted ingredient', () => {
    expect(toBaseAmount({ amount: 3, unit: null }, 'count')).toBe(3)
  })

  it('refuses a bare number for a measured ingredient', () => {
    // "400" on a flour line must not quietly become 400g.
    expect(toBaseAmount({ amount: 400, unit: null }, 'g')).toBeNull()
  })

  it('refuses to convert across dimensions', () => {
    expect(toBaseAmount({ amount: 400, unit: 'ml' }, 'g')).toBeNull()
  })

  it('refuses a unit this household has not described', () => {
    expect(toBaseAmount({ amount: 2, unit: 'tin' }, 'g')).toBeNull()
  })

  it('ignores a purchase unit with a useless amount', () => {
    expect(toBaseAmount({ amount: 2, unit: 'tin' }, 'g', [{ name: 'tin', amount: 0 }])).toBeNull()
  })

  it('matches a purchase unit however it was capitalised or pluralised', () => {
    expect(toBaseAmount({ amount: 2, unit: 'tin' }, 'g', [{ name: 'Tins', amount: 400 }])).toBe(800)
  })
})

describe('formatBaseAmount', () => {
  it('leaves a sub-kilo weight in grams', () => {
    expect(formatBaseAmount(800, 'g')).toBe('800g')
  })

  it('scales up to kilos and drops trailing zeros', () => {
    expect(formatBaseAmount(1200, 'g')).toBe('1.2kg')
    expect(formatBaseAmount(2000, 'g')).toBe('2kg')
  })

  it('scales millilitres up to litres', () => {
    expect(formatBaseAmount(1500, 'ml')).toBe('1.5l')
    expect(formatBaseAmount(750, 'ml')).toBe('750ml')
  })

  it('renders a count as a plain number', () => {
    expect(formatBaseAmount(3, 'count')).toBe('3')
  })

  it('does not show a count as a long float', () => {
    expect(formatBaseAmount(1 / 3, 'count')).toBe('0.33')
  })

  it('rounds away floating point dust', () => {
    expect(formatBaseAmount(600.0000000001, 'g')).toBe('600g')
  })

  it('scales an amount that only rounds up to a thousand', () => {
    expect(formatBaseAmount(999.96, 'g')).toBe('1kg')
  })
})

describe('purchaseCount', () => {
  it('divides evenly when it can', () => {
    expect(purchaseCount(800, TIN)).toEqual({ count: 2, exact: true })
  })

  it('rounds up, because part of a tin is still a tin', () => {
    expect(purchaseCount(900, TIN)).toEqual({ count: 3, exact: false })
  })

  it('does not round up on floating point dust', () => {
    expect(purchaseCount(800.0000000001, TIN)).toEqual({ count: 2, exact: true })
  })

  it('has nothing to say about nothing', () => {
    expect(purchaseCount(0, TIN)).toBeNull()
  })

  it('has nothing to say about a unit of no size', () => {
    expect(purchaseCount(800, { name: 'tin', amount: 0 })).toBeNull()
  })
})

describe('formatPurchase', () => {
  it('names a whole number of units', () => {
    expect(formatPurchase(800, TIN)).toBe('2 tins')
  })

  it('keeps the singular for one', () => {
    expect(formatPurchase(400, TIN)).toBe('1 tin')
  })

  it('marks a total that does not divide evenly', () => {
    expect(formatPurchase(900, TIN)).toBe('~3 tins')
  })

  it('folds the stored unit name before pluralising it', () => {
    expect(formatPurchase(800, { name: 'Tins', amount: 400 })).toBe('2 tins')
  })
})
