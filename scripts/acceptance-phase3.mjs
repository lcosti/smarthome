// The Phase 3 chain, driven end to end in a real browser:
//
//   two recipes wanting the same thing -> one line on the shopping list
//
// The parts worth checking are the ones that are invisible when they work: the
// alias recorded by tapping a suggestion, the quantities actually being added up,
// the purchase unit turning a total into something you can pick off a shelf, and
// ticking the line taking every row behind it with it.
//
// Runs against the production bundle in .output/public. Each run creates its own
// household, so it needs no seed data and can be repeated.
//
//   pnpm supabase start && pnpm generate && pnpm acceptance:phase3
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
  body: JSON.stringify({ type: 'magiclink', email: `p3-${Date.now()}@example.com`, redirect_to: ORIGIN })
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

/** Add one ingredient to the open recipe and give it a quantity. */
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
  await page.getByRole('link', { name: 'Recipes' }).click()
  await page.waitForURL('**/recipes')
  await page.getByPlaceholder('Search or add a recipe').fill(name)
  await page.getByRole('button', { name: 'Add recipe' }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 15_000 })
}

/** Assign the recipe to the first night that is still free. */
async function planANight(recipeName) {
  await page.getByRole('link', { name: 'Plan' }).click()
  await page.waitForURL('**/plan')
  await page.locator('main ul li button', { hasText: 'Add dinner' }).first().click()
  await page.locator('[role="dialog"] button', { hasText: recipeName }).first().click()
  await page.locator('main').getByText(recipeName).first().waitFor({ timeout: 10_000 })
}

