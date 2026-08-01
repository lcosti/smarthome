import { describe, expect, it } from 'vitest'
import { MODEL_REQUEST, objectMember, readJsonOutput } from '../supabase/functions/_shared/model'

/** A response shaped like the SDK's, with only the fields the reader looks at. */
function reply(
  content: { type: string, text?: string }[],
  stop_reason: string | null = 'end_turn'
) {
  return { stop_reason, content }
}

describe('readJsonOutput', () => {
  it('reads the object a structured-output request asked for', () => {
    const output = readJsonOutput(reply([{ type: 'text', text: '{"nutrition":{"kcal":650}}' }]))
    expect(output).toEqual({ ok: true, value: { nutrition: { kcal: 650 } } })
  })

  it('finds the text block past a thinking block', () => {
    // Sonnet 5 thinks by default, and with display omitted the block is empty.
    const output = readJsonOutput(reply([
      { type: 'thinking', text: '' },
      { type: 'text', text: '{"ok":1}' }
    ]))
    expect(output).toEqual({ ok: true, value: { ok: 1 } })
  })

  /**
   * The bug this exists for. A thirteen-line recipe against a 2000-token budget
   * spent all 2000 on thinking: one thinking block, no text block, and
   * `JSON.parse(undefined ?? '')` threw — which the caller reported as "the
   * service returned something unexpected". It was a budget, not a bad answer.
   */
  it('calls a budget spent entirely on thinking truncated, not unparseable', () => {
    const output = readJsonOutput(reply([{ type: 'thinking', text: '' }], 'max_tokens'))
    expect(output).toEqual({ ok: false, reason: 'truncated' })
  })

  it('reports truncation even when only the missing text says so', () => {
    // Same shape, no stop reason to go on: still not the parser's fault.
    expect(readJsonOutput(reply([{ type: 'thinking', text: '' }])))
      .toEqual({ ok: false, reason: 'truncated' })
    expect(readJsonOutput(reply([])))
      .toEqual({ ok: false, reason: 'truncated' })
  })

  it('reports a half-written answer as truncated rather than parsing it', () => {
    expect(readJsonOutput(reply([{ type: 'text', text: '{"nutrition":{"kcal":6' }], 'max_tokens')))
      .toEqual({ ok: false, reason: 'truncated' })
  })

  it('keeps a refusal distinct from everything else', () => {
    expect(readJsonOutput(reply([], 'refusal')))
      .toEqual({ ok: false, reason: 'refusal' })
  })

  it('reports genuinely unreadable output as unparseable', () => {
    expect(readJsonOutput(reply([{ type: 'text', text: 'Sorry, I can help with that!' }])))
      .toEqual({ ok: false, reason: 'unparseable' })
    // Valid JSON, but not an object — nothing downstream can read a bare number.
    expect(readJsonOutput(reply([{ type: 'text', text: '42' }])))
      .toEqual({ ok: false, reason: 'unparseable' })
    expect(readJsonOutput(reply([{ type: 'text', text: 'null' }])))
      .toEqual({ ok: false, reason: 'unparseable' })
  })
})

describe('MODEL_REQUEST', () => {
  it('leaves room for thinking as well as the answer', () => {
    // 2000 was the number that failed; anything in that region will fail again.
    expect(MODEL_REQUEST.max_tokens).toBeGreaterThanOrEqual(16_000)
  })

  it('names an effort level, which is what stops the runaway', () => {
    expect(MODEL_REQUEST.effort).toBe('medium')
  })
})

describe('objectMember', () => {
  it('hands back an object member so a caller can spread it', () => {
    expect(objectMember({ recipe: { name: 'Chasseur' } }, 'recipe')).toEqual({ name: 'Chasseur' })
  })

  it('is null for a member that is missing, null, or not an object', () => {
    // `nutrition: null` is the model saying "too thin to estimate" — a real
    // answer the caller turns into its own message, not a parse failure.
    expect(objectMember({ nutrition: null }, 'nutrition')).toBeNull()
    expect(objectMember({}, 'recipe')).toBeNull()
    expect(objectMember({ recipe: 'Chasseur' }, 'recipe')).toBeNull()
    expect(objectMember({ recipe: [1, 2] }, 'recipe')).toBeNull()
  })
})
