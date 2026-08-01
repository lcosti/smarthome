import { describe, expect, it } from 'vitest'
import { deShout } from '../app/utils/name-case'

describe('deShout', () => {
  it('sentence-cases a name printed in capitals', () => {
    expect(deShout('RIBEYE STEAK CHASSEUR')).toBe('Ribeye steak chasseur')
  })

  it('leaves a name somebody wrote themselves alone', () => {
    expect(deShout('Smash burgers')).toBe('Smash burgers')
    expect(deShout('Mac & Cheese')).toBe('Mac & Cheese')
    expect(deShout('Pad Thai')).toBe('Pad Thai')
  })

  it('leaves a short acronym in a normal name alone', () => {
    expect(deShout('BBQ chicken')).toBe('BBQ chicken')
  })

  it('keeps an allowed acronym when the whole name shouts', () => {
    expect(deShout('BBQ PULLED PORK')).toBe('BBQ pulled pork')
    expect(deShout('BLT SANDWICH')).toBe('BLT sandwich')
  })

  it('quietens only the shouting words when part of the name shouts', () => {
    expect(deShout('SLOW COOKER beef')).toBe('Slow cooker beef')
  })

  it('leaves a word carrying a number as it was typed', () => {
    expect(deShout('250G')).toBe('250G')
    expect(deShout('5-A-DAY pasta')).toBe('5-A-DAY pasta')
  })

  it('does not capitalise a later word when the name opens on a number', () => {
    expect(deShout('5 spice CHICKEN THIGHS')).toBe('5 spice chicken thighs')
  })

  it('tidies an ingredient line the same way', () => {
    expect(deShout('PLAIN FLOUR')).toBe('Plain flour')
  })

  it('handles accents', () => {
    expect(deShout('CRÈME BRÛLÉE')).toBe('Crème brûlée')
  })

  it('gives an empty or letterless name back untouched', () => {
    expect(deShout('')).toBe('')
    expect(deShout('   ')).toBe('   ')
    expect(deShout('!!!')).toBe('!!!')
  })
})
