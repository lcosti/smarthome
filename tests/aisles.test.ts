import { describe, expect, it } from 'vitest'
import { aisleIcon, guessAisleCategory, guessAisleId } from '../app/utils/aisles'

/** The seven the seed creates, as the store rows a guess is resolved against. */
const SEEDED = [
  { id: 'a-veg', name: 'Fruit & veg' },
  { id: 'a-bakery', name: 'Bakery' },
  { id: 'a-chilled', name: 'Chilled' },
  { id: 'a-meat', name: 'Meat & fish' },
  { id: 'a-frozen', name: 'Frozen' },
  { id: 'a-cupboard', name: 'Cupboard' },
  { id: 'a-household', name: 'Household' }
]

describe('guessAisleCategory', () => {
  it.each([
    ['garlic', 'fruit & veg'],
    ['chestnut mushrooms', 'fruit & veg'],
    ['handful parsley leaves', 'fruit & veg'],
    ['chicken thighs', 'meat & fish'],
    ['smoked streaky bacon', 'meat & fish'],
    ['parmesan', 'chilled'],
    ['free range eggs', 'chilled'],
    ['risotto rice', 'cupboard'],
    ['vegetable stock cube', 'cupboard'],
    ['olive oil', 'cupboard'],
    ['bin bags', 'household']
  ])('files %j under %j', (name, expected) => {
    expect(guessAisleCategory(name)).toBe(expected)
  })

  it('prefers the longer keyword when two match', () => {
    // Both `onion` and `spring onion` are in the list; the specific one wins.
    expect(guessAisleCategory('spring onions')).toBe('fruit & veg')
    // `coconut milk` is a cupboard tin, not the chilled `milk` inside it.
    expect(guessAisleCategory('coconut milk')).toBe('cupboard')
    expect(guessAisleCategory('peanut butter')).toBe('cupboard')
  })

  it('matches whole words only', () => {
    // Not `pea` inside `peanut`, and not `ham` inside `hammer`.
    expect(guessAisleCategory('hammer')).toBeNull()
    expect(guessAisleCategory('something unheard of')).toBeNull()
  })

  it('has no opinion about a name it does not know', () => {
    expect(guessAisleCategory('gochujang')).toBeNull()
    expect(guessAisleCategory('')).toBeNull()
  })
})

describe('guessAisleId', () => {
  it('resolves a guess against the household\'s own aisles', () => {
    expect(guessAisleId('garlic cloves', SEEDED)).toBe('a-veg')
    expect(guessAisleId('chicken breast', SEEDED)).toBe('a-meat')
    expect(guessAisleId('parmesan', SEEDED)).toBe('a-chilled')
  })

  it('still finds an aisle somebody has renamed', () => {
    const renamed = [{ id: 'a-1', name: 'Fruit and Vegetables' }]
    expect(guessAisleId('garlic', renamed)).toBe('a-1')
    expect(guessAisleId('garlic', [{ id: 'a-2', name: 'Produce' }])).toBe('a-2')
  })

  it('gives nothing when the household has no such aisle', () => {
    // A household that deleted Frozen gets no frozen guesses, rather than its
    // peas landing somewhere arbitrary.
    expect(guessAisleId('ice cream', [{ id: 'a-veg', name: 'Fruit & veg' }])).toBeNull()
    expect(guessAisleId('garlic', [])).toBeNull()
  })

  it('ignores a deleted aisle', () => {
    const withDeleted = [{ id: 'a-old', name: 'Fruit & veg', deleted_at: '2026-07-30T10:00:00.000Z' }]
    expect(guessAisleId('garlic', withDeleted)).toBeNull()
  })

  it('gives nothing for a name it cannot place', () => {
    expect(guessAisleId('gochujang', SEEDED)).toBeNull()
  })
})

describe('aisleIcon', () => {
  it('draws the same carrot however the aisle is spelled', () => {
    expect(aisleIcon('Fruit & veg')).toBe('i-lucide-carrot')
    expect(aisleIcon('Fruit and Vegetables')).toBe('i-lucide-carrot')
  })
})
