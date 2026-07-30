import { describe, expect, it } from 'vitest'
import type { AliasLike, IngredientLike } from '../app/utils/ingredients'
import {
  aliasId,
  chaseMerge,
  normaliseIngredientName,
  resolveIngredient,
  suggestIngredients
} from '../app/utils/ingredients'

const HOUSEHOLD = 'aaaaaaaa-0000-4000-8000-000000000001'

function ingredient(id: string, name: string, extra: Partial<IngredientLike> = {}): IngredientLike {
  return {
    id,
    name,
    merged_into: null,
    deleted_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...extra
  }
}

function alias(ingredientId: string, text: string, extra: Partial<AliasLike> = {}): AliasLike {
  return { ingredient_id: ingredientId, alias: text, deleted_at: null, ...extra }
}

/** Built from a list so the insertion order can be varied in a test. */
function mapOf(rows: IngredientLike[]): Map<string, IngredientLike> {
  return new Map(rows.map(row => [row.id, row]))
}

describe('normaliseIngredientName', () => {
  it('ignores case and surrounding space', () => {
    expect(normaliseIngredientName('  Chopped Tomatoes ')).toBe('chopped tomatoes')
  })

  it('collapses repeated spaces', () => {
    expect(normaliseIngredientName('chopped   tomatoes')).toBe('chopped tomatoes')
  })
})

describe('aliasId', () => {
  it('is the same for the same alias', () => {
    expect(aliasId(HOUSEHOLD, 'i1', 'tinned tomatoes')).toBe(aliasId(HOUSEHOLD, 'i1', 'tinned tomatoes'))
  })

  it('ignores how the alias was capitalised or spaced', () => {
    expect(aliasId(HOUSEHOLD, 'i1', ' Tinned  Tomatoes ')).toBe(aliasId(HOUSEHOLD, 'i1', 'tinned tomatoes'))
  })

  it('separates the same alias on different ingredients', () => {
    expect(aliasId(HOUSEHOLD, 'i1', 'toms')).not.toBe(aliasId(HOUSEHOLD, 'i2', 'toms'))
  })

  it('separates the same alias in different households', () => {
    expect(aliasId(HOUSEHOLD, 'i1', 'toms')).not.toBe(aliasId('other', 'i1', 'toms'))
  })
})

describe('chaseMerge', () => {
  it('returns a live row unchanged', () => {
    const rows = mapOf([ingredient('i1', 'Tomatoes')])
    expect(chaseMerge('i1', rows)?.id).toBe('i1')
  })

  it('follows a merge to the winner', () => {
    const rows = mapOf([
      ingredient('loser', 'Toms', { merged_into: 'winner', deleted_at: '2026-07-02T00:00:00.000Z' }),
      ingredient('winner', 'Tomatoes')
    ])
    expect(chaseMerge('loser', rows)?.id).toBe('winner')
  })

  it('follows a chain of merges', () => {
    const rows = mapOf([
      ingredient('a', 'A', { merged_into: 'b', deleted_at: '2026-07-02T00:00:00.000Z' }),
      ingredient('b', 'B', { merged_into: 'c', deleted_at: '2026-07-03T00:00:00.000Z' }),
      ingredient('c', 'C')
    ])
    expect(chaseMerge('a', rows)?.id).toBe('c')
  })

  it('does not hang on a cycle', () => {
    const rows = mapOf([
      ingredient('a', 'A', { merged_into: 'b' }),
      ingredient('b', 'B', { merged_into: 'a' })
    ])
    expect(chaseMerge('a', rows)).toBeNull()
  })

  it('keeps a live row whose merge target this device has not pulled yet', () => {
    const rows = mapOf([ingredient('a', 'A', { merged_into: 'not-here' })])
    expect(chaseMerge('a', rows)?.id).toBe('a')
  })

  it('returns nothing for a plainly deleted ingredient', () => {
    const rows = mapOf([ingredient('a', 'A', { deleted_at: '2026-07-02T00:00:00.000Z' })])
    expect(chaseMerge('a', rows)).toBeNull()
  })

  it('returns nothing for an id it has never heard of', () => {
    expect(chaseMerge('nope', mapOf([]))).toBeNull()
    expect(chaseMerge(null, mapOf([]))).toBeNull()
  })
})

