// The acceptance test from CLAUDE.md, driven end to end in a real browser:
//
//   put the phone in airplane mode, open the app from the home screen, tick five
//   items, close it, reopen it, come back online. Nothing lost.
//
// Then the other half of Phase 1: two devices, one household, staying in step.
//
// Runs against the production bundle in .output/public, because that is the only
// build with a service worker. Each run creates its own household, so it needs no
// seed data and can be run repeatedly without resetting the database.
//
//   pnpm supabase start && pnpm generate && node scripts/acceptance.mjs
//
// Needs SUPABASE_KEY and SUPABASE_SECRET_KEY in .env — see .env.example.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

const PORT = 3000
const ORIGIN = `http://localhost:${PORT}`
const ROOT = '.output/public'

// Keys live in .env, which is gitignored — never inline them here. `supabase status`
// prints the current values for the local stack.
try {
  process.loadEnvFile('.env')
} catch {
  // No .env; fall back to whatever is already exported.
}

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const PUBLISHABLE_KEY = process.env.SUPABASE_KEY
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY

for (const [name, value] of [['SUPABASE_KEY', PUBLISHABLE_KEY], ['SUPABASE_SECRET_KEY', SECRET_KEY]]) {
  if (value) continue
  console.error(`${name} is not set. Add it to .env — run \`pnpm supabase status\` for the local stack's keys.`)
  process.exit(1)
}

const RUN = Date.now()
const EMAIL = `acceptance-${RUN}@example.com`
const PARTNER_EMAIL = `partner-${RUN}@example.com`
const HOUSEHOLD = `Acceptance ${RUN}`

const ONLINE_ITEMS = ['Milk', 'Bananas', 'Sourdough']
const OFFLINE_ITEMS = ['Kitchen roll', 'Coffee beans']
const TO_TICK = [...ONLINE_ITEMS, ...OFFLINE_ITEMS]

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

let step = 0
function log(message) {
  console.log(`  ${String(++step).padStart(2, ' ')}. ${message}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`)
}

/** Proves a response came from this server and not from something else on the port. */
const SENTINEL = `/__acceptance-${RUN}`

/** Static file server with an SPA fallback, mirroring the netlify.toml redirect. */
function serve() {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, ORIGIN).pathname)
    if (pathname === SENTINEL) {
      res.setHeader('Content-Type', 'text/plain')
      res.end('ok')
      return
    }
    let file = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''))
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(ROOT, 'index.html')
    }
    try {
      const body = await readFile(file)
      res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
      res.end(body)
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  return new Promise(resolve => server.listen(PORT, () => resolve(server)))
}

