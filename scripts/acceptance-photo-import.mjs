// Photo import, driven end to end in a real browser:
//
//   a photo of a recipe -> a recipe in the library, canonicalised like a typed one
//
// The LLM itself is stubbed at the network seam — Playwright answers the Edge
// Function's URL with a canned extraction — so this exercises everything the
// client owns: the camera input, canvas compression, the invoke plumbing and its
// payload shape, response validation, and the commit path through the same
// stores and ingredient canonicalisation a hand-typed recipe uses. Two imports
// sharing an ingredient must end up sharing a canonical row.
//
// The function's own behaviour (the real Anthropic call) is verified by hand:
//   supabase functions serve import-recipe-photo --env-file supabase/functions/.env
// then curl it with a base64 photo — see the header of the function itself.
//
// Runs against the production bundle in .output/public:
//   pnpm supabase start && pnpm generate && pnpm acceptance:photo-import
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
  body: JSON.stringify({ type: 'magiclink', email: `p4-${Date.now()}@example.com`, redirect_to: ORIGIN })
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

// --- The stub: what "the model read the photo" answers with -----------------

const SOUP = {
  name: 'Lentil soup',
  base_servings: 4,
  prep_minutes: 10,
  cook_minutes: 30,
  steps: ['Soften the onion.', 'Add everything else and simmer.'],
  ingredients: [
    { name: 'chopped tomatoes', quantity: '400g' },
    { name: 'red lentils', quantity: '200g' },
    { name: 'onion', quantity: '1' }
  ],
  // The folio the photographs showed. Offered into the box, never stored on its
  // own — the two imports below are the two halves of that rule.
  page: '77'
}

const BOLOGNESE = {
  name: 'Bolognese',
  base_servings: 4,
  prep_minutes: null,
  cook_minutes: 45,
  steps: ['Brown the mince, add the tomatoes, simmer.'],
  ingredients: [
    { name: 'chopped tomatoes', quantity: '400g' },
    { name: 'beef mince', quantity: '500g' }
  ],
  page: '31'
}

let cannedRecipe = SOUP
let failPosts = false
const seenPayloads = []

await page.route('**/functions/v1/import-recipe-photo', async (route) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  }
  if (route.request().method() === 'OPTIONS') {
    return route.fulfill({ status: 200, headers, body: 'ok' })
  }
  // Every POST while this is set, not just the first: a fetch that dies on the
  // wire is retried once under supabase-js, and failing only the first attempt
  // means the retry succeeds and the error path this is here to check never
  // runs. Cleared by the step that sets it.
  if (failPosts) return route.abort('failed')
  seenPayloads.push(route.request().postDataJSON())
  return route.fulfill({
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe: cannedRecipe })
  })
})

/**
 * A fixture photo, drawn in the page so createImageBitmap is guaranteed to
 * decode it — this is the same canvas pipeline the compression uses. Large on
 * purpose: 3000px wide proves the client downscales before uploading.
 */
async function makePhoto(label) {
  const dataUrl = await page.evaluate((text) => {
    const canvas = document.createElement('canvas')
    canvas.width = 3000
    canvas.height = 2000
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#000'
    context.font = '120px serif'
    context.fillText(text, 100, 300)
    return canvas.toDataURL('image/jpeg', 0.9)
  }, label)
  return {
    name: `${label}.jpg`,
    mimeType: 'image/jpeg',
    buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  }
}

/**
 * Picking the photos also asks which book they came off, over the top of the
 * extraction. `book` answers it; leaving it out takes the way out that every
 * recipe printed on a card or clipped out of a magazine takes.
 *
 * `via` picks which of the two pickers the menu opens. 'library' is the
 * multi-select the phone's gallery hands back in one go; 'camera' is one shot
 * per tap, gathered in the tray until somebody says that is the whole recipe.
 * Playwright cannot hold up a phone, but everything after the file lands on the
 * input is the same code either way — which is the part with the tray in it.
 */
