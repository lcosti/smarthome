import { describe, expect, it } from 'vitest'
import {
  coerceExtractedRecipe,
  importFailureMessage,
  looksLikeUrl,
  splitMethodIntoSteps
} from '../app/utils/recipe-import'

const VALID = {
  name: 'Tomato pasta',
  base_servings: 4,
  prep_minutes: 10,
  cook_minutes: 25,
  steps: ['Boil pasta.', 'Make sauce.'],
  ingredients: [
    { name: 'chopped tomatoes', quantity: '400g' },
    { name: 'spaghetti', quantity: '300g' }
  ],
  nutrition: null,
  image_url: 'https://example.com/tomato-pasta.jpg'
}

const PANEL = {
  kcal: 480,
  fat_g: 34,
  saturates_g: 15,
  carbs_g: 15,
  sugars_g: 10,
  fibre_g: 5,
  protein_g: 26,
  salt_g: 1.05
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

  it('keeps an absolute picture address and drops anything else', () => {
    // The value reaches an <img src>, so this boundary is a filter and not a
    // formality — a page can publish whatever it likes in its structured data.
    expect(coerceExtractedRecipe({ ...VALID, image_url: ' https://e.com/a.jpg ' })?.image_url)
      .toBe('https://e.com/a.jpg')
    expect(coerceExtractedRecipe({ ...VALID, image_url: '/relative.jpg' })?.image_url).toBeNull()
    expect(coerceExtractedRecipe({ ...VALID, image_url: 'javascript:alert(1)' })?.image_url).toBeNull()
    expect(coerceExtractedRecipe({ ...VALID, image_url: 'data:image/png;base64,AAAA' })?.image_url).toBeNull()
    expect(coerceExtractedRecipe({ ...VALID, image_url: null })?.image_url).toBeNull()
    expect(coerceExtractedRecipe({ ...VALID, image_url: 42 })?.image_url).toBeNull()
  })

  it('imports a recipe from a function that has never heard of pictures', () => {
    // The bundle and the functions deploy separately: a response from before
    // this column existed must still make a recipe, just one without a picture.
    const older = { ...VALID, image_url: undefined }
    expect(coerceExtractedRecipe(older)?.name).toBe('Tomato pasta')
    expect(coerceExtractedRecipe(older)?.image_url).toBeNull()
  })

  it('keeps a nutrition panel of storable numbers', () => {
    expect(coerceExtractedRecipe({ ...VALID, nutrition: PANEL })?.nutrition).toEqual(PANEL)
  })

  it('nulls the nutrition figures it cannot store, keeps their neighbours', () => {
    const result = coerceExtractedRecipe({
      ...VALID,
      nutrition: { ...PANEL, fat_g: '34 g', sugars_g: -1, salt_g: Number.NaN }
    })
    expect(result?.nutrition?.kcal).toBe(480)
    expect(result?.nutrition?.fat_g).toBeNull()
    expect(result?.nutrition?.sugars_g).toBeNull()
    expect(result?.nutrition?.salt_g).toBeNull()
  })

  it('treats a panel with nothing storable as no panel', () => {
    expect(coerceExtractedRecipe({ ...VALID, nutrition: { kcal: 'lots' } })?.nutrition).toBeNull()
    expect(coerceExtractedRecipe({ ...VALID, nutrition: 'per serving' })?.nutrition).toBeNull()
  })

  it('imports a recipe from a function that has never heard of nutrition', () => {
    const older = { ...VALID, nutrition: undefined }
    expect(coerceExtractedRecipe(older)?.name).toBe('Tomato pasta')
    expect(coerceExtractedRecipe(older)?.nutrition).toBeNull()
  })

  it('trims strings and drops blank steps', () => {
    const result = coerceExtractedRecipe({
      ...VALID,
      name: ' Tomato pasta ',
      steps: [' Boil pasta. ', '  ', 42, null, 'Make sauce.']
    })
    expect(result?.name).toBe('Tomato pasta')
    expect(result?.steps).toEqual(['Boil pasta.', 'Make sauce.'])
  })

  it('accepts a method-less source rather than rejecting it', () => {
    expect(coerceExtractedRecipe({ ...VALID, steps: [] })?.steps).toEqual([])
    expect(coerceExtractedRecipe({ ...VALID, steps: undefined, method: null })?.steps).toEqual([])
  })

  // A deployed bundle and a deployed function change independently, so a client
  // on this version can still be answered by a function on the old one.
  it('splits a legacy method string into steps', () => {
    const result = coerceExtractedRecipe({
      ...VALID,
      steps: undefined,
      method: 'Boil pasta.\n\nMake sauce.'
    })
    expect(result?.steps).toEqual(['Boil pasta.', 'Make sauce.'])
  })

  it('prefers steps over a method sent alongside them', () => {
    const result = coerceExtractedRecipe({ ...VALID, method: 'Ignore me.' })
    expect(result?.steps).toEqual(['Boil pasta.', 'Make sauce.'])
  })
})

