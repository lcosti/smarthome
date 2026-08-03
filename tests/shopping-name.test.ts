import { describe, expect, it } from 'vitest'
import { displayIngredientName, shoppingName } from '../app/utils/shopping-name'

describe('shoppingName', () => {
  it('drops a trailing preparation word', () => {
    expect(shoppingName('chestnut mushrooms chopped')).toBe('chestnut mushrooms')
  })

  it('drops an adverb with the word it qualifies', () => {
    expect(shoppingName('carrots finely chopped')).toBe('carrots')
  })

  it('drops a trailing preparation clause', () => {
    expect(shoppingName('parmesan or Grana Padano, freshly grated'))
      .toBe('parmesan or Grana Padano')
  })

  it('drops every trailing clause, not just the last', () => {
    expect(shoppingName('onions, peeled and finely chopped, plus extra to serve'))
      .toBe('onions')
  })

  it('drops a "such as" example', () => {
    expect(shoppingName('risotto rice such as arborio')).toBe('risotto rice')
  })

  it('drops a substitute suggestion', () => {
    expect(shoppingName('crème fraîche or similar')).toBe('crème fraîche')
  })

  it('drops a parenthesised example', () => {
    expect(shoppingName('hard cheese (e.g. pecorino)')).toBe('hard cheese')
  })

  it('keeps a leading preparation word, because that is what is on the tin', () => {
    expect(shoppingName('chopped tomatoes')).toBe('chopped tomatoes')
    expect(shoppingName('freshly grated parmesan')).toBe('freshly grated parmesan')
  })

  it('keeps a bare "or", which is a choice to make in the aisle', () => {
    expect(shoppingName('parmesan or Grana Padano')).toBe('parmesan or Grana Padano')
  })

  it('keeps a connective that is part of the name', () => {
    expect(shoppingName('salt and pepper')).toBe('salt and pepper')
  })

  it('keeps a trailing word that could be part of the name', () => {
    expect(shoppingName('tomatoes, tinned')).toBe('tomatoes, tinned')
    expect(shoppingName('smoked paprika')).toBe('smoked paprika')
  })

  it('never strips a line down to nothing', () => {
    expect(shoppingName('chopped')).toBe('chopped')
    expect(shoppingName('such as arborio')).toBe('such as arborio')
  })

  it('collapses whitespace and leaves an ordinary name alone', () => {
    expect(shoppingName('  olive   oil ')).toBe('olive oil')
  })

  it('returns whitespace-only input untouched', () => {
    expect(shoppingName('   ')).toBe('   ')
  })
})

/**
 * The rows a real shopping list arrived with, verbatim. Each one is a different
 * way a recipe site says something that is not the name of the thing.
 */
describe('the fluff a real list turned up with', () => {
  it('drops what the ingredient is for', () => {
    expect(shoppingName('toasted pitta bread to serve')).toBe('toasted pitta bread')
    expect(shoppingName('coriander, to garnish')).toBe('coriander')
    expect(shoppingName('sea salt, to taste')).toBe('sea salt')
    expect(shoppingName('butter for greasing')).toBe('butter')
  })

  it('drops a bracketed instruction but keeps a bracketed size', () => {
    expect(shoppingName('tortilla wraps (use corn or flour)')).toBe('tortilla wraps')
    expect(shoppingName('chopped tomatoes (400g)')).toBe('chopped tomatoes (400g)')
  })

  it('drops an adverb and its participle from inside a name', () => {
    expect(shoppingName('Sea salt and freshly ground black pepper'))
      .toBe('Sea salt and black pepper')
    expect(shoppingName('lemon and finely grated zest')).toBe('lemon and zest')
  })

  it('leaves a participle that is part of the name, wherever it sits', () => {
    expect(shoppingName('salt and ground black pepper')).toBe('salt and ground black pepper')
    expect(shoppingName('freshly grated parmesan')).toBe('freshly grated parmesan')
  })

  it('takes the first of two sizes, which is what the quantity now counts', () => {
    expect(shoppingName('small or 4 large tortilla wraps')).toBe('small tortilla wraps')
    expect(shoppingName('small or 4 large tortilla wraps (use corn or flour)'))
      .toBe('small tortilla wraps')
  })
})

describe('displayIngredientName', () => {
  // The two lines that started this, from the BBC mushroom risotto.
  it('reads a recipe line as the thing you would buy', () => {
    expect(displayIngredientName('garlic cloves finely chopped')).toBe('Garlic cloves')
    expect(displayIngredientName('parmesan or Grana Padano, freshly grated')).toBe('Parmesan')
  })

  it('resolves a choice between two things to the first of them', () => {
    expect(displayIngredientName('butter or margarine')).toBe('Butter')
    expect(displayIngredientName('creme fraiche or soured cream')).toBe('Creme fraiche')
  })

  /**
   * The failure this rule has to avoid: "chicken" is a different aisle and a
   * different dinner from "chicken stock". Where the alternative ends in a noun
   * both choices share, it comes back with the first one.
   */
  it('keeps a head noun the alternatives were sharing', () => {
    expect(displayIngredientName('chicken or vegetable stock')).toBe('Chicken stock')
    expect(displayIngredientName('plain or self-raising flour')).toBe('Plain flour')
    expect(displayIngredientName('white or red wine')).toBe('White wine')
  })

  it('leaves a line with no choice in it alone but for the capital', () => {
    expect(displayIngredientName('risotto rice such as arborio')).toBe('Risotto rice')
    expect(displayIngredientName('handful parsley leaves')).toBe('Handful parsley leaves')
  })

  it('never strips a line down to nothing', () => {
    expect(displayIngredientName('chopped')).toBe('Chopped')
    expect(displayIngredientName('or')).toBe('Or')
  })

  it('leaves the shopping list on the conservative rule', () => {
    // The same line, tidied for a list rather than for scanning: the choice
    // stays, because in front of the cheese counter it is a real one.
    expect(shoppingName('parmesan or Grana Padano, freshly grated'))
      .toBe('parmesan or Grana Padano')
  })
})

describe('the head-noun guard', () => {
  it('does not glue a noun onto a first choice that is already a thing', () => {
    expect(displayIngredientName('milk or cream')).toBe('Milk')
    expect(displayIngredientName('yoghurt or soured cream')).toBe('Yoghurt')
  })
})
