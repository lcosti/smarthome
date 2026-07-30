import { describe, expect, it } from 'vitest'
import { splitIntoSteps } from '../app/utils/steps'

describe('splitIntoSteps', () => {
  it('returns nothing for empty or blank text', () => {
    expect(splitIntoSteps('')).toEqual([])
    expect(splitIntoSteps('   \n\n  ')).toEqual([])
  })

  it('splits on blank lines', () => {
    expect(splitIntoSteps('Boil the pasta.\n\nMake the sauce.\n\nCombine.')).toEqual([
      'Boil the pasta.',
      'Make the sauce.',
      'Combine.'
    ])
  })

  it('splits on single lines when there are no paragraphs', () => {
    expect(splitIntoSteps('Boil the pasta.\nMake the sauce.')).toEqual([
      'Boil the pasta.',
      'Make the sauce.'
    ])
  })

  it('keeps the line breaks inside a paragraph', () => {
    expect(splitIntoSteps('Heat the oven.\nGas 6.\n\nRub in the butter.')).toEqual([
      'Heat the oven.\nGas 6.',
      'Rub in the butter.'
    ])
  })

  it('strips numbering the page carried, since steps are numbered on display', () => {
    expect(splitIntoSteps('1. Soak the rice.\n2) Drain it.\nStep 3: Cook it.')).toEqual([
      'Soak the rice.',
      'Drain it.',
      'Cook it.'
    ])
  })

  it('splits a numbered list that arrived on one line', () => {
    expect(splitIntoSteps('1. Soak the rice. 2. Drain it. 3. Cook it.')).toEqual([
      'Soak the rice.',
      'Drain it.',
      'Cook it.'
    ])
  })

  it('does not mistake a quantity for a step number', () => {
    const text = 'Mix 400g flour with 2 eggs and 1 tbsp of oil.'
    expect(splitIntoSteps(text)).toEqual([text])
  })

  it('never splits on sentences — a paragraph is one step', () => {
    const text = 'Firstly, soak the rice. To do this, put it into a large bowl '
      + 'and cover generously with water.'
    expect(splitIntoSteps(text)).toEqual([text])
  })

  it('handles Windows line endings and stray blank lines', () => {
    expect(splitIntoSteps('\r\nBoil the pasta.\r\n\r\n\r\nMake the sauce.\r\n')).toEqual([
      'Boil the pasta.',
      'Make the sauce.'
    ])
  })

  it('strips the numbering off a single step too', () => {
    expect(splitIntoSteps('1. Soak the rice overnight.')).toEqual(['Soak the rice overnight.'])
  })
})
