import { describe, expect, it } from 'vitest'
import { extractRecipeJsonLd, openGraphImage } from '../supabase/functions/_shared/jsonld'

/** A page with the given JSON-LD payload embedded, plus enough noise to be real. */
function page(payload: unknown, extra = ''): string {
  return `<!doctype html><html><head><title>A recipe</title>
    <script>window.dataLayer = [{"recipeIngredient": "not this one"}]</script>
    <script type="application/ld+json">${JSON.stringify(payload)}</script>
    ${extra}
    </head><body><p>Cookie banner</p></body></html>`
}

const RECIPE = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  'name': 'Lentil soup',
  'recipeYield': '4 servings',
  'prepTime': 'PT10M',
  'cookTime': 'PT1H30M',
  'recipeIngredient': ['400g chopped tomatoes', '200g red lentils', '1 onion, diced'],
  'recipeInstructions': 'Soften the onion. Add everything else and simmer.'
}

describe('extractRecipeJsonLd', () => {
  it('reads a recipe a page publishes about itself', () => {
    const recipe = extractRecipeJsonLd(page(RECIPE))
    expect(recipe?.name).toBe('Lentil soup')
    expect(recipe?.base_servings).toBe(4)
    expect(recipe?.prep_minutes).toBe(10)
    expect(recipe?.cook_minutes).toBe(90)
    expect(recipe?.steps).toEqual(['Soften the onion. Add everything else and simmer.'])
  })

  it('splits each ingredient line into a quantity and a thing', () => {
    expect(extractRecipeJsonLd(page(RECIPE))?.ingredients).toEqual([
      { quantity: '400g', name: 'chopped tomatoes' },
      { quantity: '200g', name: 'red lentils' },
      { quantity: '1', name: 'onion' }
    ])
  })

  it('finds the recipe inside an @graph', () => {
    const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, RECIPE] }
    expect(extractRecipeJsonLd(page(graph))?.name).toBe('Lentil soup')
  })

  it('finds the recipe inside a bare array', () => {
    expect(extractRecipeJsonLd(page([{ '@type': 'Organization' }, RECIPE]))?.name).toBe('Lentil soup')
  })

  it('accepts a node typed as several things at once', () => {
    const both = { ...RECIPE, '@type': ['Recipe', 'NewsArticle'] }
    expect(extractRecipeJsonLd(page(both))?.name).toBe('Lentil soup')
  })

  it('accepts the fully qualified schema.org type', () => {
    const qualified = { ...RECIPE, '@type': 'http://schema.org/Recipe' }
    expect(extractRecipeJsonLd(page(qualified))?.name).toBe('Lentil soup')
  })

  it('keeps HowToStep instructions as separate steps', () => {
    const steps = {
      ...RECIPE,
      recipeInstructions: [
        { '@type': 'HowToStep', 'text': 'Soften the onion.' },
        { '@type': 'HowToStep', 'text': 'Simmer for an hour.' }
      ]
    }
    expect(extractRecipeJsonLd(page(steps))?.steps)
      .toEqual(['Soften the onion.', 'Simmer for an hour.'])
  })

  it('reaches into the steps of a HowToSection', () => {
    const sectioned = {
      ...RECIPE,
      recipeInstructions: [{
        '@type': 'HowToSection',
        'name': 'For the sauce',
        'itemListElement': [{ '@type': 'HowToStep', 'text': 'Fry the garlic.' }]
      }]
    }
    expect(extractRecipeJsonLd(page(sectioned))?.steps).toEqual(['Fry the garlic.'])
  })

  it('strips the markup and entities publishers leave in the text', () => {
    const marked = {
      ...RECIPE,
      name: 'Salt &amp; pepper squid',
      recipeInstructions: '<p>Heat the oil&hellip;</p><p>Fry in batches</p>'
    }
    const recipe = extractRecipeJsonLd(page(marked))
    expect(recipe?.name).toBe('Salt & pepper squid')
    expect(recipe?.steps).toEqual(['Heat the oil… Fry in batches'])
  })

  it.each([
    [4, 4],
    ['4', 4],
    ['Serves 4', 4],
    [['4 servings'], 4],
    ['a few', null]
  ])('reads recipeYield %j as %j', (yielded, expected) => {
    expect(extractRecipeJsonLd(page({ ...RECIPE, recipeYield: yielded }))?.base_servings)
      .toBe(expected)
  })

  it.each([
    ['PT45M', 45],
    ['PT2H', 120],
    ['PT1H30M', 90],
    ['30', 30],
    ['PT0M', null],
    ['about an hour', null]
  ])('reads a duration of %j as %j minutes', (written, expected) => {
    expect(extractRecipeJsonLd(page({ ...RECIPE, prepTime: written }))?.prep_minutes)
      .toBe(expected)
  })

  it('skips a malformed block and reads the good one', () => {
    const broken = '<script type="application/ld+json">{ oh dear,, }</script>'
    expect(extractRecipeJsonLd(page(RECIPE, broken))?.name).toBe('Lentil soup')
  })

  it('gives nothing back for a page with structured data but no recipe', () => {
    expect(extractRecipeJsonLd(page({ '@type': 'NewsArticle', 'name': 'Ten best pans' }))).toBeNull()
  })

  it('gives nothing back for a page with no structured data at all', () => {
    expect(extractRecipeJsonLd('<html><body>Just words</body></html>')).toBeNull()
  })

  it('gives nothing back for a recipe with no name to file it under', () => {
    const nameless = { ...RECIPE, name: '  ' }
    expect(extractRecipeJsonLd(page(nameless))).toBeNull()
  })

  it('reports an ingredient-less recipe rather than inventing lines', () => {
    // The caller treats this as "fall back to the model", not as an answer.
    const bare = { '@type': 'Recipe', 'name': 'Toast' }
    const recipe = extractRecipeJsonLd(page(bare))
    expect(recipe?.name).toBe('Toast')
    expect(recipe?.ingredients).toEqual([])
    expect(recipe?.steps).toEqual([])
  })
})

