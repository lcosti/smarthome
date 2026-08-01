/**
 * A name that has stopped shouting.
 *
 * Some recipe sites print their titles in capitals, and a photographed page is
 * worse: the heading is capitals and half the ingredient list is too. None of
 * that carries meaning — it is the source's house style — and on the wall board
 * it is the difference between a card you read and a card that reads at you,
 * sitting next to "Smash burgers" in the same row.
 *
 * Applied on the way *in*, in `stores/recipes.ts`, so there is one stored name
 * and every surface agrees on it. Deliberately conservative in the same way as
 * `shopping-name.ts`: it only ever takes capitals off, never puts them on, so a
 * name somebody typed the way they wanted it comes back untouched.
 *
 * Sentence case, not title case, because that is what the library already looks
 * like.
 */

/**
 * Short words that are genuinely capitals rather than shouting.
 *
 * Only needed for a wholly-shouting name, where there is no lowercase word left
 * to tell us the capitals were meant. Anything under four letters survives the
 * partial branch already, so this list stays small on purpose — a word in here
 * can never be de-shouted, and "Bbq" is a smaller wrong than "bbq chicken"
 * becoming "BBQ Chicken" would be.
 */
const KEEP_CAPS = new Set(['BBQ', 'BLT'])

/** Letters only: "PB&J" and "5-A-DAY" are counted on what they spell. */
function letters(word: string) {
  return word.replace(/[^\p{L}]/gu, '')
}

/** A word that is all capitals and long enough that it is shouting, not an acronym. */
function shouting(word: string) {
  const only = letters(word)
  return only.length >= 4 && word === word.toLocaleUpperCase() && word !== word.toLocaleLowerCase()
}

/**
 * Only the very first character, and only if it is a letter. A name opening on a
 * number — "5 spice pork" — is left where it starts rather than having its
 * second word capitalised for it.
 */
function capitaliseFirst(name: string) {
  const first = name.slice(0, 1)
  if (first.toLocaleUpperCase() === first.toLocaleLowerCase()) return name
  return first.toLocaleUpperCase() + name.slice(1)
}

export function deShout(raw: string): string {
  const name = raw.trim()
  if (!name) return raw

  // No lowercase letter anywhere, so nothing in the name tells us which capitals
  // were meant: every word comes down except the ones on the list.
  const wholly = name !== name.toLocaleLowerCase() && name === name.toLocaleUpperCase()

  const words = name.split(' ').map((word) => {
    if (!word) return word
    // A word carrying a number is a quantity or a size — "250G", "5-A-DAY" — and
    // its capitals are doing something the rest of the name's are not.
    if (/\d/.test(word)) return word
    if (KEEP_CAPS.has(letters(word).toLocaleUpperCase()) && word === word.toLocaleUpperCase()) return word
    if (wholly) return word.toLocaleLowerCase()
    return shouting(word) ? word.toLocaleLowerCase() : word
  })

  return capitaliseFirst(words.join(' '))
}