async function importPhotos(labels, book = null, via = 'library') {
  await page.getByRole('button', { name: 'Add recipe from a photo' }).click()

  if (via === 'camera') {
    await page.getByRole('menuitem', { name: 'Take a photo' }).click()
    for (const [index, label] of labels.entries()) {
      // The camera comes back one page at a time; the tray is where the next
      // one is asked for.
      if (index) await page.getByTestId('recipe-add-page').click()
      await page.setInputFiles('[data-testid="recipe-camera-input"]', await makePhoto(label))
      await page.getByTestId('recipe-read-photos').waitFor({ timeout: 10_000 })
    }
    await page.getByTestId('recipe-read-photos').click()
  } else {
    await page.getByRole('menuitem', { name: 'Choose photos' }).click()
    await page.setInputFiles(
      '[data-testid="recipe-photo-input"]',
      await Promise.all(labels.map(makePhoto))
    )
  }

  if (book) {
    // The page the photos showed arrives in the box on its own, and is typed
    // over here — a reading is an offer, and what somebody types wins.
    if (book.reads) {
      await becomes(
        () => page.getByTestId('recipe-page').inputValue(),
        book.reads,
        'the page read off the photo was offered in the box'
      )
    }
    await page.getByTestId('recipe-book').fill(book.title)
    await page.getByTestId('recipe-page').fill(book.page)
    await page.getByTestId('recipe-book-save').click()
  } else {
    await page.getByRole('button', { name: 'Not from a book' }).click()
  }
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 20_000 })
}

/** Poll a value until it is what it should be, or say what it was instead. */
async function becomes(read, want, message) {
  const deadline = Date.now() + 20_000
  let saw
  while (Date.now() < deadline) {
    saw = await read()
    if (saw === want) return
    await page.waitForTimeout(200)
  }
  throw new Error(`FAILED: ${message} — wanted ${JSON.stringify(want)}, saw ${JSON.stringify(saw)}`)
}

