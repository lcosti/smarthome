// Turns a recipe's web address into a recipe in the library.
//
// Two paths, in order of preference:
//
//   1. The page publishes schema.org Recipe JSON-LD — most recipe sites do,
//      because search engines reward it. Parse it and answer. No model, no
//      tokens, no wait.
//   2. It does not. Strip the page to text and ask the model, exactly as the
//      photo importer asks it about a photograph.
//
// The fetch has to happen here rather than in the browser: a static site cannot
// read another origin's HTML, and ssr:false means Edge Functions are the only
// server-side home this app has.
//
// Local trial:
//   supabase functions serve import-recipe-url --env-file supabase/functions/.env
//   curl -s http://127.0.0.1:54321/functions/v1/import-recipe-url \
//     -H "Authorization: Bearer $SUPABASE_KEY" -H "Content-Type: application/json" \
//     -d '{"url":"https://www.bbcgoodfood.com/recipes/..."}'

import Anthropic from 'npm:@anthropic-ai/sdk'
import { guardMethod, json } from '../_shared/http.ts'
import { extractRecipeJsonLd } from '../_shared/jsonld.ts'
import { rejectNonMember } from '../_shared/member.ts'
import { RECIPE_SCHEMA } from '../_shared/recipe-schema.ts'

/** Long enough for a slow site, short enough that the client is still waiting. */
const FETCH_TIMEOUT_MS = 10_000
/** A recipe page is tens of kilobytes; a megabyte of it is somebody's homepage. */
const MAX_HTML_BYTES = 2_000_000
/** What the model reads. Well past any recipe, and it bounds the token spend. */
const MAX_TEXT_LENGTH = 40_000

const EXTRACTION_PROMPT = `The text above is a web page containing a single recipe, surrounded by
navigation, comments and other clutter. Extract the recipe exactly as written: its name, servings,
prep and cook times in minutes, the method as plain paragraphs in cooking order, and one ingredient
per line with its quantity exactly as written (e.g. "400g", "2 tbsp", "1 tin"). Use null for anything
the page does not state. Do not invent, convert, or normalise anything.
If the page does not contain a recipe, set is_recipe to false and recipe to null.`

/**
 * True for an address worth fetching.
 *
 * This function holds credentials and sits inside Supabase's network, so it must
 * not become a proxy that fetches whatever it is pointed at. Public web only.
 */
function isPublicHttpUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return false
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false
  if (/^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false
  if (/^(fc|fd|fe80)/.test(host) && host.includes(':')) return false
  if (!host.includes('.') && !host.includes(':')) return false
  return true
}

/** The page as prose: no scripts, no styles, no tags, no runs of whitespace. */
function toPlainText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|header|form|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
}

Deno.serve(async (req) => {
  const guarded = guardMethod(req)
  if (guarded) return guarded

  const rejection = await rejectNonMember(req)
  if (rejection) return rejection

  let target: URL
  try {
    const body = await req.json()
    if (typeof body?.url !== 'string' || !body.url.trim()) {
      return json(400, { error: 'Send a url' })
    }
    target = new URL(body.url.trim())
  } catch {
    return json(400, { error: 'That does not look like a web address' })
  }
  if (!isPublicHttpUrl(target)) {
    return json(400, { error: 'That address cannot be fetched' })
  }

  let html: string
  try {
    const response = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Some recipe sites serve a stub to anything that looks automated.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    })
    if (!response.ok) return json(422, { error: `That page did not load (${response.status})` })
    if (!(response.headers.get('content-type') ?? '').includes('html')) {
      return json(422, { error: 'That address is not a web page' })
    }

    const buffer = await response.arrayBuffer()
    html = new TextDecoder('utf-8').decode(buffer.slice(0, MAX_HTML_BYTES))
  } catch (error) {
    console.error('page fetch failed', target.hostname, error)
    return json(422, { error: 'Could not read that page' })
  }

  // The free path: the page already says what the recipe is.
  const published = extractRecipeJsonLd(html)
  if (published && published.ingredients.length) {
    return json(200, { recipe: published, source: 'json-ld' })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(500, { error: 'ANTHROPIC_API_KEY is not configured' })

  const pageText = toPlainText(html)
  if (pageText.length < 200) return json(422, { error: "That page didn't have a recipe on it" })

  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      output_config: { format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
      messages: [{
        role: 'user',
        content: [{ type: 'text' as const, text: `${pageText}\n\n---\n\n${EXTRACTION_PROMPT}` }]
      }]
    })
  } catch (error) {
    console.error('anthropic call failed', error)
    return json(502, { error: 'Could not reach the extraction service' })
  }

  if (response.stop_reason === 'refusal') {
    return json(422, { error: 'That page could not be read as a recipe' })
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
    return json(422, { error: "That page didn't have a recipe on it" })
  }

  return json(200, { recipe: extracted.recipe, source: 'llm' })
})
