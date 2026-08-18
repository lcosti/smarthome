// Proposes adaptations of one recipe for the audiences a household actually
// has: how to serve it to a weaning baby, a toddler, or somebody on a named
// diet, as overrides against specific ingredient lines and steps.
//
// Suggestions only, on the safety note in the project brief: nothing here is
// saved. The client shows each proposal for a person to accept or dismiss, and
// what survives that review is written through the ordinary store methods. The
// one check this end is mechanical — an override pointing at a line or step id
// the request never named is dropped, a filter rather than a validation layer.
//
// Lives here rather than in the client because the Anthropic key must never be
// in the static bundle, and ssr:false means Edge Functions are the only
// server-side home this app has.
//
// Local trial:
//   supabase functions serve suggest-adaptations --env-file supabase/functions/.env
//   curl -s http://127.0.0.1:54321/functions/v1/suggest-adaptations \
//     -H "Authorization: Bearer $SUPABASE_KEY" -H "Content-Type: application/json" \
//     -d '{"name":"Chilli","base_servings":4,"ingredients":[{"id":"l1","name":"dried chilli flakes","quantity":"1 tsp"}],"steps":[{"id":"s1","body":"Stir in the chilli and simmer."}],"audiences":[{"life_stage":"weaning"}]}'

import Anthropic from 'npm:@anthropic-ai/sdk'
import { guardMethod, json } from '../_shared/http.ts'
import { rejectNonMember } from '../_shared/member.ts'
import { MODEL_REQUEST, readJsonOutput } from '../_shared/model.ts'
import { ADAPTATION_SUGGESTIONS_SCHEMA } from '../_shared/adaptation-schema.ts'

/** Well past any real recipe; bounds what one request can make the model read. */
const MAX_LINES = 100
const MAX_STEPS = 50
const MAX_TEXT_LENGTH = 400
const MAX_AUDIENCES = 6

const STAGES = ['weaning', 'toddler', 'child', 'adult']

const SUGGEST_PROMPT = `Above is a family recipe — its ingredient lines and method steps, each with an
id — and the audiences at this household's table. For each audience, suggest how the family cook
would adapt the one shared meal while cooking it once: ingredient overrides (swap, omit, or reduce a
specific line) and step amendments (something done differently at a specific step, like setting a
portion aside before seasoning). Point every override at an id from the lists above. Use the note for
anything that names no single line or step. Follow current UK weaning guidance for a weaning
audience: no added salt, no honey, no whole nuts, and watch choking shapes. Suggest only what is
worth saying — an audience the dish already suits should get few or no changes, and an audience you
can offer nothing sensible for may be left out. If the recipe cannot be read as food, set
suggestions to null.`

interface Audience {
  life_stage: string | null
  diet_tag: string | null
}