try {
  await page.goto(link.action_link)
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  await page.getByPlaceholder('The Costis').fill('Phase 4')
  await page.getByPlaceholder('Luke').fill('Luke')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await page.goto(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household')

  // --- A two-photo import: the cookbook-spread case -------------------------
  await page.getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes')
  await importPhotos(
    ['soup-ingredients', 'soup-method'],
    { title: 'Ottolenghi Simple', page: 'p. 82-83', reads: '77' }
  )
  log('photographed a two-page spread, said which book it was, and landed on the new recipe')

  const payload = seenPayloads[0]
  assert(payload?.images?.length === 2, `both photos went up, got ${payload?.images?.length}`)
  assert(
    payload.images.every(i => i.media_type === 'image/jpeg' && i.data.length > 0),
    'each photo arrived as non-empty base64 jpeg'
  )
  // 3000px of white page compresses to far less than the original; the exact
  // size varies by encoder, but a megabyte of base64 would mean no downscale.
  assert(
    payload.images.every(i => i.data.length < 1_000_000),
    'photos were downscaled before upload'
  )
  log('the payload held both photos, compressed and base64-encoded')

  const soupText = await mainText()
  // The name is an editable field, so it is read as a value rather than as text:
  // what is on the screen is what can be corrected. The steps are rows.
  assert(
    (await page.getByLabel('Recipe name').inputValue()) === 'Lentil soup',
    'the recipe page shows the extracted name'
  )
  // Case-insensitively: an ingredient is shown under the library's own name for
  // it, which is capitalised, not under the words the photo happened to use.
  assert(/chopped tomatoes/i.test(soupText), 'the ingredient lines are shown')
  assert(soupText.includes('Soften the onion.'), 'the first step is shown')
  assert(soupText.includes('Add everything else and simmer.'), 'and so is the second')
  // The method must not have landed back in the notes box it was moved out of.
  assert(
    (await page.getByLabel('Notes').inputValue()).trim() === '',
    'the notes are left empty for notes'
  )
  log('name, ingredients and separate steps all visible on the recipe page')

  const recipes = (await readTable('recipes')).filter(r => !r.deleted_at)
  const soup = recipes.find(r => r.name === 'Lentil soup')
  assert(soup, 'the recipe row exists')
  assert(soup.base_servings === 4, `servings extracted, got ${soup.base_servings}`)
  assert(soup.prep_minutes === 10 && soup.cook_minutes === 30, 'prep and cook minutes extracted')
  // The one fact the photographs cannot carry, and the only one a person typed.
  // "p. 82-83" was typed the way it is printed and is stored as the page itself.
  assert(soup.source_book === 'Ottolenghi Simple', `the book was recorded, got ${soup.source_book}`)
  assert(soup.source_page === '82-83', `the page was tidied and recorded, got ${soup.source_page}`)
  log('the recipe row carries servings, times, and the book it was photographed out of')

  assert(
    (await page.getByTestId('recipe-book').inputValue()) === 'Ottolenghi Simple',
    'the recipe page offers the book back for correcting'
  )
  assert(
    (await page.getByTestId('recipe-page').inputValue()) === '82-83',
    'and the page number with it'
  )

  const lines = (await readTable('recipe_ingredients'))
    .filter(l => !l.deleted_at && l.recipe_id === soup.id)
  assert(lines.length === 3, `three ingredient lines, got ${lines.length}`)
  assert(lines.every(l => l.ingredient_id), 'every line was stamped with a canonical ingredient')
  const canonical = (await readTable('ingredients')).filter(i => !i.deleted_at)
  assert(canonical.length === 3, `three canonical ingredients coined, got ${canonical.length}`)
  const tomatoes = canonical.find(i => i.name.toLowerCase() === 'chopped tomatoes')
  assert(tomatoes?.base_unit === 'g', `unit inferred from "400g", got ${tomatoes?.base_unit}`)
  log('every line canonicalised, units inferred — exactly as if typed')

  // --- A second import sharing an ingredient: no second row ----------------
  cannedRecipe = BOLOGNESE
  await page.getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes')
  await importPhotos(['bolognese-page', 'bolognese-overleaf'], null, 'camera')
  log('photographed a second recipe a page at a time, off no book at all')

  assert(
    seenPayloads[1]?.images?.length === 2,
    `the tray sent both shots as one recipe, got ${seenPayloads[1]?.images?.length}`
  )
  log('two taps of the camera became one two-page payload')

  const bolognese = (await readTable('recipes')).find(r => r.name === 'Bolognese')
  // The other half of the rule: those photos "showed" page 31, and nobody said
  // it came out of a book, so nothing was written. A read page is an offer.
  assert(
    bolognese && bolognese.source_book === null && bolognese.source_page === null,
    'a page read off a photo is not stored when the question was waved away'
  )

  const after = (await readTable('ingredients')).filter(i => !i.deleted_at)
  const tomatoRows = after.filter(i => i.name.toLowerCase() === 'chopped tomatoes')
  assert(tomatoRows.length === 1, `imports share one canonical tomatoes row, got ${tomatoRows.length}`)
  assert(after.length === 4, `only the genuinely new ingredient was coined, got ${after.length}`)
  log('the shared ingredient resolved to the existing row, coining nothing')

  // --- A request that dies on the wire: signal advice, not a crash ----------
  // A failed fetch yields a FunctionsFetchError whose context is the raw
  // network error, not a Response; assuming a readable body once surfaced as
  // "t.context.json is not a function" in the toast.
  failPosts = true
  await page.getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes')
  await page.setInputFiles('[data-testid="recipe-photo-input"]', [await makePhoto('unreachable')])
  // `.last()`, because a toast says itself twice: once in the live region a
  // screen reader hears and once on screen, and only the second is visible.
  await page
    .getByText('Could not read the photo — check your signal and try again.')
    .last()
    .waitFor({ timeout: 20_000 })
  failPosts = false
  log('a request that never got a response surfaced the friendly signal message')

  console.log('\n  PASS — a photo became a recipe, canonicalised like a typed one\n')
} catch (e) {
  console.error(`\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}\n`)
  console.error('  url  :', page.url())
  console.error('  main :', (await mainText().catch(() => '')).slice(0, 400))
  console.error('  recipes:', JSON.stringify((await readTable('recipes').catch(() => []))
    .map(r => ({ name: r.name, servings: r.base_servings }))))
  console.error('  ingredients:', JSON.stringify((await readTable('ingredients').catch(() => []))
    .map(r => ({ name: r.name, unit: r.base_unit }))))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
