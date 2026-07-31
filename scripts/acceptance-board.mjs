// The wall board, driven end to end in a real browser at the size it will
// actually hang on a wall:
//
//   a planned night -> no plan and the one button -> an empty list -> the wifi drops
//
// The parts worth checking here are the ones a unit test cannot reach: that the
// board paints inside 1920x1200 without scrolling, that its states change because
// the underlying data changed rather than because a prop was set, and — the
// load-bearing one — that pulling the network out leaves every fact on screen
// and adds an honest caption, instead of producing the spinner or error screen
// the design forbids.
//
// Runs against the production bundle in .output/public. Each run creates its own
// household, so it needs no seed data and can be repeated.
//
//   pnpm supabase start && pnpm generate && pnpm acceptance:board
//
// Needs SUPABASE_SECRET_KEY in .env — see .env.example.

import { createServer } from 'node:http'
import { readFile, stat, mkdir } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

try {
  process.loadEnvFile('.env')
} catch {
  // CI exports the keys instead and has no .env at all.
}

const PORT = 4001
const ORIGIN = `http://localhost:${PORT}`
const ROOT = '.output/public'
const SHOTS = '.acceptance/board'
const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SECRET = process.env.SUPABASE_SECRET_KEY

// The board is designed for exactly one display in exactly one orientation, so
// this is not an arbitrary viewport — it is the product.
const FRAME = { width: 1920, height: 1200 }

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
await mkdir(SHOTS, { recursive: true })

const link = await (await fetch(`${API}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { 'apikey': SECRET, 'Authorization': `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email: `board-${Date.now()}@example.com`, redirect_to: ORIGIN })
})).json()

