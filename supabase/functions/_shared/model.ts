// Asking Claude for JSON, and reading the answer back safely.
//
// All three model-backed functions here do the same thing: send a schema, get
// one JSON object, parse it. They also all met the same trap, so the reading
// happens once, in here.
//
// **The trap.** Claude Sonnet 5 thinks by default — omitting the `thinking`
// parameter runs adaptive thinking rather than none. Thinking tokens come out of
// `max_tokens` along with the answer, so a budget sized around the JSON alone can
// be spent entirely on thinking: the reply comes back `stop_reason: "max_tokens"`
// with a single `thinking` block and no text at all. Reading `.text` off a text
// block that was never emitted yields `undefined`, `JSON.parse` throws on it, and
// the whole thing surfaces as "the service returned something unexpected" —
// which is true, and useless.
//
// That is not hypothetical: the estimator ran at 2000 tokens and a thirteen-line
// recipe spent all 2000 on thinking. Two things prevent it, and both are here
// rather than in each caller:
//
//  - `MODEL_REQUEST` sets a budget with room for thinking *and* the answer, and
//    an explicit effort level. Naming an effort is what stops the runaway: with
//    it the same request thinks for zero tokens and answers in about two
//    seconds.
//  - `readJsonOutput` names `max_tokens` as its own outcome, so if it ever
//    happens again it says so instead of blaming the parser.

/** Long enough for thinking plus the answer. See the note above on why. */
const MAX_TOKENS = 16_000

/**
 * The knobs every request here shares.
 *
 * `medium` effort because these are bounded jobs — transcribe this page,
 * estimate from this list — where the model's own judgement is worth having but
 * exploring is not. It is also what keeps the call inside the client's 60-second
 * timeout.
 */
export const MODEL_REQUEST = {
  model: 'claude-sonnet-5',
  max_tokens: MAX_TOKENS,
  effort: 'medium'
} as const

export type JsonOutcome =
  | { ok: true, value: Record<string, unknown> }
  | { ok: false, reason: 'refusal' | 'truncated' | 'unparseable' }

/**
 * The one JSON object a structured-output request was asked for.
 *
 * Every failure is named rather than collapsed, because the three of them want
 * different words in front of a person: a refusal is about what was sent, a
 * truncation is about this function's own budget, and an unparseable answer is
 * the only one that is really "something unexpected".
 */
export function readJsonOutput(response: {
  stop_reason?: string | null
  content: { type: string, text?: string }[]
}): JsonOutcome {
  if (response.stop_reason === 'refusal') return { ok: false, reason: 'refusal' }

  const text = response.content.find(block => block.type === 'text')?.text

  // No text block at all is the signature of a budget spent on thinking. Report
  // it as truncation even without the stop reason, since that is what it is.
  if (text === undefined) return { ok: false, reason: 'truncated' }
  if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'truncated' }

  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'unparseable' }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, reason: 'unparseable' }
  }
}

/**
 * One object-valued member of a parsed answer, or null when it is missing or is
 * something else.
 *
 * The schema already constrains these, but the answer is still JSON from the
 * network: this is what lets a caller spread `recipe` or hand back `nutrition`
 * without asserting a shape nothing has checked.
 */
export function objectMember(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const found = value[key]
  return typeof found === 'object' && found !== null && !Array.isArray(found)
    ? found as Record<string, unknown>
    : null
}