async function api(path, { key = PUBLISHABLE_KEY, token = key, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'apikey': key, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body)
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`)
  return text ? JSON.parse(text) : null
}

const admin = (path, options = {}) => api(path, { ...options, key: SECRET_KEY })

/** Ask the auth server for a magic link, so the real sign-in path is exercised. */
async function magicLink(email) {
  const user = await admin('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: { type: 'magiclink', email, redirect_to: ORIGIN }
  })
  assert(user.action_link, 'auth server returned a magic link')
  return user.action_link
}

/** `supabase db reset` restarts the containers, so wait for auth to answer. */
async function waitForSupabase(timeout = 60_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      if ((await fetch(`${API}/auth/v1/health`, { headers: { apikey: PUBLISHABLE_KEY } })).ok) return
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`Supabase auth not reachable at ${API}`)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

const itemNamed = (page, name) => page.locator('main li', { hasText: name }).first()
const addBox = page => page.getByPlaceholder('Add an item')
const doneToggle = page => page.getByRole('button', { name: /^Done \(/ })

async function addItem(page, name) {
  await addBox(page).fill(name)
  await addBox(page).press('Enter')
  await itemNamed(page, name).waitFor({ timeout: 10_000 })
}

async function tick(page, name) {
  await itemNamed(page, name).getByRole('button').first().click()
}

/** Reads the mutation queue straight out of IndexedDB, the durable source. */
function queueLength(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('shoplist')
    open.onsuccess = () => {
      const request = open.result.transaction('mutations').objectStore('mutations').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(-1)
    }
    open.onerror = () => resolve(-1)
  }))
}

async function waitForQueue(page, expected, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let seen = await queueLength(page)
  while (seen !== expected && Date.now() < deadline) {
    await page.waitForTimeout(250)
    seen = await queueLength(page)
  }
  assert(seen === expected, `queue drains to ${expected} (stuck at ${seen})`)
}

/**
 * Block until the worker is actually controlling this page and the shell is in
 * the cache — the precondition for the app opening at all with no signal.
 *
 * Polled from here with `evaluate` rather than with `waitForFunction`, because
 * `waitForFunction` does not await an async predicate: it only tests the
 * returned value for truthiness, and an async function returns a Promise, which
 * is always truthy. Written that way it returns on its first poll no matter what
 * the worker is doing, and the test then goes offline before anything has been
 * precached — which fails the reopen a good second later and looks like a bug in
 * the app rather than in the waiting.
 */
async function waitForServiceWorker(page, timeout = 30_000) {
  const deadline = Date.now() + timeout
  for (;;) {
    const ready = await page.evaluate(async () => {
      if (!navigator.serviceWorker.controller) return false
      for (const name of await caches.keys()) {
        if ((await (await caches.open(name)).keys()).length > 5) return true
      }
      return false
    })
    if (ready) return
    if (Date.now() > deadline) {
      const diag = await page.evaluate(async () => ({
        regs: (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: r.active?.state, installing: !!r.installing, waiting: !!r.waiting })),
        controller: !!navigator.serviceWorker.controller,
        caches: await caches.keys(),
        url: location.href
      }))
      throw new Error('service worker did not precache the shell in time: ' + JSON.stringify(diag))
    }
    await page.waitForTimeout(250)
  }
}

async function signIn(context, email) {
  const page = await context.newPage()
  page.on('pageerror', error => console.error('     page error:', error.message))
  await page.goto(await magicLink(email))
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  return page
}

/**
 * Confirm the browser will reach *this* server on ORIGIN.
 *
 * A `pnpm dev` left running is the trap here. Node's listen() binds both stacks,
 * but a dev server already holding [::1]:3000 leaves the IPv4 address free, so
 * listen() succeeds and nothing looks wrong — while Chromium resolves localhost
 * to ::1 first and drives the dev server instead. The dev build has no service
 * worker, so the offline half of this test then fails in a way that reads
 * exactly like the app being broken.
 */
async function assertOwnServer() {
  let body = null
  try {
    body = await (await fetch(ORIGIN + SENTINEL)).text()
  } catch {
    // Fall through to the error below.
  }
  if (body === 'ok') return
  throw new Error(
    `something else is already serving ${ORIGIN} — stop it (a stray \`pnpm dev\`?) and run this again`
  )
}

await waitForSupabase()
const server = await serve()
await assertOwnServer()
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const contexts = [context]
let failure = null

