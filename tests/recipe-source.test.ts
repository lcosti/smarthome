import { describe, expect, it } from 'vitest'
import { sourceLabel, tidyBook, tidyPage, tidySource } from '../app/utils/recipe-source'

function source(book: string | null, page: string | null) {
  return { source_book: book, source_page: page }
}

describe('tidyBook', () => {
  it('trims, and reads an empty box as no answer', () => {
    expect(tidyBook('  Ottolenghi Simple ')).toBe('Ottolenghi Simple')
    expect(tidyBook('   ')).toBe(null)
    expect(tidyBook('')).toBe(null)
    expect(tidyBook(null)).toBe(null)
    expect(tidyBook(undefined)).toBe(null)
  })
})

describe('tidyPage', () => {
  it('drops the prefix people type because it is printed on the page', () => {
    expect(tidyPage('p. 82')).toBe('82')
    expect(tidyPage('p82')).toBe('82')
    expect(tidyPage('pp. 82-83')).toBe('82-83')
    expect(tidyPage('Page 6')).toBe('6')
    expect(tidyPage('pages 6-7')).toBe('6-7')
  })

  it('keeps everything else exactly as typed', () => {
    // A page is a fact off a book, not a number: the dash in a spread, the dot
    // in a section number and the words in "82, second recipe" all survive.
    expect(tidyPage('82–83')).toBe('82–83')
    expect(tidyPage('4.12')).toBe('4.12')
    expect(tidyPage(' 82, second recipe ')).toBe('82, second recipe')
  })

  it('does not eat a page that merely starts with the letter p', () => {
    // The prefix only goes when a number follows it, so the front matter of a
    // book keeps its name.
    expect(tidyPage('preface')).toBe('preface')
    expect(tidyPage('Puddings, 3rd recipe')).toBe('Puddings, 3rd recipe')
  })

  it('reads an empty box as no answer', () => {
    expect(tidyPage('  ')).toBe(null)
    expect(tidyPage('p.')).toBe(null)
    expect(tidyPage(null)).toBe(null)
  })
})

describe('tidySource', () => {
  it('hands back the two columns, ready to write', () => {
    expect(tidySource({ book: ' River Cottage ', page: 'p. 40' }))
      .toEqual({ source_book: 'River Cottage', source_page: '40' })
  })

  it('turns a half-filled form into nulls rather than empty strings', () => {
    expect(tidySource({ book: 'River Cottage' }))
      .toEqual({ source_book: 'River Cottage', source_page: null })
    expect(tidySource({}))
      .toEqual({ source_book: null, source_page: null })
  })
})

describe('sourceLabel', () => {
  it('cites a book and a page the way somebody would say it', () => {
    expect(sourceLabel(source('Ottolenghi Simple', '82'))).toBe('Ottolenghi Simple, p. 82')
  })

  it('says pp. for a spread, which is what a photographed recipe usually is', () => {
    expect(sourceLabel(source('Ottolenghi Simple', '82-83'))).toBe('Ottolenghi Simple, pp. 82-83')
    expect(sourceLabel(source('Ottolenghi Simple', '82–83'))).toBe('Ottolenghi Simple, pp. 82–83')
    expect(sourceLabel(source('Nigella', '10 and 11'))).toBe('Nigella, pp. 10 and 11')
  })

  it('tidies what it is given, so a stored "p. 82" is not cited twice', () => {
    expect(sourceLabel(source('  Nigel Slater  ', 'p. 82'))).toBe('Nigel Slater, p. 82')
  })

  it('lets either half stand on its own', () => {
    expect(sourceLabel(source('River Cottage', null))).toBe('River Cottage')
    expect(sourceLabel(source(null, '82'))).toBe('p. 82')
  })

  it('is null for the recipes that never came off a shelf', () => {
    // Which is most of the library, and why every surface drawing this collapses
    // rather than reserving a line for it.
    expect(sourceLabel(source(null, null))).toBe(null)
    expect(sourceLabel(source('', '  '))).toBe(null)
  })
})
