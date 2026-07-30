/**
 * Turning a wall of method text into steps.
 *
 * Two callers, one rule set: a photo import whose extraction came back as prose,
 * and the "move into steps" button on a recipe whose method was typed or pasted
 * into the notes box. Both want the same answer, so neither owns the guessing.
 *
 * The guessing is deliberately shallow. Paragraphs, then lines, then a numbered
 * list run together on one line — whichever first yields more than one part wins.
 * Sentences are never split on: "Firstly, soak the rice. To do this, put it in a
 * bowl…" is one step written as two sentences, and cutting there would be worse
 * than not cutting at all. One step out is a fine answer; it is still a step, and
 * splitting it further is one tap in the builder.
 */

/** "1. ", "2) ", "Step 3: " — the recipe page numbers steps itself. */
const NUMBER_PREFIX = /^(?:step\s+)?\d{1,2}\s*[.):]\s+/i

/**
 * A numbered list that arrived on one line. The punctuation is required: without
 * it "add 2 tbsp" would look like the start of step 2.
 */
const INLINE_NUMBER = /(?=\s\d{1,2}[.)]\s)/

function clean(part: string): string {
  return part.trim().replace(NUMBER_PREFIX, '').trim()
}

export function splitIntoSteps(text: string): string[] {
  const normalised = text.replace(/\r\n?/g, '\n').trim()
  if (!normalised) return []

  for (const separator of [/\n[ \t]*\n/, /\n/, INLINE_NUMBER]) {
    const parts = normalised.split(separator).map(clean).filter(Boolean)
    if (parts.length > 1) return parts
  }

  return [clean(normalised)].filter(Boolean)
}
