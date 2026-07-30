// The generator, driven end to end in a real browser:
//
//   a library + who is home + an allergy -> a week somebody would actually cook
//
// The unit tests already pin the scoring. What only a real run can show is that
// the chain holds together: that the roster recorded on one screen reaches the
// generator on another, that an allergy typed on /people genuinely keeps a recipe
// off the plan, that a night somebody chose by hand survives the button, and that
// what comes out is a plan the existing derive can turn into a shopping list.
//
// Runs against the production bundle in .output/public. Each run creates its own
// household, so it needs no seed data and can be repeated.
//
//   pnpm supabase start && pnpm generate && pnpm acceptance:generator
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
  body: JSON.stringify({ type: 'magiclink', email: `gen-${Date.now()}@example.com`, redirect_to: ORIGIN })
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
    const store = open.result.transaction(name).objectStore(name).getAll()
    store.onsuccess = () => resolve(store.result)
    store.onerror = () => resolve([])
  }
  open.onerror = () => resolve([])
}), table)

const mainText = async () => (await page.locator('main').innerText()).replace(/[\n\t]+/g, ' ')

/** Add a recipe with one ingredient, which is enough to be planned and derived. */
async function newRecipe(name, ingredient) {
  await page.getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes')
  await page.getByPlaceholder('Search or add a recipe').fill(name)
  await page.getByRole('button', { name: 'Add recipe' }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 15_000 })
  const box = page.getByPlaceholder('Add an ingredient')
  await box.fill(ingredient)
  await box.press('Enter')
  await page.locator('main li', { hasText: ingredient }).first().waitFor({ timeout: 10_000 })
}

try {
  await page.goto(link.action_link)
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  await page.getByPlaceholder('The Costis').fill('Generator')
  await page.getByPlaceholder('Luke').fill('Luke')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household')

  // --- A library big enough to fill a week without repeating ----------------
  const built = [
    ['Satay noodles', 'Peanut butter'],
    ['Tomato pasta', 'Chopped tomatoes'],
    ['Fish pie', 'Haddock'],
    ['Lentil dhal', 'Red lentils'],
    ['Roast chicken', 'Chicken'],
    ['Bean chilli', 'Kidney beans'],
    ['Veg curry', 'Sweet potato'],
    ['Omelette', 'Eggs']
  ]
  for (const [name, ingredient] of built) await newRecipe(name, ingredient)
  log(`built a library of ${built.length} recipes`)

  // --- A child with a peanut allergy ----------------------------------------
  await page.goto(`${ORIGIN}/people`)
  await page.locator('main').getByText('Luke').first().waitFor({ timeout: 15_000 })
  await page.getByPlaceholder('Add somebody').fill('Tom')
  await page.getByRole('button', { name: 'Add person' }).click()
  await page.locator('main').getByText('Tom').first().waitFor({ timeout: 10_000 })

  await page.locator('main button', { hasText: 'Tom' }).first().click()
  const editor = page.locator('[role="dialog"]')
  await editor.getByPlaceholder('peanuts').fill('peanut')
  await editor.getByRole('button', { name: 'Add', exact: true }).click()
  await editor.getByText('peanut').first().waitFor({ timeout: 10_000 })
  await editor.getByRole('button', { name: 'Save' }).click()
  await page.locator('main').getByText('peanut').first().waitFor({ timeout: 10_000 })
  log('added a child with a peanut allergy')

  // --- One night chosen by hand, which must survive -------------------------
  await page.getByRole('link', { name: 'Plan', exact: true }).click()
  await page.waitForURL('**/plan')
  await page.locator('main ul li button').first().click()
  await page.locator('[role="dialog"] button', { hasText: 'Fish pie' }).first().click()
  await page.locator('main').getByText('Fish pie').first().waitFor({ timeout: 10_000 })
  log('chose Monday by hand: fish pie')

  // --- Fill the rest --------------------------------------------------------
  await page.getByRole('button', { name: 'Fill the empty nights' }).click()
  await page.getByText(/nights? planned/).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  log('pressed fill, and the week came back planned')

  const entries = (await readTable('meal_plan_entries')).filter(e => !e.deleted_at)
  assert(entries.length === 7, `all seven nights are planned, got ${entries.length}`)
  log('seven nights, one recipe each')

  // Never the same thing twice: the rut this exists to break.
  const ids = entries.map(e => e.recipe_id)
  assert(new Set(ids).size === 7, `no recipe appears twice, got ${new Set(ids).size} distinct`)
  log('no recipe appears twice in the week')

  // The allergy is the one thing that is not a preference.
  const recipes = await readTable('recipes')
  const satay = recipes.find(r => r.name === 'Satay noodles')
  assert(satay, 'the satay recipe exists to be excluded')
  assert(
    !ids.includes(satay.id),
    'the peanut recipe was never planned, on any night Tom is home'
  )
  log('the peanut recipe was kept off the plan by the allergy')

  // The hand-chosen night was not overruled.
  const fishPie = recipes.find(r => r.name === 'Fish pie')
  const monday = entries.sort((a, b) => a.date.localeCompare(b.date))[0]
  assert(monday.recipe_id === fishPie.id, 'Monday is still the fish pie somebody chose')
  log('the night chosen by hand was left exactly as it was')

  // Servings follow the roster: two people eating, so two portions.
  assert(
    entries.every(e => e.servings === 2),
    `servings match who is eating, got ${JSON.stringify(entries.map(e => e.servings))}`
  )
  log('servings came from the roster, not the recipe default')

  // --- A night nobody is home stays empty -----------------------------------
  await page.locator('main ul li button').nth(1).click()
  for (const name of ['Luke', 'Tom']) {
    await page.locator('[role="dialog"] button', { hasText: name }).first().click()
    await page.waitForTimeout(300)
  }
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForTimeout(500)
  await page.locator('main ul li button').nth(1).click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Remove' }).click()
  await page.waitForTimeout(1000)

  const gapText = await mainText()
  assert(gapText.includes('away'), `the empty night says who is away, saw: ${gapText.slice(0, 300)}`)
  // Nobody is eating, so there is nothing to suggest and the button knows it.
  const fillAgain = await page.getByRole('button', { name: 'Fill the empty nights' }).count()
  assert(fillAgain === 0, 'a night nobody is home for is not a gap worth filling')
  log('a night nobody is home for stays empty, and is not offered as a gap')

  // --- And the week still derives into a shopping list ----------------------
  await page.getByRole('button', { name: 'Add to shopping list' }).click()
  await page.getByText('On list').first().waitFor({ timeout: 20_000 })
  await page.getByRole('link', { name: 'List', exact: true }).click()
  await page.waitForURL(`${ORIGIN}/`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 10_000 })
  const list = await mainText()
  assert(list.includes('Haddock'), `the generated week reached the list, saw: ${list.slice(0, 300)}`)
  assert(!list.includes('Peanut butter'), 'and the allergen never got near it')
  log('the generated week derived into a shopping list, allergen-free')

  console.log('\n  PASS — a week that repeats nothing, obeys an allergy, and keeps your choices\n')
} catch (e) {
  console.error(`\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}\n`)
  console.error('  url  :', page.url())
  console.error('  main :', (await mainText().catch(() => '')).slice(0, 400))
  console.error('  plan :', JSON.stringify((await readTable('meal_plan_entries').catch(() => []))
    .map(r => ({ date: r.date, recipe: r.recipe_id, servings: r.servings, deleted: r.deleted_at }))))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
