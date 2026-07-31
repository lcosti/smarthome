// The bits of HTTP every function in this project repeats.
//
// The static site on Netlify calls these from a different origin, and Supabase
// does not add CORS headers on the function's behalf.

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

/** A JSON response with the CORS headers already on it. */
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}

/**
 * The preflight and method guard, or null to carry on with the request.
 *
 * Every import function is a POST; anything else is a mistake worth naming
 * rather than a body parse failure further down.
 */
export function guardMethod(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  return null
}