describe('resolveIngredient', () => {
  const tomatoes = ingredient('i1', 'Chopped tomatoes')
  const rice = ingredient('i2', 'Basmati rice')

  it('matches a canonical name exactly, whatever the case', () => {
    expect(resolveIngredient('chopped TOMATOES', mapOf([tomatoes, rice]))?.id).toBe('i1')
  })

  it('matches a recorded alias', () => {
    const aliases = [alias('i1', 'tinned tomatoes')]
    expect(resolveIngredient('Tinned Tomatoes', mapOf([tomatoes]), aliases)?.id).toBe('i1')
  })

  it('prefers a canonical name over another ingredient alias of the same text', () => {
    const aliases = [alias('i2', 'chopped tomatoes')]
    expect(resolveIngredient('chopped tomatoes', mapOf([tomatoes, rice]), aliases)?.id).toBe('i1')
  })

  it('follows a merge when the alias points at a row that was merged away', () => {
    const rows = mapOf([
      ingredient('old', 'Toms', { merged_into: 'i1', deleted_at: '2026-07-02T00:00:00.000Z' }),
      tomatoes
    ])
    expect(resolveIngredient('toms', rows, [alias('old', 'toms')])?.id).toBe('i1')
  })

  it('refuses a prefix, because this runs when somebody presses enter', () => {
    // "pe" must not become "pears" while they are still typing "pesto".
    expect(resolveIngredient('pe', mapOf([ingredient('i9', 'Pears')]))).toBeNull()
  })

  it('ignores deleted ingredients', () => {
    const gone = ingredient('i1', 'Chopped tomatoes', { deleted_at: '2026-07-02T00:00:00.000Z' })
    expect(resolveIngredient('chopped tomatoes', mapOf([gone]))).toBeNull()
  })

  it('ignores deleted aliases', () => {
    const aliases = [alias('i1', 'toms', { deleted_at: '2026-07-02T00:00:00.000Z' })]
    expect(resolveIngredient('toms', mapOf([tomatoes]), aliases)).toBeNull()
  })

  it('returns nothing for nothing', () => {
    expect(resolveIngredient('   ', mapOf([tomatoes]))).toBeNull()
  })

  it('returns nothing when the name is simply unknown', () => {
    expect(resolveIngredient('saffron', mapOf([tomatoes]))).toBeNull()
  })

  describe('when two devices created the same ingredient offline', () => {
    const older = ingredient('bbbb', 'Tomatoes', { created_at: '2026-07-01T00:00:00.000Z' })
    const newer = ingredient('aaaa', 'Tomatoes', { created_at: '2026-07-05T00:00:00.000Z' })

    it('picks the older one', () => {
      expect(resolveIngredient('tomatoes', mapOf([older, newer]))?.id).toBe('bbbb')
    })

    it('picks the same one whichever order the rows arrived in', () => {
      // The two devices pull in different orders. If the tie broke on iteration
      // order they would resolve typing differently and silently stop aggregating
      // with each other.
      expect(resolveIngredient('tomatoes', mapOf([newer, older]))?.id).toBe('bbbb')
    })

    it('falls back to the id when they were created in the same instant', () => {
      const a = ingredient('zzzz', 'Tomatoes', { created_at: '2026-07-01T00:00:00.000Z' })
      const b = ingredient('kkkk', 'Tomatoes', { created_at: '2026-07-01T00:00:00.000Z' })
      expect(resolveIngredient('tomatoes', mapOf([a, b]))?.id).toBe('kkkk')
      expect(resolveIngredient('tomatoes', mapOf([b, a]))?.id).toBe('kkkk')
    })
  })
})

describe('suggestIngredients', () => {
  const rows = mapOf([
    ingredient('i1', 'Chopped tomatoes'),
    ingredient('i2', 'Cherry tomatoes'),
    ingredient('i3', 'Tomato puree'),
    ingredient('i4', 'Basmati rice')
  ])

  it('offers a prefix match', () => {
    expect(suggestIngredients('tomato', rows).map(s => s.ingredient.id)).toContain('i3')
  })

  it('offers substring matches too', () => {
    const ids = suggestIngredients('tomato', rows).map(s => s.ingredient.id)
    expect(ids).toEqual(expect.arrayContaining(['i1', 'i2', 'i3']))
  })

  it('leaves out what does not match at all', () => {
    expect(suggestIngredients('tomato', rows).map(s => s.ingredient.id)).not.toContain('i4')
  })

  it('puts an exact match first', () => {
    expect(suggestIngredients('cherry tomatoes', rows)[0]?.ingredient.id).toBe('i2')
  })

  it('ranks a prefix above a substring', () => {
    // "Tomato puree" starts with the query; the others only contain it.
    expect(suggestIngredients('tomato', rows)[0]?.ingredient.id).toBe('i3')
  })

  it('reports which alias matched, so the caller can record it', () => {
    const suggestions = suggestIngredients('tinned', rows, [alias('i1', 'tinned tomatoes')])
    expect(suggestions[0]?.ingredient.id).toBe('i1')
    expect(suggestions[0]?.matchedAlias).toBe('tinned tomatoes')
  })

  it('ranks a name match above an alias match', () => {
    const aliases = [alias('i4', 'chopped tomatoes')]
    const suggestions = suggestIngredients('chopped tomatoes', rows, aliases)
    expect(suggestions[0]?.ingredient.id).toBe('i1')
    expect(suggestions[0]?.matchedAlias).toBeNull()
  })

  it('offers one entry per ingredient however many aliases match', () => {
    const aliases = [alias('i1', 'tinned tomatoes'), alias('i1', 'tin tomatoes')]
    const suggestions = suggestIngredients('tin', rows, aliases)
    expect(suggestions.filter(s => s.ingredient.id === 'i1')).toHaveLength(1)
  })

  it('prefers the ingredient name over its own alias in the label', () => {
    const suggestions = suggestIngredients('chopped', rows, [alias('i1', 'chopped toms')])
    expect(suggestions[0]?.matchedAlias).toBeNull()
  })

  it('honours the limit', () => {
    expect(suggestIngredients('tomato', rows, [], 2)).toHaveLength(2)
  })

  it('has nothing to offer an empty query', () => {
    expect(suggestIngredients('  ', rows)).toEqual([])
  })

  it('skips ingredients that were merged away', () => {
    const merged = mapOf([
      ingredient('loser', 'Toms', { merged_into: 'i1', deleted_at: '2026-07-02T00:00:00.000Z' }),
      ingredient('i1', 'Chopped tomatoes')
    ])
    const ids = suggestIngredients('tom', merged).map(s => s.ingredient.id)
    expect(ids).toEqual(['i1'])
  })

  it('is stable when two ingredients rank and sort the same', () => {
    const twins = mapOf([
      ingredient('zzzz', 'Tomatoes'),
      ingredient('aaaa', 'Tomatoes')
    ])
    expect(suggestIngredients('tomatoes', twins).map(s => s.ingredient.id)).toEqual(['aaaa', 'zzzz'])
  })
})
