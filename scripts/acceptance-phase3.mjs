// The Phase 3 chain, driven end to end in a real browser:
//
//   two recipes wanting the same thing -> one line on the shopping list
//
// The parts worth checking are the ones that are invisible when they work: the
// unit inferred from a quantity typed a moment later, a merge healing a list that
// is never re-derived, the quantities actually being added up, the purchase unit
// turning a total into something you can pick off a shelf, and ticking the one
// line taking every row behind it with it.
//
// The route through it is the realistic one rather than the flattering one. A
// household that says "tinned tomatoes" gets no suggestion for "Chopped tomatoes",
// because the two share no leading text — so enter coins a second ingredient and
// the two are merged afterwards, which is what merging is for.
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
  await page.getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes')
  await page.getByPlaceholder('Search, add or paste a link').fill(name)
  await page.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 15_000 })
}

/** Assign the recipe to the first night that is still free. */
async function planANight(recipeName) {
  await page.getByRole('link', { name: 'Plan', exact: true }).click()
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

  // --- Suggestions offer what is already known, on a shared word -----------
  await newRecipe('Pasta bake')
  const box = page.getByPlaceholder('Add an ingredient')
  await box.fill('tomat')
  const suggestion = page.locator('button', { hasText: 'Chopped tomatoes' }).first()
  await suggestion.waitFor({ timeout: 10_000 })
  log('typing part of a known name offered it as a suggestion')

  // But this household calls them something with no word in common, so there is
  // nothing to suggest and enter coins a second row. That is the case merging
  // exists for, and it is the realistic one — nobody types "chopped" first.
  await box.fill('tinned tomatoes')
  await box.press('Enter')
  await page.locator('main li', { hasText: 'tinned tomatoes' }).first().waitFor({ timeout: 10_000 })
  await page.locator('main li button', { hasText: 'tinned tomatoes' }).first().click()
  await page.getByLabel('Quantity').fill('400g')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.locator('main li', { hasText: '400g' }).first().waitFor({ timeout: 10_000 })

  const two = (await readTable('ingredients')).filter(i => !i.deleted_at)
  assert(two.length === 2, `an unrecognisable name coined its own row, got ${two.length}`)
  log('a name with nothing in common coined a second ingredient')

  // --- Both nights on the plan, then derive --------------------------------
  await planANight('Chilli con carne')
  await planANight('Pasta bake')
  await page.getByRole('button', { name: 'Add to shopping list' }).click()
  await page.getByText('On list').first().waitFor({ timeout: 15_000 })
  log('planned both nights and derived the week')

  await page.getByRole('link', { name: 'List', exact: true }).click()
  await page.waitForURL(`${ORIGIN}/`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 10_000 })
  const before = await mainText()
  assert(!before.includes('800g'), 'two different ingredients are not added up')
  assert(
    (before.match(/tomatoes/gi) ?? []).length === 2,
    `both lines are present separately, saw: ${before.slice(0, 200)}`
  )
  log('the list shows them as two lines, because they are two ingredients')

  // --- Merging heals the list with no re-derive ----------------------------
  await page.goto(`${ORIGIN}/ingredients`)
  await page.locator('main button', { hasText: 'tinned tomatoes' }).first().click()
  await page.locator('[role="dialog"]').getByRole('button', { name: 'Merge' }).click()
  await page.locator('[role="dialog"] button', { hasText: 'Chopped tomatoes' }).first().click()
  await page.waitForTimeout(1500)
  const merged = await readTable('ingredients')
  const loser = merged.find(i => i.name === 'tinned tomatoes')
  const winner = merged.find(i => i.name === 'Chopped tomatoes')
  assert(loser?.merged_into === winner?.id, 'the loser points at the winner')
  assert(loser?.deleted_at, 'the loser is soft-deleted, never hard-deleted')
  const mergedAliases = (await readTable('ingredient_aliases')).filter(a => !a.deleted_at)
  assert(
    mergedAliases.some(a => a.alias === 'tinned tomatoes' && a.ingredient_id === winner.id),
    `the loser name became a way of finding the winner, got ${JSON.stringify(mergedAliases.map(a => a.alias))}`
  )
  log('merged one into the other: a pointer, a soft delete, and a kept name')

  await page.getByRole('link', { name: 'List', exact: true }).click()
  await page.waitForURL(`${ORIGIN}/`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 10_000 })
  const grouped = await mainText()
  // No re-derive happened. The rows still name the loser; following the pointer
  // is what groups them, which is the whole reason a merge costs one write.
  assert(grouped.includes('800g'), `the two 400g lines are now added up, saw: ${grouped.slice(0, 200)}`)
  assert(
    grouped.includes('Chilli con carne') && grouped.includes('Pasta bake'),
    'the grouped line names both recipes'
  )
  assert(
    (grouped.match(/tomatoes/gi) ?? []).length === 1,
    `tomatoes appear once, not twice, saw: ${grouped.slice(0, 200)}`
  )
  const rows = (await readTable('items')).filter(i => !i.deleted_at && i.ingredient_id)
  assert(rows.length === 2, `two rows still exist underneath, got ${rows.length}`)
  log('one line reading 800g, with no re-derive and no rows rewritten')

  // --- A purchase unit turns the total into something to pick off a shelf ---
  await page.goto(`${ORIGIN}/ingredients`)
  await page.locator('main button', { hasText: 'Chopped tomatoes' }).first().click()
  await page.getByPlaceholder('tin', { exact: true }).fill('tin')
  await page.getByPlaceholder('400', { exact: true }).fill('400')
  await page.getByRole('button', { name: 'Add purchase unit' }).click()
  await page.locator('[role="dialog"]').getByText('1 tin = 400g').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Save' }).click()
  log('told it a tin is 400g')

  await page.getByRole('link', { name: 'List', exact: true }).click()
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
  await page.getByRole('link', { name: 'Plan', exact: true }).click()
  await page.getByRole('button', { name: 'Add to shopping list' }).click()
  await page.getByText('Already on the list').first().waitFor({ timeout: 15_000 })
  log('deriving again still changes nothing')

  // --- The alias now resolves without anybody choosing --------------------
  await page.getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes')
  await page.getByPlaceholder('Search, add or paste a link').fill('Soup')
  await page.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 15_000 })
  const soupBox = page.getByPlaceholder('Add an ingredient')
  await soupBox.fill('tinned tomatoes')
  await soupBox.press('Enter')
  await page.locator('main li', { hasText: 'tinned tomatoes' }).first().waitFor({ timeout: 10_000 })

  const finalIngredients = (await readTable('ingredients')).filter(i => !i.deleted_at)
  assert(finalIngredients.length === 1, `still one canonical ingredient, got ${finalIngredients.length}`)
  const soupLines = (await readTable('recipe_ingredients'))
    .filter(l => !l.deleted_at && l.name === 'tinned tomatoes')
  assert(
    soupLines.some(l => l.ingredient_id === finalIngredients[0].id),
    'the name kept by the merge resolved silently on enter'
  )
  log('the merged-away name now resolves on its own, coining nothing')

  console.log('\n  PASS — merged without a re-derive, added up, and ticked as one line\n')
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
