// Turns photographs of a recipe — a cookbook spread, a printed card — into the
// structured shape the client commits through its normal stores. This is the
// app's only LLM call and its only online-only action; everything downstream of
// the response rides the offline queue like a hand-typed recipe.
//
// Lives here rather than in the client because the Anthropic key must never be
// in the static bundle, and ssr:false means Edge Functions are the only
// server-side home this app has.
//
// Local trial:
//   supabase functions serve import-recipe-photo --env-file supabase/functions/.env
//   curl -s http://127.0.0.1:54321/functions/v1/import-recipe-photo \
//     -H "Authorization: Bearer $SUPABASE_KEY" -H "Content-Type: application/json" \
//     -d "{\"images\":[{\"data\":\"$(base64 -i recipe.jpg)\",\"media_type\":\"image/jpeg\"}]}"

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'

// The static site on Netlify calls this from a different origin, and Supabase
// does not add CORS headers on the function's behalf.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const MAX_IMAGES = 4
// The client compresses to ~200KB before sending (see compressToJpeg), so a
// well-past-that cap costs no real photo anything while bounding what one
// request can make the model read.
const MAX_IMAGE_BASE64_LENGTH = 2_000_000
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

// The model either extracts a recipe or says the photos are not one; the schema
// makes both outcomes machine-readable rather than prose.
const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_recipe', 'recipe'],
  properties: {
    is_recipe: { type: 'boolean' },
    recipe: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'base_servings', 'prep_minutes', 'cook_minutes', 'method', 'ingredients'],
          properties: {
            name: { type: 'string' },
            base_servings: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            prep_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            cook_minutes: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            method: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            ingredients: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'quantity'],
                properties: {
                  name: { type: 'string' },
                  quantity: { anyOf: [{ type: 'string' }, { type: 'null' }] }
                }
              }
            }
          }
        }
      ]
    }
  }
} as const

const EXTRACTION_PROMPT = `These photos show a single recipe, possibly spread across pages.
Extract it exactly as printed: the recipe's name, servings, prep and cook times in minutes,
the method as plain paragraphs in cooking order, and one ingredient per line with its
quantity exactly as written (e.g. "400g", "2 tbsp", "1 tin"). Use null for anything not
visible in the photos. Do not invent, convert, or normalise anything.
If the photos do not show a recipe, set is_recipe to false and recipe to null.`

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  // verify_jwt only proves the token was signed for this project, and signup is
  // open — so it admits any stranger who has requested themselves a magic link.
  // Spending Anthropic credit additionally requires being somebody's household:
  // querying `people` as the caller, under RLS, returns rows only for a member.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false }
    }
  )
  const { data: caller, error: callerError } = await supabase.auth.getUser()
  if (callerError || !caller.user) return json(401, { error: 'Sign in first' })

  const { data: membership, error: membershipError } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', caller.user.id)
    .limit(1)
  if (membershipError) return json(500, { error: 'Could not check household membership' })
  if (!membership.length) return json(403, { error: 'Only household members can import photos' })

  let images: { data: string, media_type: MediaType }[]
  try {
    const body = await req.json()
    if (!Array.isArray(body?.images) || body.images.length < 1 || body.images.length > MAX_IMAGES) {
      return json(400, { error: `Send 1-${MAX_IMAGES} images` })
    }
    for (const image of body.images) {
      if (typeof image?.data !== 'string' || !image.data
        || !ALLOWED_MEDIA_TYPES.includes(image.media_type)) {
        return json(400, { error: 'Each image needs base64 data and a jpeg/png/webp media_type' })
      }
      if (image.data.length > MAX_IMAGE_BASE64_LENGTH) {
        return json(400, { error: 'Each image must be under 1.5MB' })
      }
    }
    images = body.images
  } catch {
    return json(400, { error: 'Body must be JSON' })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY is not configured' })

  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      output_config: { format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          ...images.map(image => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: image.media_type, data: image.data }
          })),
          { type: 'text' as const, text: EXTRACTION_PROMPT }
        ]
      }]
    })
  } catch (error) {
    console.error('anthropic call failed', error)
    return json(502, { error: 'Could not reach the extraction service' })
  }

  if (response.stop_reason === 'refusal') {
    return json(422, { error: 'The photos could not be read as a recipe' })
  }

  const text = response.content.find(block => block.type === 'text')?.text
  let extracted
  try {
    extracted = JSON.parse(text ?? '')
  } catch {
    console.error('unparseable model output', text)
    return json(502, { error: 'The extraction service returned something unexpected' })
  }

  if (!extracted.is_recipe || !extracted.recipe) {
    return json(422, { error: "That didn't look like a recipe" })
  }

  return json(200, { recipe: extracted.recipe })
})
