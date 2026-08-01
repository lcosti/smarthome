// Open a route in a real browser at a phone viewport, with a household already
// set up, and screenshot it.
//
//   node .claude/skills/phone-preview/preview.mjs /shopping
//   node .claude/skills/phone-preview/preview.mjs /shopping --wide
//   node .claude/skills/phone-preview/preview.mjs /plan --seed rows.json --full
//
// Needs `pnpm dev` already listening on 4000. Talks to no server but that one:
// the app is offline-first, so a household in localStorage and rows in
// IndexedDB are the whole of what a page needs to render. Nothing here touches
// Supabase, and nothing it writes outlives the browser it writes into.

// Playwright is imported by absolute path because ESM ignores NODE_PATH and
// this file lives outside the package it is importing from.
import { chromium } from '/home/user/smarthome/node_modules/playwright/index.mjs'
import { mkdir, readFile } from 'node:fs/promises'
import { argv, exit } from 'node:process'

const ORIGIN = 'http://localhost:4000'
const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }

const args = argv.slice(2)
const route = args.find(a => a.startsWith('/')) ?? '/shopping'
const flag = name => args.includes('--' + name)
const value = (name, fallback) => {
  const i = args.indexOf('--' + name)
  return i === -1 ? fallback : args[i + 1]
}

const wide = flag('wide')
const viewport = wide ? WIDE : PHONE
const outDir = value('out', '/tmp/phone-preview')
const seedFile = value('seed', null)

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'

/**
 * Enough of a shopping list to fill more than one screen. Four aisles is what
 * the household actually has; six items each is a normal week. A page that only
 * ever renders three rows hides most of what is worth looking at.
 */
function demoRows() {
  const now = new Date().toISOString()
  const aisles = ['Fruit & veg', 'Chilled', 'Meat & fish', 'Cupboard'].map((name, i) => ({
    id: `aaaaaaaa-0000-4000-8000-00000000000${i}`,
    household_id: HOUSEHOLD,
    name,
    sort_order: i + 1,
    deleted_at: null,
    created_at: now,
    updated_at: now
  }))
  const items = aisles.flatMap((aisle, a) =>
    Array.from({ length: 6 }, (_, i) => ({
      id: `bbbbbbbb-0000-4000-8000-0000000${a}000${i}`,
      household_id: HOUSEHOLD,
      name: `${aisle.name} item ${i + 1}`,
      quantity: i % 2 ? `${i + 1} pack` : null,
      aisle_id: aisle.id,
      checked: false,
      checked_at: null,
      source: 'adhoc',
      plan_entry_id: null,
      recipe_ingredient_id: null,
      ingredient_id: null,
      added_by: null,
      deleted_at: null,
      created_at: now,
      updated_at: now
    }))
  )
  // Keys are Dexie store names, not Postgres table names — the shopping list's
  // store is `items` and always has been, so no device has to migrate. See
  // SYNC_TABLES in app/utils/db.ts for the rest of the mapping.
  return { aisles, items }
}

const rows = seedFile ? JSON.parse(await readFile(seedFile, 'utf8')) : demoRows()

await mkdir(outDir, { recursive: true })

// The project pins a Playwright whose browser build is not the one installed
// here, so point it at the container's Chromium rather than downloading.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox']
})
const context = await browser.newContext({ viewport, colorScheme: 'dark' })
const page = await context.newPage()

const pageErrors = []
page.on('pageerror', e => pageErrors.push(e.message))

// A first visit creates the Dexie database, which has to exist before anything
// can be put in it. /login is the one route that renders without a household.
await page.goto(ORIGIN + '/login', { waitUntil: 'networkidle' })

const seeded = await page.evaluate(async ({ HOUSEHOLD, USER, rows }) => {
  // Identity, not a live session, is what gates the UI — see app/utils/identity.ts.
  localStorage.setItem('shoplist.identity', JSON.stringify({ householdId: HOUSEHOLD, userId: USER }))

  const open = indexedDB.open('shoplist')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  const stores = Object.keys(rows).filter(name => db.objectStoreNames.contains(name))
  if (stores.length) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite')
      for (const store of stores) for (const row of rows[store]) tx.objectStore(store).put(row)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  }
  db.close()
  return stores
}, { HOUSEHOLD, USER, rows })

await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded' })
// The app paints from IndexedDB, so there is no request to wait on. Wait for the
// shell instead: <main> is where every page puts its content.
await page.locator('main').waitFor({ timeout: 30_000 })
await page.waitForTimeout(1000)

const shot = `${outDir}/${(wide ? 'wide' : 'phone') + route.replace(/\//g, '-')}.png`
await page.screenshot({ path: shot, fullPage: flag('full') })

console.log(JSON.stringify({ route, viewport, seeded, screenshot: shot, pageErrors }, null, 2))

await browser.close()
exit(0)
