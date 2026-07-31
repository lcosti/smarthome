import { describe, expect, it } from 'vitest'
import { coerceExtractedRecipe, looksLikeUrl } from '../app/utils/recipe-import'

const VALID = {
  name: 'Tomato pasta',
  base_servings: 4,
  prep_minutes: 10,
  cook_minutes: 25,
  method: 'Boil pasta.\n\nMake sauce.',
  ingredients: [
    { name: 'chopped tomatoes', quantity: '400g' },
    { name: 'spaghetti', quantity: '300g' }
  ]
}

describe('coerceExtractedRecipe', () => {
  it('passes a well-formed payload through unchanged', () => {
    expect(coerceExtractedRecipe(VALID)).toEqual(VALID)
  })

  it('rejects things that are not objects', () => {
    expect(coerceExtractedRecipe(null)).toBeNull()
    expect(coerceExtractedRecipe('a recipe')).toBeNull()
    expect(coerceExtractedRecipe(42)).toBeNull()
    expect(coerceExtractedRecipe([VALID])).toBeNull()
  })

  it('rejects a missing or blank name', () => {
    expect(coerceExtractedRecipe({ ...VALID, name: undefined })).toBeNull()
    expect(coerceExtractedRecipe({ ...VALID, name: '   ' })).toBeNull()
  })

  it('rejects non-array ingredients', () => {
    expect(coerceExtractedRecipe({ ...VALID, ingredients: 'tomatoes' })).toBeNull()
    expect(coerceExtractedRecipe({ ...VALID, ingredients: undefined })).toBeNull()
  })

  it('accepts an empty ingredient list — the page may only show the method', () => {
    expect(coerceExtractedRecipe({ ...VALID, ingredients: [] })?.ingredients).toEqual([])
  })

  it('drops ingredient lines with blank names, keeps their neighbours', () => {
    const result = coerceExtractedRecipe({
      ...VALID,
      ingredients: [
        { name: '  ', quantity: '1' },
        { name: 'salt', quantity: null },
        'garbage',
        null
      ]
    })
    expect(result?.ingredients).toEqual([{ name: 'salt', quantity: null }])
  })

  it('treats blank quantities as null', () => {
    const result = coerceExtractedRecipe({
      ...VALID,
      ingredients: [{ name: 'salt', quantity: '  ' }]
    })
    expect(result?.ingredients[0]?.quantity).toBeNull()
  })

  it('defaults servings to 2 when missing or nonsense', () => {
    expect(coerceExtractedRecipe({ ...VALID, base_servings: null })?.base_servings).toBe(2)
    expect(coerceExtractedRecipe({ ...VALID, base_servings: 0 })?.base_servings).toBe(2)
    expect(coerceExtractedRecipe({ ...VALID, base_servings: 4.5 })?.base_servings).toBe(2)
  })

  it('clamps absurd servings', () => {
    expect(coerceExtractedRecipe({ ...VALID, base_servings: 400 })?.base_servings).toBe(24)
  })

  it('nulls out nonsense minutes rather than rejecting the recipe', () => {
    const result = coerceExtractedRecipe({ ...VALID, prep_minutes: -5, cook_minutes: 10_000 })
    expect(result?.prep_minutes).toBeNull()
    expect(result?.cook_minutes).toBeNull()
  })

  it('trims strings and nulls a blank method', () => {
    const result = coerceExtractedRecipe({ ...VALID, name: ' Tomato pasta ', method: '  ' })
    expect(result?.name).toBe('Tomato pasta')
    expect(result?.method).toBeNull()
  })
})

describe('looksLikeUrl', () => {
  it('recognises a pasted link', () => {
    expect(looksLikeUrl('https://www.bbcgoodfood.com/recipes/lentil-soup')).toBe(true)
    expect(looksLikeUrl('http://example.com/r')).toBe(true)
  })

  it('ignores the whitespace a paste brings with it', () => {
    expect(looksLikeUrl('  https://example.com/r  ')).toBe(true)
  })

  it('leaves a recipe name alone', () => {
    expect(looksLikeUrl('Lentil soup')).toBe(false)
    expect(looksLikeUrl('Tom\'s https soup')).toBe(false)
    expect(looksLikeUrl('bbcgoodfood.com/recipes/lentil-soup')).toBe(false)
    expect(looksLikeUrl('')).toBe(false)
  })
})