Deno.serve(async (req) => {
  const guarded = guardMethod(req)
  if (guarded) return guarded

  const rejection = await rejectNonMember(req)
  if (rejection) return rejection

  let name: string
  let servings: number
  let lines: { id: string, text: string }[]
  let steps: { id: string, text: string }[]
  let audiences: Audience[]
  try {
    const body = await req.json()
    if (typeof body?.name !== 'string' || !body.name.trim()) {
      return json(400, { error: 'Send the recipe name' })
    }
    if (!Number.isInteger(body.base_servings) || body.base_servings < 1) {
      return json(400, { error: 'Send base_servings' })
    }
    if (!Array.isArray(body.ingredients) || body.ingredients.length < 1 || body.ingredients.length > MAX_LINES) {
      return json(400, { error: `Send 1-${MAX_LINES} ingredients` })
    }
    if (!Array.isArray(body.steps) || body.steps.length > MAX_STEPS) {
      return json(400, { error: `Send up to ${MAX_STEPS} steps` })
    }
    if (!Array.isArray(body.audiences) || body.audiences.length < 1 || body.audiences.length > MAX_AUDIENCES) {
      return json(400, { error: `Send 1-${MAX_AUDIENCES} audiences` })
    }

    name = body.name.trim()
    servings = body.base_servings

    lines = []
    for (const line of body.ingredients) {
      if (typeof line?.id !== 'string' || typeof line?.name !== 'string' || !line.name.trim()) {
        return json(400, { error: 'Each ingredient needs an id and a name' })
      }
      const quantity = typeof line.quantity === 'string' && line.quantity.trim() ? `${line.quantity.trim()} ` : ''
      lines.push({ id: line.id, text: `${quantity}${line.name.trim()}`.slice(0, MAX_TEXT_LENGTH) })
    }

    steps = []
    for (const step of body.steps) {
      if (typeof step?.id !== 'string' || typeof step?.body !== 'string' || !step.body.trim()) {
        return json(400, { error: 'Each step needs an id and a body' })
      }
      steps.push({ id: step.id, text: step.body.trim().slice(0, MAX_TEXT_LENGTH) })
    }

    audiences = []
    for (const audience of body.audiences) {
      const stage = typeof audience?.life_stage === 'string' && STAGES.includes(audience.life_stage)
        ? audience.life_stage
        : null
      const diet = typeof audience?.diet_tag === 'string' && audience.diet_tag.trim()
        ? audience.diet_tag.trim().slice(0, MAX_TEXT_LENGTH)
        : null
      if ((stage === null) === (diet === null)) {
        return json(400, { error: 'Each audience is a life_stage or a diet_tag' })
      }
      audiences.push({ life_stage: stage, diet_tag: diet })
    }
  } catch {
    return json(400, { error: 'Body must be JSON' })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY is not configured' })

  const client = new Anthropic({ apiKey })

  const described = [
    `${name} — serves ${servings}`,
    '',
    'Ingredients:',
    ...lines.map(line => `  [${line.id}] ${line.text}`),
    '',
    steps.length ? 'Method:' : 'Method: (none written down)',
    ...steps.map((step, index) => `  [${step.id}] Step ${index + 1}: ${step.text}`),
    '',
    'Audiences:',
    ...audiences.map(a => `  - ${a.life_stage ?? `diet: ${a.diet_tag}`}`)
  ].join('\n')

  let response
  try {
    response = await client.messages.create({
      model: MODEL_REQUEST.model,
      max_tokens: MODEL_REQUEST.max_tokens,
      output_config: {
        effort: MODEL_REQUEST.effort,
        format: { type: 'json_schema', schema: ADAPTATION_SUGGESTIONS_SCHEMA }
      },
      messages: [{
        role: 'user',
        content: [{ type: 'text' as const, text: `${described}\n\n---\n\n${SUGGEST_PROMPT}` }]
      }]
    })
  } catch (error) {
    console.error('anthropic call failed', error)
    return json(502, { error: 'Could not reach the suggestion service' })
  }

  const output = readJsonOutput(response)
  if (!output.ok) {
    if (output.reason === 'refusal') {
      return json(422, { error: 'That recipe could not be read as food' })
    }
    console.error('suggest-adaptations could not read the answer', output.reason, response.stop_reason)
    return json(502, {
      error: output.reason === 'truncated'
        ? 'The suggestions ran long and came back unfinished — try again.'
        : 'The suggestion service returned something unexpected'
    })
  }

  const raw = output.value.suggestions
  if (!Array.isArray(raw)) {
    return json(422, { error: 'Nothing worth suggesting for this one' })
  }

  // The mechanical filter: overrides must point at ids this request named, and
  // audiences must be ones it asked about. Everything else about the content is
  // the reviewer's to judge.
  const lineIds = new Set(lines.map(line => line.id))
  const stepIds = new Set(steps.map(step => step.id))
  const askedStages = new Set(audiences.map(a => a.life_stage).filter(Boolean))
  const askedDiets = new Set(audiences.map(a => a.diet_tag).filter(Boolean))

  const suggestions = raw
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .filter(entry => (typeof entry.life_stage === 'string' && askedStages.has(entry.life_stage))
      || (typeof entry.diet_tag === 'string' && askedDiets.has(entry.diet_tag)))
    .map(entry => ({
      ...entry,
      ingredient_overrides: (Array.isArray(entry.ingredient_overrides) ? entry.ingredient_overrides : [])
        .filter(o => typeof o?.recipe_ingredient_id === 'string' && lineIds.has(o.recipe_ingredient_id)),
      step_amendments: (Array.isArray(entry.step_amendments) ? entry.step_amendments : [])
        .filter(a => typeof a?.recipe_step_id === 'string' && stepIds.has(a.recipe_step_id))
    }))

  return json(200, { suggestions })
})
