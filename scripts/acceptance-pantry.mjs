// The pantry, driven end to end in a real browser:
//
//   two onions left over -> a shorter shopping list -> a recipe you can just cook
//
// The parts worth checking are the ones that are invisible when they work. Stock
// coming off the list rather than off the rows. Deriving the same week twice
// spending the same onions once, which is the whole reason reservations exist.
// A pasted order being read, corrected and put away. And a recipe whose every
// ingredient is in the house saying so.
//
// Runs against the production bundle in .output/public. Each run creates its own
// household, so it needs no seed data and can be repeated.
//
//   pnpm supabase start && pnpm generate && pnpm acceptance:pantry
//
// Needs SUPABASE_SECRET_KEY in .env — see .env.example.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

// Keys live in .env locally; CI exports them instead and has no .env at all.
try {
  process.loadEnvFile('.env')
} catch {
  // Fall back to whatever is already exported.
}

// See the note in acceptance.mjs: 4001 for tests, 4000 for the dev server.
const PORT = 4001
const ORIGIN = `http://localhost:${PORT}`
const ROOT = '.output/public'
const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SECRET = process.env.SUPABASE_SECRET_KEY

if (!SECRET) {
  console.error('SUPABASE_SECRET_KEY is not set. Add it to .env — run `pnpm supabase status` for the local stack\'s keys.')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
}

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, ORIGIN).pathname)
  let file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''))
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
await new Promise(r => server.listen(PORT, r))

const link = await (await fetch(`${API}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { 'apikey': SECRET, 'Authorization': `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email: `pantry-${Date.now()}@example.com`, redirect_to: ORIGIN })
})).json()

let step = 0
const log = m => console.log(`  ${String(++step).padStart(2)}. ${m}`)
function assert(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', e => console.error('     page error:', e.message))

const readTable = table => page.evaluate(name => new Promise((resolve) => {
  const open = indexedDB.open('shoplist')
  open.onsuccess = () => {
    const request = open.result.transaction(name).objectStore(name).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve([])
  }
  open.onerror = () => resolve([])
}), table)

const mainText = async () => (await page.locator('main').innerText()).replace(/[\n\t]+/g, ' ')

async function addLine(name, quantity) {
  const box = page.getByPlaceholder('Add an ingredient')
  await box.fill(name)
  await box.press('Enter')
  await page.locator('main li', { hasText: name }).first().waitFor({ timeout: 10_000 })
  await page.locator('main li button', { hasText: name }).first().click()
  await page.getByLabel('Quantity').fill(quantity)
  await page.getByRole('button', { name: 'Save' }).click()
  await page.locator('main li', { hasText: quantity }).first().waitFor({ timeout: 10_000 })
}

async function newRecipe(name) {
  await page.getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes')
  await page.getByPlaceholder('Search, add or paste a link').fill(name)
  await page.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 15_000 })
}

async function planANight(recipeName) {
  await page.getByRole('link', { name: 'Plan', exact: true }).click()
  await page.waitForURL('**/plan')
  await page.locator('main ul li button', { hasText: 'Add dinner' }).first().click()
  await page.locator('[role="dialog"] button', { hasText: recipeName }).first().click()
  await page.locator('main').getByText(recipeName).first().waitFor({ timeout: 10_000 })
}

async function openList() {
  await page.getByRole('link', { name: 'List', exact: true }).click()
  await page.waitForURL(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 10_000 })
}

