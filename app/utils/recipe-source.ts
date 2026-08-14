/**
 * Where a recipe came from, when it did not come from a web address.
 *
 * A photographed recipe arrives with everything the page printed and nothing
 * about the object it was printed in. That is the one fact the camera cannot
 * capture and the one people actually say out loud — "it's in the Ottolenghi,
 * page 82" — so it is asked for once, at the moment the photos are taken, with
 * the book open in front of somebody.
 *
 * Both halves are text and both are optional, which is the schema's call and
 * the reason for the tidying below rather than validation: a page is often a
 * spread, sometimes a section number, and quite often typed as "p. 82" because
 * that is how it is written on the page. Nothing here refuses an answer; it
 * only stops the same answer being stored two ways.
 *
 * A leaf module, like `meal.ts` and for the same reason: the store, the import
 * composable, the library builder and three components all read it, and it
 * imports nothing itself.
 */

/**
 * The columns, structurally — so this file does not import `RecipeRow` and the
 * form can hand over the same shape before there is a row.
 */
export interface RecipeSourceFields {
  source_book: string | null
  source_page: string | null
}

/**
 * "p. 82", "pp. 82-83", "page 6" — how it is written in the book, which is how
 * it gets typed in. Stripped on the way in so the label below does not read
 * "p. p. 82", and so the same page typed two ways is stored one way.
 *
 * Only ever in front of a digit, which is what keeps a page called "Preface"
 * or "Puddings" whole. `pages?` leads the alternation because `p` would
 * otherwise match first and leave "age 6" behind.
 */
const PAGE_PREFIX = /^(?:pages?|pp?)\.?\s*(?=\d)/i

/** Somebody typed the prefix and stopped, which is no answer at all. */
const PAGE_PREFIX_ONLY = /^(?:pages?|pp?)\.?$/i

/** A range or a pair, which is what a photographed spread usually is. */
const SEVERAL_PAGES = /[-–—/,&]|\band\b/i

/** Trimmed, with an empty box meaning "not answered" rather than an empty string. */
export function tidyBook(input: string | null | undefined): string | null {
  return input?.trim() || null
}

export function tidyPage(input: string | null | undefined): string | null {
  const typed = input?.trim()
  if (!typed || PAGE_PREFIX_ONLY.test(typed)) return null
  // Only the prefix goes. What is left is printed back exactly as typed, dash
  // and all: this is a fact off a page, not a number to be normalised.
  return typed.replace(PAGE_PREFIX, '').trim() || null
}

/** Both halves, tidied, ready to be written to the two columns. */
export function tidySource(input: {
  book?: string | null
  page?: string | null
}): RecipeSourceFields {
  return {
    source_book: tidyBook(input.book),
    source_page: tidyPage(input.page)
  }
}

/**
 * How a book and a page read under a recipe's name: "Ottolenghi Simple, p. 82".
 *
 * Null when there is neither, which is most of the library — every surface that
 * draws this collapses on null rather than reserving a line for it.
 *
 * Either half stands on its own. A page with no book is worth showing, because
 * a household with one cookbook on the counter knows which book it means; a
 * book with no page is the commoner half-answer, and asking for the page again
 * later is what the recipe's own page is for.
 */
export function sourceLabel(recipe: RecipeSourceFields): string | null {
  const book = tidyBook(recipe.source_book)
  const page = tidyPage(recipe.source_page)
  if (!page) return book
  // "pp." for a spread, which is what a photographed recipe usually spans.
  const cited = `${SEVERAL_PAGES.test(page) ? 'pp.' : 'p.'} ${page}`
  return book ? `${book}, ${cited}` : cited
}