describe('splitMethodIntoSteps', () => {
  it('splits on blank lines, keeping line breaks inside a step', () => {
    expect(splitMethodIntoSteps('Heat oil.\nAdd onion.\n\nSimmer.'))
      .toEqual(['Heat oil.\nAdd onion.', 'Simmer.'])
  })

  it('tolerates the whitespace-only lines a paste brings with it', () => {
    expect(splitMethodIntoSteps('One.\n   \nTwo.\n\n\n\nThree.'))
      .toEqual(['One.', 'Two.', 'Three.'])
  })

  it('is empty for nothing worth calling a step', () => {
    expect(splitMethodIntoSteps('')).toEqual([])
    expect(splitMethodIntoSteps('   \n\n  ')).toEqual([])
  })

  it('leaves one paragraph as one step', () => {
    expect(splitMethodIntoSteps('Cook it.')).toEqual(['Cook it.'])
  })
})

describe('importFailureMessage', () => {
  const SIGNAL = 'Could not read that page — check your signal and try again.'

  /** What supabase-js hands back: the error object, with a Response in `context`. */
  function httpError(status: number, body: string, type = 'application/json') {
    return {
      name: 'FunctionsHttpError',
      context: new Response(body, { status, headers: { 'Content-Type': type } })
    }
  }

  it('prefers the function\'s own words', async () => {
    const error = httpError(422, JSON.stringify({ error: 'That page did not load (403)' }))
    expect(await importFailureMessage(error, SIGNAL)).toBe('That page did not load (403)')
  })

  it('names the status when the function was never deployed', async () => {
    // What Supabase's gateway answers for a function that is not there.
    const error = httpError(404, JSON.stringify({
      code: 'NOT_FOUND',
      message: 'Requested function was not found'
    }))
    const message = await importFailureMessage(error, SIGNAL)
    expect(message).toContain('404')
    expect(message).not.toBe(SIGNAL)
  })

  it('names the status when the local edge runtime is down', async () => {
    // What Kong answers when the edge-runtime container has stopped.
    const error = httpError(503, JSON.stringify({ message: 'name resolution failed' }))
    const message = await importFailureMessage(error, SIGNAL)
    expect(message).toContain('503')
    expect(message).not.toBe(SIGNAL)
  })

  it('names the status when the body is not JSON at all', async () => {
    const error = httpError(500, '<html>Internal Server Error</html>', 'text/html')
    expect(await importFailureMessage(error, SIGNAL)).toContain('500')
  })

  it('ignores a blank error string in an otherwise valid body', async () => {
    const error = httpError(500, JSON.stringify({ error: '   ' }))
    expect(await importFailureMessage(error, SIGNAL)).toContain('500')
  })

  it('falls back to the signal message when the request never landed', async () => {
    // FunctionsFetchError puts the fetch error in `context`, not a Response —
    // the case the signal message was written for.
    const error = { name: 'FunctionsFetchError', context: new TypeError('fetch failed') }
    expect(await importFailureMessage(error, SIGNAL)).toBe(SIGNAL)
  })

  it('falls back for anything else it is handed', async () => {
    expect(await importFailureMessage(new Error('boom'), SIGNAL)).toBe(SIGNAL)
    expect(await importFailureMessage(null, SIGNAL)).toBe(SIGNAL)
    expect(await importFailureMessage({ context: undefined }, SIGNAL)).toBe(SIGNAL)
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
