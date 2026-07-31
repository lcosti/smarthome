// The Phase 5 chain, driven end to end in a real browser:
//
//   a recipe's web address -> a recipe in the library, canonicalised like a typed one
//
// The Edge Function is stubbed at the network seam — Playwright answers its URL
// with a canned extraction — so this exercises everything the client owns: the
// one box on the recipes page telling a pasted link from a recipe name, the
// invoke plumbing and its payload, response validation, the commit path through
// the same stores and ingredient canonicalisation a hand-typed recipe uses, and
// the refusal to import the same address twice.
//
// The function's own two paths are covered elsewhere: the JSON-LD reader by
// tests/recipe-jsonld.test.ts, and the model fallback by hand —
//   supabase functions serve import-recipe-url --env-file supabase/functions/.env
// then curl it with a real recipe URL, see the header of the function itself.
//
// Runs against the production bundle in .output/public:
//   pnpm supabase start && pnpm generate && pnpm acceptance:url-import
// Needs SUPABASE_SECRET_KEY in .env — see .env.example.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

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
  body: JSON.stringify({ type: 'magiclink', email: `p5-${Date.now()}@example.com`, redirect_to: ORIGIN })
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

// --- The stub: what "the page published a recipe" answers with ---------------
//
// Quantities arrive already split off the ingredient names, because that is what
// the function does with a schema.org recipeIngredient line before it answers.

const SOUP_URL = 'https://example.com/recipes/lentil-soup'
const CURRY_URL = 'https://example.com/recipes/chickpea-curry'

const SOUP = {
  name: 'Lentil soup',
  base_servings: 4,
  prep_minutes: 10,
  cook_minutes: 30,
  method: 'Soften the onion.\n\nAdd everything else and simmer.',
  ingredients: [
    { name: 'chopped tomatoes', quantity: '400g' },
    { name: 'red lentils', quantity: '200g' },
    { name: 'onion', quantity: '1' }
  ]
}

const CURRY = {
  name: 'Chickpea curry',
  base_servings: 4,
  prep_minutes: null,
  cook_minutes: 25,
  method: 'Fry the spices, add everything else.',
  ingredients: [
    { name: 'chopped tomatoes', quantity: '400g' },
    { name: 'chickpeas', quantity: '2 x 400g tins' }
  ]
}

const CANNED = { [SOUP_URL]: SOUP, [CURRY_URL]: CURRY }
const seenPayloads = []

await page.route('**/functions/v1/import-recipe-url', async (route) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  }
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 200, headers, body: 'ok' })
  }
  const payload = route.request().postDataJSON()
  seenPayloads.push(payload)
  return route.fulfill({
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe: CANNED[payload?.url] ?? SOUP, source: 'json-ld' })
  })
})

async function paste(url) {
  await page.getByTestId('recipe-draft').fill(url)
  await page.getByRole('button', { name: 'Import recipe from the link' }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 20_000 })
  return page.url().split('/').pop()
}

async function backToRecipes() {
  await page.getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes')
}

