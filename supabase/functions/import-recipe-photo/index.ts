// Turns photographs of a recipe — a cookbook spread, a printed card — into the
// structured shape the client commits through its normal stores. Everything
// downstream of the response rides the offline queue like a hand-typed recipe.
//
// Lives here rather than in the client because the Anthropic key must never be
// in the static bundle, and ssr:false means Edge Functions are the only
// server-side home this app has.
//
// Its sibling import-recipe-url does the same job for a web address, and tries
// the page's own structured data before spending anything on the model.
//
// Local trial:
//   supabase functions serve import-recipe-photo --env-file supabase/functions/.env
//   curl -s http://127.0.0.1:54321/functions/v1/import-recipe-photo \
//     -H "Authorization: Bearer $SUPABASE_KEY" -H "Content-Type: application/json" \
//     -d "{\"images\":[{\"data\":\"$(base64 -i recipe.jpg)\",\"media_type\":\"image/jpeg\"}]}"

import Anthropic from 'npm:@anthropic-ai/sdk'
import { guardMethod, json } from '../_shared/http.ts'
import { rejectNonMember } from '../_shared/member.ts'
import { RECIPE_SCHEMA } from '../_shared/recipe-schema.ts'

const MAX_IMAGES = 4
// The client compresses to ~200KB before sending (see compressToJpeg), so a
// well-past-that cap costs no real photo anything while bounding what one
// request can make the model read.
const MAX_IMAGE_BASE64_LENGTH = 2_000_000
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number]

const EXTRACTION_PROMPT = `These photos show a single recipe, possibly spread across pages.
Extract it exactly as printed: the recipe's name, servings, prep and cook times in minutes,
the method as plain paragraphs in cooking order, and one ingredient per line with its
quantity exactly as written (e.g. "400g", "2 tbsp", "1 tin"). Use null for anything not
visible in the photos. Do not invent, convert, or normalise anything.
If the photos do not show a recipe, set is_recipe to false and recipe to null.`

Deno.serve(async (req) => {
  const guarded = guardMethod(req)
  if (guarded) return guarded

  const rejection = await rejectNonMember(req)
  if (rejection) return rejection

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