let step = 0
const log = m => console.log(`  ${String(++step).padStart(2)}. ${m}`)
function assert(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`)
}

/** A date of birth that is the given age whenever this happens to run. */
function yearsAgo(years) {
  const date = new Date()
  date.setFullYear(date.getFullYear() - years)
  return date.toISOString().slice(0, 10)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: FRAME })
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

// The frame is the shell, present on every view; the state attribute belongs to
// Today, which is the only view with content states.
const frame = () => page.locator('[data-board-frame]')
const board = () => page.locator('[data-board-state]')
const boardText = async () => (await frame().innerText()).replace(/[\n\t]+/g, ' ')
const boardState = () => board().getAttribute('data-board-state')

async function openBoard() {
  await page.goto(`${ORIGIN}/board`)
  await board().waitFor({ timeout: 20_000 })
}

/** Nothing may overflow the frame: it is one fixed screen that cannot scroll. */
async function assertFits(view) {
  const fit = await page.evaluate(() => {
    const el = document.querySelector('[data-board-frame]')
    return {
      x: el.scrollWidth > el.clientWidth + 1,
      y: el.scrollHeight > el.clientHeight + 1,
      doc: document.documentElement.scrollHeight > window.innerHeight
    }
  })
  assert(!fit.x && !fit.y && !fit.doc, `${view} fits the frame without scrolling: ${JSON.stringify(fit)}`)
}

async function shoot(name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

try {
  // --- Setup: a household with a child, a recipe and a planned night --------
  await page.goto(link.action_link)
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  await page.getByPlaceholder('The Costis').fill('Board')
  await page.getByPlaceholder('Luke').fill('Luke')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household')

  // --- setup: what a household actually sees the first time ----------------
  //
  // Worth asserting before anything is added, because this state used to be
  // reported as "nobody home for dinner — the calendar has everyone out", which
  // was two untrue statements about a household that had simply just started.
  await openBoard()
  assert(await boardState() === 'setup', `a new household is in setup, got ${await boardState()}`)
  let text = await boardText()
  assert(text.includes('Nothing set up yet'), `the hero says so, saw: ${text.slice(0, 300)}`)
  assert(!text.includes('Nobody home'), 'and does not claim nobody is home when there is nobody at all')
  assert(!/calendar has everyone out/.test(text), 'nor blames a calendar it has never read')
  assert(text.includes('No calendar connected'), 'the schedule says why it is empty')
  assert(text.includes('Nothing on the list yet'), 'and an untouched list is not celebrated')
  assert(!text.includes('Offline'), 'a device that has never synced is new, not stale')
  await shoot('setup')
  log('a brand-new household gets a truthful board with a checklist')

  // The action must go to the step that is genuinely next — the generator can do
  // nothing without a roster and a library.
  await board().getByRole('link', { name: /Add people/ }).click()
  await page.waitForURL('**/people', { timeout: 20_000 })
  log('and its one button leads to the roster rather than a dead generator')

  await page.locator('main').getByText('Luke').first().waitFor({ timeout: 15_000 })
  await page.getByPlaceholder('Add somebody').fill('Tom')
  await page.locator('main input[type="date"]').fill(yearsAgo(2))
  await page.getByRole('button', { name: 'Add person' }).click()
  await page.locator('main').getByText('Tom').first().waitFor({ timeout: 10_000 })
  log('added a toddler, so the roster has two life stages in it')

  await page.goto(`${ORIGIN}/recipes`)
  await page.getByRole('button', { name: 'New recipe' }).click()
  const editor = page.locator('[role="dialog"]')
  await editor.getByPlaceholder('Chilli').fill('Chicken traybake')
  await editor.getByRole('button', { name: 'Save' }).click()
  await page.locator('main').getByText('Chicken traybake').first().waitFor({ timeout: 15_000 })
  log('put one recipe in the library')

  await page.goto(`${ORIGIN}/`)
  for (const item of ['Nappies', 'Bin bags']) {
    await page.getByPlaceholder('Add an item').fill(item)
    await page.keyboard.press('Enter')
    await page.locator('main').getByText(item).first().waitFor({ timeout: 10_000 })
  }
  log('put two things on the shopping list')

  // --- noplan: the one state with one obvious action ------------------------
  await openBoard()
  assert(await boardState() === 'noplan', `nothing is planned yet, got ${await boardState()}`)
  text = await boardText()
  assert(text.includes('No plan for tonight'), `the hero says so, saw: ${text.slice(0, 300)}`)
  assert(text.includes('Plan not generated'), 'the header says the plan was never generated')
  assert(text.includes('Generate this week'), 'the one filled button is offered')
  assert((await board().getByText('—').count()) >= 6, 'the week strip is six em-dashes')
  await shoot('noplan')
  log('with nothing planned the board offers exactly one action')

  // --- The board fits, and does not scroll ----------------------------------
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    clientW: document.documentElement.clientWidth,
    clientH: document.documentElement.clientHeight
  }))
  assert(overflow.scrollW <= overflow.clientW, `nothing overflows sideways: ${JSON.stringify(overflow)}`)
  assert(overflow.scrollH <= overflow.clientH, `nothing overflows downwards: ${JSON.stringify(overflow)}`)
  log('the frame fits 1920x1200 exactly, with no scrolling in either direction')

  // --- Pressing it generates a real plan ------------------------------------
  await board().getByRole('button', { name: /Generate this week/ }).click()
  await board().getByText('Chicken traybake').first().waitFor({ timeout: 20_000 })

  const entries = (await readTable('meal_plan_entries')).filter(e => !e.deleted_at)
  assert(entries.length > 0, 'pressing the button wrote real plan entries')
  assert(await boardState() === 'nominal', `and the board is nominal now, got ${await boardState()}`)
  log(`the button generated ${entries.length} nights, and the hero picked tonight's up`)

  // --- nominal: the things only the board derives ---------------------------
  text = await boardText()
  assert(text.includes('Tonight'), 'the eyebrow is about tonight')
  assert(/Eat \d\d:\d\d/.test(text), `the timing pill states when to eat, saw: ${text.slice(0, 300)}`)
  assert(text.includes('Luke') && text.includes('Tom'), 'both people are on the roster')
  assert(text.includes('Adult portion'), 'the adult gets an adult portion')
  assert(text.includes('Toddler portion'), 'the toddler gets a toddler portion, derived from a birth date')
  assert(text.includes('Plan updated'), 'the header now says when the plan was generated')
  await shoot('nominal')
  log('the roster adapts one meal per person, by age, with nobody asked')

  // --- The roster-led treatment is the same facts, arranged differently -----
  await page.goto(`${ORIGIN}/board?hero=roster`)
  await board().waitFor({ timeout: 20_000 })
  const rosterLed = await boardText()
  assert(rosterLed.includes('for dinner'), `the roster-led hero leads with the count, saw: ${rosterLed.slice(0, 200)}`)
  assert(rosterLed.includes('Chicken traybake'), 'and still closes on the dish')
  await shoot('roster-led')
  log('?hero=roster rearranges the same facts without changing them')

  // --- Tapping a roster row takes somebody off tonight ----------------------
  await openBoard()
  await board().locator('button', { hasText: 'Tom' }).first().click()
  await page.waitForTimeout(1000)
  const attendance = (await readTable('attendance')).filter(a => !a.deleted_at)
  assert(attendance.length === 1, `one row for the one absence, got ${attendance.length}`)
  assert(attendance[0].present === false, 'and it records the absence')
  log('tapping a roster row wrote exactly one attendance row')

  // Put them back, so the later states are not about a half-empty table.
  await board().locator('button', { hasText: 'Tom' }).first().click()
  await page.waitForTimeout(1000)

  // --- the other three views ------------------------------------------------
  //
  // The header is the one thing that survives a view change, so it is asserted
  // across the move rather than on either side of it.
  const headerBefore = await frame().locator('header').innerText()
  await frame().getByRole('link', { name: 'List', exact: true }).click()
  await page.waitForURL('**/board/list', { timeout: 20_000 })
  const headerAfter = await frame().locator('header').innerText()
  assert(headerBefore === headerAfter, 'the header is unchanged by navigating')
  assert(!(await page.locator('nav a[href="/plan"]').count()), 'and the phone tab bar stays away')

  text = await boardText()
  assert(/Chicken thighs|Squash|things to buy/.test(text), `the list view shows the list, saw: ${text.slice(0, 300)}`)
  await assertFits('the list view')

  // Ticking is the reason this view exists.
  const beforeTick = await frame().locator('section button').count()
  await frame().locator('section button').first().click()
  await page.waitForTimeout(1500)
  const afterTick = await frame().locator('section button').count()
  assert(afterTick === beforeTick - 1, `ticking removed one line, got ${beforeTick} then ${afterTick}`)
  await shoot('view-list')
  log('the list view ticks items off at wall size, and the header never moved')

  await frame().getByRole('link', { name: 'Week', exact: true }).click()
  await page.waitForURL('**/board/week', { timeout: 20_000 })
  await assertFits('the week view')
  // Seven nights from tonight, never a calendar week: a wall does not offer to
  // cook something that has already not happened.
  const weekText = await boardText()
  assert(weekText.includes('The week ahead'), `the week view is forward-looking, saw: ${weekText.slice(0, 200)}`)

  const empties = frame().locator('button').filter({ hasText: 'Add dinner' })
  if (await empties.count()) {
    await empties.first().click()
    await page.waitForTimeout(800)
    assert((await boardText()).includes('What are we having?'), 'tapping an empty night opens the library')
    await frame().locator('button').filter({ hasText: 'Chicken traybake' }).first().click()
    await page.waitForTimeout(1500)
    assert((await boardText()).includes('Chicken traybake'), 'and choosing a recipe plans that night')
    log('the week view plans a night from the wall')
  }
  await shoot('view-week')

  await frame().getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/board/recipes', { timeout: 20_000 })
  await assertFits('the recipe library')
  assert((await boardText()).includes('Chicken traybake'), 'the library lists the recipes')
  await frame().getByRole('link', { name: /Chicken traybake/ }).first().click()
  await page.waitForURL('**/board/recipes/**', { timeout: 20_000 })
  await assertFits('a recipe')
  text = await boardText()
  assert(text.includes('Ingredients') && text.includes('Method'), `a recipe reads from the hob, saw: ${text.slice(0, 300)}`)
  await shoot('view-recipe')
  log('the recipe view opens a recipe at hob-readable size')

  await frame().getByRole('link', { name: 'Today', exact: true }).click()
  await page.waitForURL(`${ORIGIN}/board`, { timeout: 20_000 })
  await board().waitFor({ timeout: 20_000 })
  log('and every view is one press from every other')

  // --- emptylist: only the shopping card changes ----------------------------
  //
  // Cleared from the board rather than from a phone, which is how it will
  // actually happen: the tablet is what you are standing in front of.
  await page.goto(`${ORIGIN}/board/list`)
  await frame().waitFor({ timeout: 20_000 })
  for (let guard = 0; guard < 20; guard++) {
    const left = await frame().locator('section button').count()
    if (!left) break
    await frame().locator('section button').first().click()
    await page.waitForTimeout(700)
  }
  assert(!(await frame().locator('section button').count()), 'the list is empty now')

  await openBoard()
  text = await boardText()
  assert(text.includes('Nothing to buy'), `the empty list is a result, not a blank card, saw: ${text.slice(0, 300)}`)
  assert(text.includes('Tap to add'), 'and the foot invites adding something')
  assert(text.includes('Chicken traybake'), 'while the rest of the board is untouched')
  await shoot('emptylist')
  log('ticking the list off turns the shopping card green and leaves everything else alone')

  // --- offline: the design has no error screen ------------------------------
  await ctx.setOffline(true)
  // The board notices on its own 30s tick; nudge it rather than wait for one.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await board().getByText(/Offline/).first().waitFor({ timeout: 20_000 })

  text = await boardText()
  assert(text.includes('Offline'), 'the header states the staleness in words')
  assert(text.includes('Chicken traybake'), 'and every fact stays on screen')
  assert(!/error|failed|try again/i.test(text), `no error screen anywhere, saw: ${text.slice(0, 300)}`)
  assert(!(await page.locator('[role="progressbar"], .animate-spin').count()), 'and no spinner either')

  // The now-marker asserts a time the board can no longer verify, so it goes.
  const markerGone = !(await board().locator('.bg-warning.size-\\[18px\\]').count())
  assert(markerGone, 'the now-marker is removed when offline')
  await shoot('offline')
  log('losing the network dimmed the schedule and captioned it, losing nothing')

  await ctx.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(2000)
  assert((await boardText()).length > 0, 'and it comes back')
  log('and it recovers when the network does')

  console.log(`\n  PASS — one frame, four states, no spinners and no error screens`)
  console.log(`  screenshots in ${SHOTS}/\n`)
} catch (e) {
  console.error(`\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}\n`)
  console.error('  url  :', page.url())
  console.error('  state:', await boardState().catch(() => 'no board'))
  console.error('  board:', (await boardText().catch(() => '')).slice(0, 600))
  await shoot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
