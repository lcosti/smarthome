// The Phase 2 chain, driven end to end in a real browser:
//
//   a recipe -> a night on the plan -> the shopping list
//
// Checks the parts that are easy to get quietly wrong: deriving twice changes
// nothing, and taking a night off the plan clears what it added without
// touching anything already ticked.
//
// Runs against the production bundle in .output/public. Each run creates its own
// household, so it needs no seed data and can be repeated.
//
//   pnpm supabase start && pnpm generate && pnpm acceptance:phase2
//
// Needs SUPABASE_KEY and SUPABASE_SECRET_KEY in .env — see .env.example.

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
  body: JSON.stringify({ type: 'magiclink', email: `p2-${Date.now()}@example.com`, redirect_to: ORIGIN })
})).json()

let step = 0
const log = m => console.log(`  ${String(++step).padStart(2)}. ${m}`)
function assert(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`)
}

const browser = await chromium.launch()
// A phone, because that is where a week gets planned. The two steps that are
// about the week rather than a night in it — putting it on the list, and taking
// a night back off — switch to the wide layout and say why.
const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 900 }
const ctx = await browser.newContext({ viewport: PHONE })
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

/**
 * One row of the shopping list, and its tick.
 *
 * An aisle is a `UCheckboxGroup`: the row is `[data-slot="item"]` and the tick
 * is a `<button role="checkbox">` — so the first *button* in a row is the edit
 * pencil, not the tick. Scoped to the aisle card because the filter chips above
 * the list are a checkbox group too.
 */
const itemNamed = name =>
  page.locator('[data-shopping-aisle] [data-slot="item"]', { hasText: name }).first()
const tickBox = row => row.getByRole('checkbox')
const tickedBox = row => row.locator('[role="checkbox"][data-state="checked"]')

/** The seven pills of the week strip, by the full date each one reads out. */
const dayTiles = () => page.getByRole('button', {
  name: /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), /
})

/**
 * Put the week on the shopping list, from the week aside.
 *
 * At this width the plan is the whole week with a derive button beside it. The
 * phone's own route to the list is the last step of its walk (`PlanReview`),
 * which is only reached once every night is planned or skipped — a week with one
 * dinner on it never gets there, and this script is about what one dinner does
 * to the list.
 */
async function deriveTheWeek() {
  await page.setViewportSize(WIDE)
  await page.getByRole('link', { name: 'Plan' }).click()
  await page.waitForURL('**/plan')
  await page.getByRole('button', { name: /^(Add to shopping list|Add \d+ to list)$/ }).click()
  await page.getByText(/items? added|Already on the list/).first().waitFor({ timeout: 15_000 })
}

try {
  await page.goto(link.action_link)
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  await page.getByPlaceholder('The Costis').fill('Phase 2')
  await page.getByPlaceholder('Luke').fill('Luke')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  // Straight to the list rather than tapping the tab: the board lands before it
  // has hydrated, and clicking a tab mid-mount is a race this test should not
  // be exercising.
  await page.goto(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household')

  assert(await page.getByRole('link', { name: 'Recipes' }).isVisible(), 'tab bar shows Recipes')
  assert(await page.getByRole('link', { name: 'Plan' }).isVisible(), 'tab bar shows Plan')
  log('tab bar renders List / Plan / Recipes')

  await page.getByRole('link', { name: 'Recipes' }).click()
  await page.waitForURL('**/recipes')
  await page.getByPlaceholder('Search, add or paste a link').fill('Chilli con carne')
  await page.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 15_000 })
  log('created a recipe and landed on its page')

  const INGREDIENTS = ['Beef mince', 'Chopped tomatoes', 'Kidney beans', 'Onion', 'Cumin', 'Rice']
  const box = page.getByPlaceholder('Add an ingredient')
  for (const name of INGREDIENTS) {
    await box.fill(name)
    await box.press('Enter')
    await page.locator('li', { hasText: name }).first().waitFor({ timeout: 10_000 })
  }
  log(`added ${INGREDIENTS.length} ingredients by typing and pressing enter`)

  await page.locator('button', { hasText: 'Chopped tomatoes' }).first().click()
  await page.getByLabel('Quantity').fill('2 tins')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.locator('li', { hasText: '2 tins' }).first().waitFor({ timeout: 10_000 })
  log('set a quantity on one ingredient')

  await page.getByRole('link', { name: 'Plan' }).click()
  await page.waitForURL('**/plan')
  assert(await dayTiles().count() === 7, 'the week strip offers seven days')
  assert((await mainText()).includes('Add dinner'), 'and the night on screen invites a dinner')
  log('plan walks the week a night at a time, starting on an empty one')

  await page.getByRole('button', { name: 'Add dinner' }).first().click()
  await page.locator('[role="dialog"] button', { hasText: 'Chilli con carne' }).first().click()
  await page.locator('main').getByText('Chilli con carne').first().waitFor({ timeout: 10_000 })
  log('assigned the recipe to a night in one tap')

  await deriveTheWeek()
  log('derived the week onto the shopping list')

  await page.getByRole('link', { name: 'List' }).click()
  await page.waitForURL(`${ORIGIN}/shopping`)
  const listed = await mainText()
  for (const name of INGREDIENTS) assert(listed.includes(name), `${name} is on the list`)
  assert(listed.includes('Chilli con carne'), 'items say which recipe they came from')
  assert(listed.includes('2 tins'), 'the quantity carried across')
  log('every ingredient is on the list, labelled with its recipe')

  await page.getByRole('link', { name: 'Plan' }).click()
  await deriveTheWeek()
  await page.getByText('Already on the list').first().waitFor({ timeout: 15_000 })
  log('deriving a second time changes nothing')

  // Tick one item, then take the night off the plan: the ticked one has to
  // survive, everything else it put on the list has to go.
  await page.getByRole('link', { name: 'List' }).click()
  await tickBox(itemNamed('Rice')).click()
  await tickedBox(itemNamed('Rice')).waitFor({ timeout: 10_000 })
  log('ticked one derived item')

  // The wide layout for this one step, deliberately. Taking the last night off
  // leaves a week with nothing selected to review, and the phone's flow ends on
  // a review — so the button that reconciles the list with an emptied week is
  // the one in the week aside. What is being checked is what the removal does to
  // the list, and that is the same code either way.
  await page.setViewportSize(WIDE)
  await page.getByRole('link', { name: 'Plan' }).click()
  await page.waitForURL('**/plan')
  // No <main> in the wide layout — the week is the screen. The dish card itself
  // is the button that opens the night.
  await page.locator('button', { hasText: 'Chilli con carne' }).first().click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Remove' }).click()
  await page.getByRole('button', { name: /^(Add to shopping list|Add \d+ to list)$/ }).click()
  await page.waitForTimeout(3000)
  log('removed the night and re-derived')

  await page.getByRole('link', { name: 'List' }).click()
  await page.waitForURL(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 10_000 })
  const after = await mainText()
  assert(!after.includes('Beef mince'), 'unticked derived items came off with the night')
  // Still there and still ticked — the row stays where it was, struck through,
  // rather than collapsing behind a counter.
  assert(after.includes('Rice'), 'the ticked item survived')
  await tickedBox(itemNamed('Rice')).waitFor({ timeout: 10_000 })
  log('unticked items cleared, the ticked one kept')

  const entries = await readTable('meal_plan_entries')
  assert(entries.length > 0 && entries.every(e => e.deleted_at), 'the night is soft-deleted, never hard-deleted')
  log('the removed night is soft-deleted in IndexedDB')

  console.log('\n  PASS — recipe to plan to list, idempotent, and ticks are respected\n')
} catch (e) {
  console.error(`\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}\n`)
  console.error('  url  :', page.url())
  console.error('  main :', (await mainText().catch(() => '')).slice(0, 240))
  console.error('  plan rows:', JSON.stringify((await readTable('meal_plan_entries').catch(() => []))
    .map(r => ({ date: r.date, deleted: r.deleted_at }))))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
