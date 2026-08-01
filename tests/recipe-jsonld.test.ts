import { describe, expect, it } from 'vitest'
import { extractRecipeJsonLd, pageImage } from '../supabase/functions/_shared/jsonld'

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

describe('the nutrition panel', () => {
  it('reads the panel a site publishes, units and all', () => {
    const fed = {
      ...RECIPE,
      nutrition: {
        '@type': 'NutritionInformation',
        'calories': '480 calories',
        'fatContent': '34 g',
        'saturatedFatContent': '15&nbsp;g',
        'carbohydrateContent': '15 g',
        'sugarContent': '10 g',
        'fiberContent': '5 g',
        'proteinContent': '26 g',
        'sodiumContent': '1.05 g'
      }
    }
    expect(extractRecipeJsonLd(page(fed))?.nutrition).toEqual({
      kcal: 480,
      fat_g: 34,
      saturates_g: 15,
      carbs_g: 15,
      sugars_g: 10,
      fibre_g: 5,
      protein_g: 26,
      salt_g: 1.05
    })
  })

  it('keeps the decimals a panel prints', () => {
    const decimal = { ...RECIPE, nutrition: { '@type': 'NutritionInformation', 'fatContent': '34.5g' } }
    expect(extractRecipeJsonLd(page(decimal))?.nutrition?.fat_g).toBe(34.5)
  })

  it('leaves out what the panel left out', () => {
    const partial = { ...RECIPE, nutrition: { '@type': 'NutritionInformation', 'calories': '480 kcal' } }
    const panel = extractRecipeJsonLd(page(partial))?.nutrition
    expect(panel?.kcal).toBe(480)
    expect(panel?.fat_g).toBeNull()
    expect(panel?.salt_g).toBeNull()
  })

  it('turns milligrams of sodium into grams of salt', () => {
    const american = { ...RECIPE, nutrition: { '@type': 'NutritionInformation', 'sodiumContent': '460 mg' } }
    expect(extractRecipeJsonLd(page(american))?.nutrition?.salt_g).toBe(1.15)
  })

  it('keeps grams of sodiumContent as salt, which is what UK sites put there', () => {
    const british = { ...RECIPE, nutrition: { '@type': 'NutritionInformation', 'sodiumContent': '1.05 g' } }
    expect(extractRecipeJsonLd(page(british))?.nutrition?.salt_g).toBe(1.05)
  })

  /**
   * The magnitude decides, not the word. BBC Good Food says "milligram of sodium"
   * on a page printing salt 1.45g; a site saying the same words about a real
   * milligram figure means it. Reading either literally breaks the other.
   */
  it.each([
    ['1.45 milligram of sodium', 1.45],
    ['1450 milligrams of sodium', 3.63],
    ['0.8 milligrams', 0.8]
  ])('reads sodiumContent %j as %j grams of salt', (written, expected) => {
    const node = { ...RECIPE, nutrition: { '@type': 'NutritionInformation', 'sodiumContent': written } }
    expect(extractRecipeJsonLd(page(node))?.nutrition?.salt_g).toBe(expected)
  })
})

/**
 * The panel exactly as bbcgoodfood.com/recipes/mushroom-risotto publishes it,
 * against the figures its own page prints. A real page rather than a constructed
 * one, because this is the site the household actually imports from — and because
 * its sodiumContent wording is the trap the magnitude rule exists for.
 */