try {
  await page.goto(link.action_link)
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  await page.getByPlaceholder('The Costis').fill('Phase 5')
  await page.getByPlaceholder('Luke').fill('Luke')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household')

  // --- Pasting a link into the box that also searches and adds --------------
  await backToRecipes()
  const soupId = await paste(SOUP_URL)
  log('pasted a recipe link and landed on the new recipe')

  assert(seenPayloads.length === 1, `one import call, got ${seenPayloads.length}`)
  assert(seenPayloads[0]?.url === SOUP_URL, `the address went up, got ${seenPayloads[0]?.url}`)
  log('the address was sent to the importer, not made the name of an empty recipe')

  const soupText = await mainText()
  // The name and the method are editable fields, so they are read as values
  // rather than as text: what is on the screen is what can be corrected.
  assert(
    (await page.getByLabel('Recipe name').inputValue()) === 'Lentil soup',
    'the recipe page shows the extracted name'
  )
  assert(soupText.includes('chopped tomatoes'), 'the ingredient lines are shown')
  assert(soupText.includes('400g'), 'the quantities came across')
  assert(
    (await page.getByLabel('Notes').inputValue()).includes('Soften the onion'),
    'the method is shown'
  )
  log('name, ingredients, quantities and method all visible on the recipe page')

  const recipes = (await readTable('recipes')).filter(r => !r.deleted_at)
  const soup = recipes.find(r => r.id === soupId)
  assert(soup, 'the recipe row exists')
  assert(soup.source_url === SOUP_URL, `the row remembers where it came from, got ${soup.source_url}`)
  assert(soup.base_servings === 4, `servings extracted, got ${soup.base_servings}`)
  assert(soup.prep_minutes === 10 && soup.cook_minutes === 30, 'prep and cook minutes extracted')
  log('the recipe row carries the source address, servings and times')

  assert(
    await page.getByRole('link', { name: 'View the original page' }).getAttribute('href') === SOUP_URL,
    'the recipe page links back to the page it came from'
  )
  log('the original page is one tap away')

  const lines = (await readTable('recipe_ingredients'))
    .filter(l => !l.deleted_at && l.recipe_id === soup.id)
  assert(lines.length === 3, `three ingredient lines, got ${lines.length}`)
  assert(lines.every(l => l.ingredient_id), 'every line was stamped with a canonical ingredient')
  const canonical = (await readTable('ingredients')).filter(i => !i.deleted_at)
  assert(canonical.length === 3, `three canonical ingredients coined, got ${canonical.length}`)
  const tomatoes = canonical.find(i => i.name === 'chopped tomatoes')
  assert(tomatoes?.base_unit === 'g', `unit inferred from "400g", got ${tomatoes?.base_unit}`)
  log('every line canonicalised, units inferred — exactly as if typed')

  // --- The same link again: the recipe that exists, not a second copy -------
  await backToRecipes()
  const again = await paste(SOUP_URL)
  assert(again === soupId, 'pasting the same link lands on the recipe it already made')
  assert(seenPayloads.length === 1, `and costs nothing to import, got ${seenPayloads.length} calls`)
  const afterRepeat = (await readTable('recipes')).filter(r => !r.deleted_at)
  assert(afterRepeat.length === 1, `no duplicate recipe, got ${afterRepeat.length}`)
  log('the same address twice is the same recipe, fetched once')

  // --- A different link sharing an ingredient: no second canonical row ------
  await backToRecipes()
  await paste(CURRY_URL)
  log('imported a second recipe that also wants chopped tomatoes')

  const after = (await readTable('ingredients')).filter(i => !i.deleted_at)
  const tomatoRows = after.filter(i => i.name === 'chopped tomatoes')
  assert(tomatoRows.length === 1, `imports share one canonical tomatoes row, got ${tomatoRows.length}`)
  assert(after.length === 4, `only the genuinely new ingredient was coined, got ${after.length}`)
  log('the shared ingredient resolved to the existing row, coining nothing')

  // --- Typing a name still adds a recipe by that name -----------------------
  await backToRecipes()
  await page.getByTestId('recipe-draft').fill('Beans on toast')
  await page.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 20_000 })
  assert(
    (await page.getByLabel('Recipe name').inputValue()) === 'Beans on toast',
    'a typed name still makes a recipe by that name'
  )
  assert(seenPayloads.length === 2, `and imports nothing, got ${seenPayloads.length} calls`)
  log('the same box still adds a recipe by name, without importing anything')

  console.log('\n  PASS — a link became a recipe, canonicalised like a typed one\n')
} catch (e) {
  console.error(`\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}\n`)
  console.error('  url  :', page.url())
  console.error('  main :', (await mainText().catch(() => '')).slice(0, 400))
  console.error('  calls:', JSON.stringify(seenPayloads))
  console.error('  recipes:', JSON.stringify((await readTable('recipes').catch(() => []))
    .map(r => ({ name: r.name, source: r.source_url }))))
  console.error('  ingredients:', JSON.stringify((await readTable('ingredients').catch(() => []))
    .map(r => ({ name: r.name, unit: r.base_unit }))))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