try {
  await page.goto(link.action_link)
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  await page.getByPlaceholder('The Costis').fill('Phase 3')
  await page.getByPlaceholder('Luke').fill('Luke')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household')

  // --- One recipe, which coins the canonical ingredient ---------------------
  await newRecipe('Chilli con carne')
  await addLine('Chopped tomatoes', '400g')
  log('first recipe: typing an unknown ingredient coined a canonical one')

  const coined = (await readTable('ingredients')).filter(i => !i.deleted_at)
  assert(coined.length === 1, `exactly one canonical ingredient, got ${coined.length}`)
  assert(coined[0].base_unit === 'g', `base unit inferred from "400g", got ${coined[0].base_unit}`)
  log('its unit was inferred from the quantity, with nobody asked')

  // --- A second recipe, reaching the same ingredient by another name --------
  await newRecipe('Pasta bake')
  const box = page.getByPlaceholder('Add an ingredient')
  await box.fill('tinned tomatoes')
  // Two characters in, the suggestion list offers what the household knows.
  const suggestion = page.locator('button', { hasText: 'Chopped tomatoes' }).first()
  await suggestion.waitFor({ timeout: 10_000 })
  await suggestion.click()
  await page.locator('main li', { hasText: 'Chopped tomatoes' }).first().waitFor({ timeout: 10_000 })
  log('second recipe: tapped the suggestion instead of coining a second row')

  const afterPick = (await readTable('ingredients')).filter(i => !i.deleted_at)
  assert(afterPick.length === 1, `still one canonical ingredient, got ${afterPick.length}`)
  const aliases = (await readTable('ingredient_aliases')).filter(a => !a.deleted_at)
  assert(aliases.length === 1, `the typed name was recorded as an alias, got ${aliases.length}`)
  assert(aliases[0].alias === 'tinned tomatoes', `alias is what was typed, got "${aliases[0].alias}"`)
  log('what was typed became an alias, so next time it resolves on its own')

  await page.locator('main li button', { hasText: 'Chopped tomatoes' }).first().click()
  await page.getByLabel('Quantity').fill('400g')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.locator('main li', { hasText: '400g' }).first().waitFor({ timeout: 10_000 })

  // --- Both nights on the plan, then derive --------------------------------
  await planANight('Chilli con carne')
  await planANight('Pasta bake')
  await page.getByRole('button', { name: 'Add to shopping list' }).click()
  await page.getByText('On list').first().waitFor({ timeout: 15_000 })
  log('planned both nights and derived the week')

  await page.getByRole('link', { name: 'List' }).click()
  await page.waitForURL(`${ORIGIN}/`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 10_000 })

  const grouped = await mainText()
  assert(grouped.includes('800g'), `the two 400g lines were added up, saw: ${grouped.slice(0, 200)}`)
  assert(
    grouped.includes('Chilli con carne') && grouped.includes('Pasta bake'),
    'the grouped line names both recipes'
  )
  // One visible line, two rows behind it.
  assert(
    (grouped.match(/tomatoes/gi) ?? []).length === 1,
    `tomatoes appear once, not twice, saw: ${grouped.slice(0, 200)}`
  )
  const rows = (await readTable('items')).filter(i => !i.deleted_at && i.ingredient_id)
  assert(rows.length === 2, `two rows still exist underneath, got ${rows.length}`)
  log('two recipes, one line reading 800g, both recipes named')

  // --- A purchase unit turns the total into something to pick off a shelf ---
  await page.goto(`${ORIGIN}/ingredients`)
  await page.locator('main button', { hasText: 'Chopped tomatoes' }).first().click()
  await page.getByPlaceholder('tin').fill('tin')
  await page.getByPlaceholder('400').fill('400')
  await page.getByRole('button', { name: 'Add purchase unit' }).click()
  await page.locator('[role="dialog"]').getByText('1 tin = 400g').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Save' }).click()
  log('told it a tin is 400g')

  await page.getByRole('link', { name: 'List' }).click()
  await page.waitForURL(`${ORIGIN}/`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 10_000 })
  const withUnits = await mainText()
  assert(withUnits.includes('2 tins'), `the total is also given in tins, saw: ${withUnits.slice(0, 200)}`)
  log('the line now reads 800g and 2 tins')

  // --- Ticking the line takes every row behind it --------------------------
  await page.locator('main li', { hasText: 'tomatoes' }).first().getByRole('button').first().click()
  await page.getByRole('button', { name: /^Done \(2\)/ }).waitFor({ timeout: 10_000 })
  const ticked = (await readTable('items')).filter(i => i.ingredient_id && !i.deleted_at)
  assert(ticked.length === 2 && ticked.every(i => i.checked), 'both rows behind the line are ticked')
  log('ticking the one line ticked both rows behind it')

  // --- And it is all still idempotent -------------------------------------
  await page.getByRole('link', { name: 'Plan' }).click()
  await page.getByRole('button', { name: 'Add to shopping list' }).click()
  await page.getByText('Already on the list').first().waitFor({ timeout: 15_000 })
  log('deriving again still changes nothing')

  // --- The alias now resolves without anybody choosing --------------------
  await page.getByRole('link', { name: 'Recipes' }).click()
  await page.waitForURL('**/recipes')
  await page.getByPlaceholder('Search or add a recipe').fill('Soup')
  await page.getByRole('button', { name: 'Add recipe' }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 15_000 })
  const soupBox = page.getByPlaceholder('Add an ingredient')
  await soupBox.fill('tinned tomatoes')
  await soupBox.press('Enter')
  await page.locator('main li', { hasText: 'tinned tomatoes' }).first().waitFor({ timeout: 10_000 })

  const finalIngredients = (await readTable('ingredients')).filter(i => !i.deleted_at)
  assert(finalIngredients.length === 1, `still one canonical ingredient, got ${finalIngredients.length}`)
  const soupLine = (await readTable('recipe_ingredients'))
    .find(l => !l.deleted_at && l.name === 'tinned tomatoes')
  assert(soupLine?.ingredient_id === finalIngredients[0].id, 'the alias resolved silently on enter')
  log('typing the alias resolved it with no suggestion tapped and no new row')

  console.log('\n  PASS — an alias learned once, quantities added up, and one line ticked as one\n')
} catch (e) {
  console.error(`\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}\n`)
  console.error('  url  :', page.url())
  console.error('  main :', (await mainText().catch(() => '')).slice(0, 400))
  console.error('  ingredients:', JSON.stringify((await readTable('ingredients').catch(() => []))
    .map(r => ({ name: r.name, unit: r.base_unit, merged: r.merged_into, deleted: r.deleted_at }))))
  console.error('  aliases:', JSON.stringify((await readTable('ingredient_aliases').catch(() => []))
    .map(r => r.alias)))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
