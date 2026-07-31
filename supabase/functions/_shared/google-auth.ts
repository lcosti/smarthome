/**
 * A Google API access token from a service account key.
 *
 * The two-legged OAuth flow, by hand: sign a JWT asserting who we are and what
 * we want, hand it to Google's token endpoint, get a bearer token back. No SDK
 * and no JWT library — this is about fifty lines of web crypto, and every
 * dependency in an Edge Function is a dependency running with the service role.
 *
 * The token is fetched fresh per invocation. At one sync every five minutes that
 * is one extra request each time, and caching it would mean holding credentials
 * across invocations of a function that has no memory between them anyway.
 */

export interface ServiceAccount {
  client_email: string
  private_key: string
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)))
}

/** A PEM private key as the PKCS#8 bytes crypto.subtle wants. */
function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    // Keys arriving through an environment variable usually have literal \n.
    .replace(/\\n/g, '')
    .replace(/\s/g, '')
  const binary = atob(body)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

/** Parse the service account JSON, failing loudly rather than half-configured. */
export function parseServiceAccount(raw: string): ServiceAccount {
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('service account key is missing client_email or private_key')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

export async function getAccessToken(account: ServiceAccount): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const claims = {
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600
  }

  const unsigned = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson(claims)}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  )

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64url(signature)}`
    })
  })

  if (!response.ok) {
    throw new Error(`google token exchange failed: ${response.status} ${await response.text()}`)
  }

  const body = await response.json() as { access_token?: string }
  if (!body.access_token) throw new Error('google token exchange returned no access_token')
  return body.access_token
}

/**
 * Events from one calendar over a window.
 *
 * `singleEvents` expands recurrences into their instances, which is the whole
 * reason this function can stay simple: without it the board would have to
 * understand RRULEs to know whether swimming is on this Tuesday.
 */
export async function fetchEvents(
  token: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<unknown[]> {
  const events: unknown[] = []
  let pageToken: string | undefined

  do {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    )
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('timeMin', timeMin.toISOString())
    url.searchParams.set('timeMax', timeMax.toISOString())
    url.searchParams.set('maxResults', '2500')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) {
      throw new Error(`calendar ${calendarId} failed: ${response.status} ${await response.text()}`)
    }

    const body = await response.json() as { items?: unknown[], nextPageToken?: string }
    events.push(...(body.items ?? []))
    pageToken = body.nextPageToken
  } while (pageToken)

  return events
}
