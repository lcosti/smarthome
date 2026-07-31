import { describe, expect, it } from 'vitest'
import { splitIngredientLine } from '../supabase/functions/_shared/ingredient-line'

describe('splitIngredientLine', () => {
  it('takes a metric quantity off the front', () => {
    expect(splitIngredientLine('400g chopped tomatoes'))
      .toEqual({ quantity: '400g', name: 'chopped tomatoes' })
  })

  it('keeps a spelled-out unit with its number', () => {
    expect(splitIngredientLine('2 tbsp olive oil'))
      .toEqual({ quantity: '2 tbsp', name: 'olive oil' })
  })

  it('reads a mixed vulgar fraction', () => {
    expect(splitIngredientLine('1½ tsp salt'))
      .toEqual({ quantity: '1½ tsp', name: 'salt' })
  })

  it('reads a written fraction', () => {
    expect(splitIngredientLine('1 1/2 cups plain flour'))
      .toEqual({ quantity: '1 1/2 cups', name: 'plain flour' })
  })

  it('keeps a range together — better verbatim than confidently halved', () => {
    expect(splitIngredientLine('2-3 cloves garlic'))
      .toEqual({ quantity: '2-3 cloves', name: 'garlic' })
  })

  it('drops the "of" that a unit word leaves behind', () => {
    expect(splitIngredientLine('2 cloves of garlic'))
      .toEqual({ quantity: '2 cloves', name: 'garlic' })
  })

  it('keeps a whole multiplied pack size in the quantity', () => {
    expect(splitIngredientLine('1 x 400g tin chopped tomatoes'))
      .toEqual({ quantity: '1 x 400g tin', name: 'chopped tomatoes' })
  })

  it('leaves a line with no number alone', () => {
    expect(splitIngredientLine('Salt and pepper'))
      .toEqual({ quantity: null, name: 'Salt and pepper' })
  })

  it('only takes a word it recognises as a unit', () => {
    // "1 onion" must not become a quantity, leaving an ingredient called "diced".
    expect(splitIngredientLine('1 onion, diced'))
      .toEqual({ quantity: '1', name: 'onion' })
  })

  it('drops a trailing preparation clause', () => {
    expect(splitIngredientLine('200g carrots, finely chopped'))
      .toEqual({ quantity: '200g', name: 'carrots' })
  })

  it('keeps a trailing clause that is part of the name', () => {
    expect(splitIngredientLine('400g tomatoes, tinned'))
      .toEqual({ quantity: '400g', name: 'tomatoes, tinned' })
  })

  it('reads a space between number and unit', () => {
    expect(splitIngredientLine('100 ml milk'))
      .toEqual({ quantity: '100 ml', name: 'milk' })
  })

  it('treats fl oz as one unit', () => {
    expect(splitIngredientLine('4 fl oz double cream'))
      .toEqual({ quantity: '4 fl oz', name: 'double cream' })
  })

  it('keeps a line that is nothing but a quantity whole', () => {
    // Better an odd-looking ingredient than a nameless one.
    expect(splitIngredientLine('400g')).toEqual({ quantity: null, name: '400g' })
  })

  it('collapses the whitespace a page put in', () => {
    expect(splitIngredientLine('  2  tbsp   soy   sauce '))
      .toEqual({ quantity: '2 tbsp', name: 'soy sauce' })
  })

  it('gives an empty line nothing to say', () => {
    expect(splitIngredientLine('   ')).toEqual({ quantity: null, name: '' })
  })
})