try {
  console.log(`\nAcceptance test — household "${HOUSEHOLD}"\n`)

  // --- First run on a new device -------------------------------------------
  log('opening the app on an unknown device')
  const first = await context.newPage()
  first.on('pageerror', error => console.error('     page error:', error.message))
  await first.goto(ORIGIN)
  await first.waitForURL('**/login', { timeout: 20_000 })
  assert(await first.getByPlaceholder('you@example.com').isVisible(), 'login screen shown')
  await first.close()

  log('signing in through a magic link')
  const page = await signIn(context, EMAIL)

  log('creating a household')
  await page.getByPlaceholder('The Costis').fill(HOUSEHOLD)
  await page.getByPlaceholder('Luke').fill('Acceptance')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(ORIGIN + '/', { timeout: 20_000 })
  await page.getByText('Nothing on the list').waitFor({ timeout: 20_000 })

  log(`adding ${ONLINE_ITEMS.length} items while online`)
  for (const name of ONLINE_ITEMS) await addItem(page, name)
  await waitForQueue(page, 0)

  log('filing Milk under Chilled with a quantity')
  await itemNamed(page, 'Milk').getByRole('button', { name: /^Edit/ }).click()
  await page.getByRole('textbox').nth(1).fill('2 pints')
  await page.getByRole('button', { name: 'Chilled', exact: true }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.locator('main h2', { hasText: 'Chilled' }).waitFor({ timeout: 10_000 })
  await waitForQueue(page, 0)
  log('it moved into a Chilled group, sorted by aisle')

  log('waiting for the service worker to precache the shell')
  await waitForServiceWorker(page)

  // --- Airplane mode -------------------------------------------------------
  log('going offline')
  await context.setOffline(true)

  log(`adding ${OFFLINE_ITEMS.length} more items and ticking ${TO_TICK.length}, all offline`)
  for (const name of OFFLINE_ITEMS) await addItem(page, name)
  for (const name of TO_TICK) await tick(page, name)
  await page.getByRole('button', { name: `Done (${TO_TICK.length})` }).waitFor({ timeout: 10_000 })
  assert(await page.getByText('to sync').isVisible(), 'pending-sync badge shown while offline')

  // The UI updates optimistically and the IndexedDB write lands a moment later.
  // Wait for the queue to be on disk before killing the page, so this tests
  // durability rather than how fast Playwright can close a tab.
  const offlineWrites = OFFLINE_ITEMS.length + TO_TICK.length
  await waitForQueue(page, offlineWrites, 10_000)
  log(`all ${offlineWrites} offline writes committed to IndexedDB`)

  log('closing the app and reopening it from the home screen, still offline')
  await page.close()
  const reopened = await context.newPage()
  reopened.on('pageerror', error => console.error('     page error:', error.message))
  await reopened.goto(ORIGIN, { waitUntil: 'domcontentloaded' })

  await doneToggle(reopened).waitFor({ timeout: 25_000 })
  assert(!reopened.url().includes('/login'), 'app opens without a login prompt while offline')
  assert(
    await reopened.getByRole('button', { name: `Done (${TO_TICK.length})` }).isVisible(),
    `all ${TO_TICK.length} ticks survived the restart`
  )
  await doneToggle(reopened).click()
  for (const name of TO_TICK) await itemNamed(reopened, name).waitFor({ timeout: 10_000 })
  log('every tick and both new items survived the restart')

  // --- Back online ---------------------------------------------------------
  log('coming back online')
  assert(await queueLength(reopened) === offlineWrites, 'queue still holds every offline write')
  await context.setOffline(false)
  await reopened.bringToFront()
  await reopened.evaluate(() => window.dispatchEvent(new Event('online')))
  await waitForQueue(reopened, 0)
  log('queue drained to empty')

  // --- Verify against the server, not the UI -------------------------------
  const householdId = await reopened.evaluate(() => JSON.parse(localStorage.getItem('shoplist.identity')).householdId)
  const rows = await admin(
    `/rest/v1/shopping_list_items?select=name,checked,quantity,aisle_id,deleted_at&household_id=eq.${householdId}`
  )
  const live = rows.filter(r => !r.deleted_at)
  const checked = live.filter(r => r.checked).map(r => r.name).sort()
  const milk = live.find(r => r.name === 'Milk')

  assert(live.length === TO_TICK.length, `all ${TO_TICK.length} items on the server (got ${live.length})`)
  assert(
    JSON.stringify(checked) === JSON.stringify([...TO_TICK].sort()),
    `every item ticked on the server (got ${JSON.stringify(checked)})`
  )
  assert(milk?.quantity === '2 pints' && milk.aisle_id, 'the edit reached the server too')
  log('server state matches the screen: nothing lost')

  // --- Two devices, one household ------------------------------------------
  log('reading the invite code off the settings screen')
  await reopened.getByRole('link', { name: 'Settings' }).click()
  const inviteCode = (await reopened.locator('code').innerText()).trim()
  assert(/^[A-Z0-9]{6}$/.test(inviteCode), `invite code looks like a code (got "${inviteCode}")`)
  await reopened.getByRole('link', { name: 'Back to list' }).click()

  // A separate browser context means separate storage: a genuinely different
  // device, signed in as a different person.
  log('joining from a second device as a second person')
  const partnerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  contexts.push(partnerContext)
  const partner = await signIn(partnerContext, PARTNER_EMAIL)
  await partner.getByRole('button', { name: 'Join', exact: true }).click()
  await partner.getByPlaceholder('ABC123').fill(inviteCode)
  await partner.getByPlaceholder('Luke').fill('Partner')
  await partner.getByRole('button', { name: 'Join household' }).click()
  await partner.waitForURL(ORIGIN + '/', { timeout: 20_000 })

  await partner.getByRole('button', { name: `Done (${TO_TICK.length})` }).waitFor({ timeout: 20_000 })
  log('the second device sees the shared list')

  log('adding an item on the first device')
  await addItem(reopened, 'Olive oil')
  await itemNamed(partner, 'Olive oil').waitFor({ timeout: 25_000 })
  log('it arrived on the second device over realtime')

  log('ticking it on the second device')
  await tick(partner, 'Olive oil')
  await reopened
    .getByRole('button', { name: `Done (${TO_TICK.length + 1})` })
    .waitFor({ timeout: 25_000 })
  log('the tick came back to the first device')

  console.log('\n  PASS — offline writes survived a restart and synced on reconnect;'
    + '\n         two devices stay in step over realtime\n')
} catch (error) {
  failure = error
  console.error(`\n  ${error.message}\n`)
  const [last] = contexts.flatMap(c => c.pages()).slice(-1)
  if (last) {
    try {
      console.error('  url:', last.url())
      console.error('  body:', (await last.locator('body').innerText()).slice(0, 500).replace(/\n/g, ' | '))
      console.error('  queue:', await queueLength(last))
    } catch (diagnosticError) {
      console.error('  (diagnostics unavailable:', diagnosticError.message, ')')
    }
  }
} finally {
  await browser.close()
  server.close()
}

process.exit(failure ? 1 : 0)