describe('a real BBC Good Food panel', () => {
  it('reads the whole panel as the page prints it', () => {
    const risotto = {
      ...RECIPE,
      name: 'Mushroom risotto',
      recipeYield: 4,
      nutrition: {
        '@type': 'NutritionInformation',
        'calories': '445 calories',
        'fatContent': '17 grams fat',
        'saturatedFatContent': '7.7 grams saturated fat',
        'carbohydrateContent': '63 grams carbohydrates',
        'sugarContent': '3 grams sugar',
        'fiberContent': '4 grams fiber',
        'proteinContent': '15 grams protein',
        'sodiumContent': '1.45 milligram of sodium'
      }
    }
    const recipe = extractRecipeJsonLd(page(risotto))
    expect(recipe?.base_servings).toBe(4)
    expect(recipe?.nutrition).toEqual({
      kcal: 445,
      fat_g: 17,
      saturates_g: 7.7,
      carbs_g: 63,
      sugars_g: 3,
      fibre_g: 4,
      protein_g: 15,
      salt_g: 1.45
    })
  })

  it('reads kilojoules as the kcal the odd site means by calories', () => {
    const kj = { ...RECIPE, nutrition: { '@type': 'NutritionInformation', 'calories': '2008 kJ' } }
    expect(extractRecipeJsonLd(page(kj))?.nutrition?.kcal).toBe(480)
  })

  it('is null when the page published no panel', () => {
    expect(extractRecipeJsonLd(page(RECIPE))?.nutrition).toBeNull()
  })

  it('is null rather than a panel of nothing', () => {
    const empty = { ...RECIPE, nutrition: { '@type': 'NutritionInformation', 'calories': 'varies' } }
    expect(extractRecipeJsonLd(page(empty))?.nutrition).toBeNull()
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

describe('pageImage', () => {
  it('reads the tag whichever order its attributes are in', () => {
    expect(pageImage('<meta property="og:image" content="https://e.com/a.jpg">'))
      .toBe('https://e.com/a.jpg')
    expect(pageImage('<meta content="https://e.com/b.jpg" property="og:image"/>'))
      .toBe('https://e.com/b.jpg')
  })

  it('accepts the name= and og:image:url spellings sites also use', () => {
    expect(pageImage('<meta name="og:image" content="https://e.com/c.jpg">'))
      .toBe('https://e.com/c.jpg')
    expect(pageImage('<meta property="og:image:url" content="https://e.com/d.jpg">'))
      .toBe('https://e.com/d.jpg')
  })

  it('decodes the entity-encoded ampersands a shared address arrives with', () => {
    expect(pageImage('<meta property="og:image" content="https://e.com/e.jpg?w=1&amp;h=2">'))
      .toBe('https://e.com/e.jpg?w=1&h=2')
  })

  it('keeps looking past a tag it cannot use', () => {
    const both = '<meta property="og:image" content="/relative.jpg">'
      + '<meta property="og:image" content="https://e.com/good.jpg">'
    expect(pageImage(both)).toBe('https://e.com/good.jpg')
  })

  it('falls back to twitter:image, then rel=image_src', () => {
    expect(pageImage('<meta name="twitter:image" content="https://e.com/t.jpg">'))
      .toBe('https://e.com/t.jpg')
    expect(pageImage('<meta name="twitter:image:src" content="https://e.com/s.jpg">'))
      .toBe('https://e.com/s.jpg')
    expect(pageImage('<link rel="image_src" href="https://e.com/l.jpg">'))
      .toBe('https://e.com/l.jpg')
  })

  it('prefers what the page declares over what it merely paints first', () => {
    const both = '<link rel="preload" as="image" href="https://e.com/hero.jpg">'
      + '<meta property="og:image" content="https://e.com/shared.jpg">'
    expect(pageImage(both)).toBe('https://e.com/shared.jpg')
  })

  it('takes the largest paint when a page publishes no social tags at all', () => {
    // tomkerridge.com: no Recipe JSON-LD, og:* without an og:image, and the
    // photograph named twice as the thing to paint first.
    const preload = '<link rel="preload" data-rocket-preload as="image"'
      + ' href="https://tomkerridge.com/wp-content/uploads/2020/11/Ribeye-square.jpg" fetchpriority="high">'
    expect(pageImage(preload)).toBe('https://tomkerridge.com/wp-content/uploads/2020/11/Ribeye-square.jpg')

    const img = '<img fetchpriority="high" src="https://e.com/dish.jpg" class="img-fluid" alt="Dinner">'
    expect(pageImage(img)).toBe('https://e.com/dish.jpg')
  })

  it('reads a lazy hero out of data-src rather than its stub', () => {
    const lazy = '<img fetchpriority="high" src="https://e.com/placeholder.gif"'
      + ' data-src="https://e.com/dish.jpg">'
    expect(pageImage(lazy)).toBe('https://e.com/dish.jpg')
  })

  it('will not guess its way to the masthead', () => {
    const logo = '<img fetchpriority="high" src="https://e.com/TK-Logo-Gold.png">'
      + '<img fetchpriority="high" src="https://e.com/dish.jpg">'
    expect(pageImage(logo)).toBe('https://e.com/dish.jpg')
    expect(pageImage('<link rel="preload" as="image" href="https://e.com/icons/sprite.svg">')).toBeNull()
  })

  it('is null when there is no picture to read', () => {
    expect(pageImage('<meta property="og:title" content="Dinner">')).toBeNull()
    expect(pageImage('<html><body>Just words</body></html>')).toBeNull()
    expect(pageImage('<link rel="preload" as="font" href="https://e.com/f.woff2">')).toBeNull()
  })
})
