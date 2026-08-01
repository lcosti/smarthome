// Puts numbers to a recipe that arrived without any: per-serving nutrition
// estimated from the ingredient list.
//
// The one place in the app allowed to make nutrition figures up. The importers
// transcribe what a page or photo printed and refuse to invent; this exists for
// the hand-typed and cookbook recipes that never had a panel, and it only runs
// when a person presses the button asking for it. The client writes the answer
// into the same editable fields, and only into the blanks — an estimate never
// overwrites what a source printed or a person typed.
//
// Lives here rather than in the client because the Anthropic key must never be
// in the static bundle, and ssr:false means Edge Functions are the only
// server-side home this app has.
//
// Local trial:
//   supabase functions serve estimate-nutrition --env-file supabase/functions/.env
//   curl -s http://127.0.0.1:54321/functions/v1/estimate-nutrition \
//     -H "Authorization: Bearer $SUPABASE_KEY" -H "Content-Type: application/json" \
//     -d '{"name":"Lentil soup","base_servings":4,"ingredients":[{"name":"red lentils","quantity":"200g"}]}'

import Anthropic from 'npm:@anthropic-ai/sdk'
import { guardMethod, json } from '../_shared/http.ts'
import { rejectNonMember } from '../_shared/member.ts'
import { MODEL_REQUEST, objectMember, readJsonOutput } from '../_shared/model.ts'
import { NUTRITION_ESTIMATE_SCHEMA } from '../_shared/recipe-schema.ts'

/** Well past any real recipe; bounds what one request can make the model read. */
const MAX_LINES = 100
const MAX_LINE_LENGTH = 200
const MAX_SERVINGS = 24

const ESTIMATE_PROMPT = `Above is a recipe's ingredient list. Estimate the nutrition of the whole
dish as typically prepared from those quantities, divide by the servings stated, and answer per
serving: kcal, and grams of fat, saturates, carbs, sugars, fibre and protein, plus salt in grams.
Round kcal to the nearest 5 and grams to one decimal place (salt to two). Use null for any figure
the list gives you no basis for — lines without quantities weaken the estimate but do not stop it;
assume typical amounts where a quantity is missing. If the list is not food, or is too thin to
estimate anything from, set nutrition to null rather than guessing blind.`

Deno.serve(async (req) => {
  const guarded = guardMethod(req)
  if (guarded) return guarded

  const rejection = await rejectNonMember(req)
  if (rejection) return rejection

  let name: string
  let servings: number
  let lines: string[]
  try {
    const body = await req.json()
    if (typeof body?.name !== 'string' || !body.name.trim()) {
      return json(400, { error: 'Send the recipe name' })
    }
    if (!Number.isInteger(body.base_servings) || body.base_servings < 1 || body.base_servings > MAX_SERVINGS) {
      return json(400, { error: `Send base_servings between 1 and ${MAX_SERVINGS}` })
    }
    if (!Array.isArray(body.ingredients) || body.ingredients.length < 1 || body.ingredients.length > MAX_LINES) {
      return json(400, { error: `Send 1-${MAX_LINES} ingredients` })
    }
    name = body.name.trim()
    servings = body.base_servings
    lines = []
    for (const line of body.ingredients) {
      if (typeof line?.name !== 'string' || !line.name.trim()) {
        return json(400, { error: 'Each ingredient needs a name' })
      }
      const quantity = typeof line.quantity === 'string' && line.quantity.trim() ? line.quantity.trim() : null
      lines.push((quantity ? `${quantity} ${line.name.trim()}` : line.name.trim()).slice(0, MAX_LINE_LENGTH))
    }
  } catch {
    return json(400, { error: 'Body must be JSON' })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY is not configured' })

  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: MODEL_REQUEST.model,
      max_tokens: MODEL_REQUEST.max_tokens,
      output_config: {
        effort: MODEL_REQUEST.effort,
        format: { type: 'json_schema', schema: NUTRITION_ESTIMATE_SCHEMA }
      },
      messages: [{
        role: 'user',
        content: [{
          type: 'text' as const,
          text: `${name} — serves ${servings}\n\n${lines.join('\n')}\n\n---\n\n${ESTIMATE_PROMPT}`
        }]
      }]
    })
  } catch (error) {
    console.error('anthropic call failed', error)
    return json(502, { error: 'Could not reach the estimation service' })
  }

  const output = readJsonOutput(response)
  if (!output.ok) {
    if (output.reason === 'refusal') {
      return json(422, { error: 'Those ingredients could not be read as food' })
    }
    console.error('estimate-nutrition could not read the answer', output.reason, response.stop_reason)
    return json(502, {
      error: output.reason === 'truncated'
        ? 'The estimate ran long and came back unfinished — try again.'
        : 'The estimation service returned something unexpected'
    })
  }

  // Null here is the model saying the list was too thin to work from, which the
  // prompt explicitly asks for rather than a guess.
  const nutrition = objectMember(output.value, 'nutrition')
  if (!nutrition) {
    return json(422, { error: "Those ingredients weren't enough to put numbers to" })
  }

  return json(200, { nutrition })
})