try {
  await page.goto(link.action_link)
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  await page.getByPlaceholder('The Costis').fill('Pantry')
  await page.getByPlaceholder('Luke').fill('Luke')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await page.goto(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household')

  // --- A recipe that wants three onions -------------------------------------
  await newRecipe('Onion soup')
  await addLine('Onions', '3')
  log('a recipe wanting three onions')

  // --- Two of them are already in the house ---------------------------------
  await page.goto(`${ORIGIN}/settings`)
  await page.getByRole('link', { name: 'Manage pantry' }).click()
  await page.waitForURL('**/pantry')
  const cupboard = page.getByPlaceholder('What\'s in the cupboard')
  await cupboard.fill('Onions')
  await page.getByPlaceholder('How much').fill('2')
  await cupboard.press('Enter')
  await page.locator('main li', { hasText: 'Onions' }).first().waitFor({ timeout: 10_000 })

  const stocked = (await readTable('pantry_items')).filter(r => !r.deleted_at)
  assert(stocked.length === 1, `one pantry row, got ${stocked.length}`)
  assert(Number(stocked[0].on_hand) === 2, `two onions on the shelf, got ${stocked[0].on_hand}`)
  log('recorded two onions in the pantry')

  // --- Derive: the list asks for one, not three -----------------------------
  await planANight('Onion soup')
  await page.getByRole('button', { name: 'Add to shopping list' }).click()
  await page.getByText('On list').first().waitFor({ timeout: 15_000 })
  log('planned the night and derived the week')

  await openList()
  const shopping = await mainText()
  assert(/\b1\b/.test(shopping), `the list asks for one onion, saw: ${shopping.slice(0, 200)}`)
  assert(shopping.includes('in the pantry'), `it says why, saw: ${shopping.slice(0, 200)}`)
  log('the list asks for one onion and says two are in the pantry')

  // The row itself was never rewritten. That is the Phase 3 rule holding: the
  // subtraction is a display, and the rows stay the unit last-write-wins settles.
  const items = (await readTable('items')).filter(i => !i.deleted_at && i.source === 'plan')
  assert(items.length === 1 && items[0].quantity === '3', `the row still says 3, got ${items[0]?.quantity}`)
  log('the underlying row still reads 3, untouched')

  // --- Deriving again spends the same onions once ---------------------------
  const reservedOnce = (await readTable('pantry_reservations')).filter(r => !r.deleted_at)
  assert(reservedOnce.length === 1, `one reservation, got ${reservedOnce.length}`)
  assert(Number(reservedOnce[0].amount) === 3, `it holds three, got ${reservedOnce[0].amount}`)

  await page.getByRole('link', { name: 'Plan', exact: true }).click()
  await page.getByRole('button', { name: 'Add to shopping list' }).click()
  await page.getByText('Already on the list').first().waitFor({ timeout: 15_000 })

  const reservedTwice = (await readTable('pantry_reservations')).filter(r => !r.deleted_at)
  assert(reservedTwice.length === 1, `still one reservation, got ${reservedTwice.length}`)
  assert(reservedTwice[0].id === reservedOnce[0].id, 'the same row, not a second one')
  const stillTwo = (await readTable('pantry_items')).filter(r => !r.deleted_at)
  assert(Number(stillTwo[0].on_hand) === 2, `the shelf is untouched, got ${stillTwo[0].on_hand}`)
  log('deriving again reserved nothing extra and spent nothing')

  // --- Putting a shop away by pasting the order -----------------------------
  await page.goto(`${ORIGIN}/pantry`)
  await page.getByRole('button', { name: 'Paste an order' }).click()
  await page.getByPlaceholder('Paste an order confirmation here').fill([
    'Your order',
    '4 x Onions £1.20',
    'Carrier bag £0.30',
    'Total £1.50'
  ].join('\n'))
  await page.getByRole('button', { name: 'Read the order' }).click()
  await page.getByRole('button', { name: /^Put 1 away$/ }).waitFor({ timeout: 10_000 })

  const review = await mainText()
  // The unmatched line is shown rather than dropped, because a line the app
  // throws away silently is a line nobody can correct.
  assert(review.includes('Carrier bag'), `the unmatched line is still visible, saw: ${review.slice(0, 300)}`)
  assert(!review.includes('Total £1.50'), 'the receipt lines were left out')
  log('read the order: four onions matched, the carrier bag left unticked')

  await page.getByRole('button', { name: /^Put 1 away$/ }).click()
  await page.locator('main li', { hasText: 'Onions' }).first().waitFor({ timeout: 10_000 })
  const afterShop = (await readTable('pantry_items')).filter(r => !r.deleted_at)
  assert(Number(afterShop[0].on_hand) === 6, `two plus four is six, got ${afterShop[0].on_hand}`)
  log('the shop went into the cupboard: six onions')

  // --- The list stops asking altogether -------------------------------------
  await openList()
  const covered = await mainText()
  assert(covered.includes('from the pantry'), `the line is covered outright, saw: ${covered.slice(0, 200)}`)
  assert(covered.includes('Onions'), 'and it is still on the list rather than hidden')
  log('with six in the house the line reads "from the pantry", still tickable')

  // --- Stock survives a reload, which is the offline promise ----------------
  await page.reload()
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  const reloaded = (await readTable('pantry_items')).filter(r => !r.deleted_at)
  assert(Number(reloaded[0].on_hand) === 6, `still six after a reload, got ${reloaded[0].on_hand}`)
  log('and it is all still there after a reload')

  console.log('\n  PASS — stock recorded, subtracted, re-derived safely, and put away from a paste\n')
} catch (e) {
  console.error(`\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}\n`)
  console.error('  url  :', page.url())
  console.error('  main :', (await mainText().catch(() => '')).slice(0, 400))
  console.error('  pantry:', JSON.stringify((await readTable('pantry_items').catch(() => []))
    .map(r => ({ ingredient: r.ingredient_id, on_hand: r.on_hand, deleted: r.deleted_at }))))
  console.error('  reservations:', JSON.stringify((await readTable('pantry_reservations').catch(() => []))
    .map(r => ({ amount: r.amount, date: r.date, settled: r.settled_at, deleted: r.deleted_at }))))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