describe('the recipe photograph', () => {
  it('reads a bare address', () => {
    const withImage = { ...RECIPE, image: 'https://img.example.com/soup.jpg' }
    expect(extractRecipeJsonLd(page(withImage))?.image_url).toBe('https://img.example.com/soup.jpg')
  })

  it('reads an ImageObject, by url or by contentUrl', () => {
    const asObject = { ...RECIPE, image: { '@type': 'ImageObject', 'url': 'https://img.example.com/o.jpg' } }
    expect(extractRecipeJsonLd(page(asObject))?.image_url).toBe('https://img.example.com/o.jpg')

    const asContent = { ...RECIPE, image: { '@type': 'ImageObject', 'contentUrl': 'https://img.example.com/c.jpg' } }
    expect(extractRecipeJsonLd(page(asContent))?.image_url).toBe('https://img.example.com/c.jpg')
  })

  it('takes the first of a list, which sites publish largest first', () => {
    const several = { ...RECIPE, image: ['https://img.example.com/big.jpg', 'https://img.example.com/small.jpg'] }
    expect(extractRecipeJsonLd(page(several))?.image_url).toBe('https://img.example.com/big.jpg')
  })

  it('drops a relative path, which means nothing once the page is gone', () => {
    const relative = { ...RECIPE, image: '/assets/soup.jpg' }
    expect(extractRecipeJsonLd(page(relative))?.image_url).toBeNull()
  })

  it('is null when the page published no picture', () => {
    expect(extractRecipeJsonLd(page(RECIPE))?.image_url).toBeNull()
  })
})

describe('openGraphImage', () => {
  it('reads the tag whichever order its attributes are in', () => {
    expect(openGraphImage('<meta property="og:image" content="https://e.com/a.jpg">'))
      .toBe('https://e.com/a.jpg')
    expect(openGraphImage('<meta content="https://e.com/b.jpg" property="og:image"/>'))
      .toBe('https://e.com/b.jpg')
  })

  it('accepts the name= and og:image:url spellings sites also use', () => {
    expect(openGraphImage('<meta name="og:image" content="https://e.com/c.jpg">'))
      .toBe('https://e.com/c.jpg')
    expect(openGraphImage('<meta property="og:image:url" content="https://e.com/d.jpg">'))
      .toBe('https://e.com/d.jpg')
  })

  it('decodes the entity-encoded ampersands a shared address arrives with', () => {
    expect(openGraphImage('<meta property="og:image" content="https://e.com/e.jpg?w=1&amp;h=2">'))
      .toBe('https://e.com/e.jpg?w=1&h=2')
  })

  it('keeps looking past a tag it cannot use', () => {
    const both = '<meta property="og:image" content="/relative.jpg">'
      + '<meta property="og:image" content="https://e.com/good.jpg">'
    expect(openGraphImage(both)).toBe('https://e.com/good.jpg')
  })

  it('is null when there is no og:image to read', () => {
    expect(openGraphImage('<meta property="og:title" content="Dinner">')).toBeNull()
    expect(openGraphImage('<html><body>Just words</body></html>')).toBeNull()
  })
})
