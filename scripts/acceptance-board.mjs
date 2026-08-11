// The desktop view, driven end to end in a real browser at the size a kitchen
// tablet actually is:
//
//   a planned night -> no plan and the one button -> an empty list -> the wifi drops
//
// The parts worth checking here are the ones a unit test cannot reach: that the
// app's states change because the underlying data changed rather than because a
// prop was set, and — the load-bearing one — that pulling the network out leaves
// every fact on screen and adds an honest caption, instead of producing the
// spinner or error screen the design forbids.
//
// A short pass at phone width runs at the end, because the same routes have to
// answer at both shapes now.
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

// A landscape kitchen tablet: comfortably over the 1024px line where the app
// switches to the desktop layout, and the size the display is actually read at.
const FRAME = { width: 1280, height: 800 }

// And a phone, for the pass at the end.
const PHONE = { width: 390, height: 844 }

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

/**
 * Six o'clock this evening, whenever this runs.
 *
 * The board answers "what's for dinner" until dinner has been and gone and then
 * switches the hero to tomorrow (`lateEvening` in app/utils/board.ts), so a run
 * after about nine reads a different screen from a run at lunchtime — and CI
 * fires on push, at any hour. Starting the clock at six makes "the eyebrow says
 * Tonight" a fact rather than a time of day.
 *
 * `install`, not `setFixedTime`: time still flows from there, so cook mode's
 * timer counts down like a timer. A frozen clock left it sitting at 8:00.
 *
 * Installed after signing in, not here — see `startTheEvening` below. A magic
 * link is a token with an hour on it, and a browser that believes it is six in
 * the evening reads a token minted at nine in the morning as nine hours dead.
 */
const sixPm = new Date()
sixPm.setHours(18, 0, 0, 0)

/**
 * Move the browser to six o'clock, once the session exists.
 *
 * The whole suite used to run on this clock, including the sign-in, and that is
 * a suite that only passes after six: `generate_link` mints a token that expires
 * an hour from *now*, the page opens believing it is this evening, and
 * supabase-js drops a session it reads as long expired ("expires in -28406s")
 * and leaves the app on /login. It fails every morning and passes every night,
 * which is the worst way for a check to be wrong.
 *
 * Nothing before this point cares what time it is — signing in and naming a
 * household are the same at any hour — and everything after it does. The clock
 * lands on the next navigation, so this is called immediately before one.
 */
async function startTheEvening() {
  await ctx.clock.install({ time: sixPm })
}

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

// The frame is everything the app paints, header included, because the header
// carries facts these assertions read. The state attribute belongs to Today,
// which is the only view with content states.
const frame = () => page.locator('body')
const board = () => page.locator('[data-board-state]')
const boardText = async () => (await frame().innerText()).replace(/[\n\t]+/g, ' ')
const boardState = () => board().getAttribute('data-board-state')

/**
 * The rows of the shopping list view, and their ticks.
 *
 * An aisle is a `UCheckboxGroup`: a row is `[data-slot="item"]` and its tick is
 * a `<button role="checkbox">`. Scoped to the aisle card because the filter
 * chips above the list are a checkbox group too — and the recipe editor's
 * ingredient lines are still ordinary `<li>`s.
 */
const listRows = () => page.locator('[data-shopping-aisle] [data-slot="item"]')
const tickBox = row => row.getByRole('checkbox')
const tickedBox = row => row.locator('[role="checkbox"][data-state="checked"]')

async function openBoard() {
  await page.goto(`${ORIGIN}/`)
  await board().waitFor({ timeout: 20_000 })
}

const press = locator => locator.click()

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
  await startTheEvening()
  await page.goto(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household, and it is now six in the evening')

  // --- setup: what a household actually sees the first time ----------------
  //
  // Worth asserting before anything is added, because this state used to be
  // reported as "nobody home for dinner — the calendar has everyone out", which
  // was two untrue statements about a household that had simply just started.
  await openBoard()
  assert(await boardState() === 'setup', `a new household is in setup, got ${await boardState()}`)
  // Settle before reading: the board paints from local state immediately and the
  // first pull lands the person that creating a household created, so the copy
  // moves from "add the people" to "the roster is ready" a beat later. Asserting
  // on the first paint would be asserting on a frame nobody looks at.
  await board().getByText('The roster is ready').waitFor({ timeout: 20_000 })
  let text = await boardText()
  assert(text.includes('Nothing set up yet'), `the hero says so, saw: ${text.slice(0, 300)}`)
  assert(!text.includes('Nobody home'), 'and does not claim nobody is home when there is nobody at all')
  assert(!/calendar has everyone out/.test(text), 'nor blames a calendar it has never read')
  assert(text.includes('No calendar'), 'the schedule says why it is empty')
  assert(text.includes('Connect a calendar'), 'and offers the one thing that would fill it')
  assert(text.includes('Nothing on the list yet'), 'and an untouched list is not celebrated')
  assert(!text.includes('Offline'), 'a device that has never synced is new, not stale')
  await shoot('setup')
  log('a brand-new household gets a truthful board with a checklist')

  // The checklist must point at the step that is genuinely next, and creating a
  // household already creates the person who created it — so a brand-new board
  // wants recipes, not people, and its first row is already ticked. Pointing at
  // the generator instead would be a button that silently does nothing, which is
  // the failure this whole state exists to avoid.
  assert(text.includes('The roster is ready'), `the hero knows step one is done, saw: ${text.slice(0, 300)}`)
  const nextRow = board().locator('a,button').filter({ hasText: 'Put a few recipes in the library' })
  assert(await nextRow.count() === 1, 'the next step is a row you can press, not a label')
  await nextRow.first().click()
  await page.waitForURL('**/recipes', { timeout: 20_000 })
  log('and the checklist row for the next step opens it')

  await page.goto(`${ORIGIN}/people`)
  await page.locator('main').getByText('Luke').first().waitFor({ timeout: 15_000 })
  await page.getByPlaceholder('Add somebody').fill('Tom')
  await page.locator('main input[type="date"]').fill(yearsAgo(2))
  await page.getByRole('button', { name: 'Add person' }).click()
  await page.locator('main').getByText('Tom').first().waitFor({ timeout: 10_000 })
  log('added a toddler, so the roster has two life stages in it')

  // One box does three jobs on this page — narrow, add, or import a pasted link.
  // Typing a plain name and pressing add creates the recipe and opens it.
  // On a phone for this stretch, and not only for flavour: the wide library's
  // one box imports a pasted link and nothing else, so "add a recipe by name"
  // is a phone-shaped action. The board goes back to its frame below.
  await page.setViewportSize(PHONE)
  await page.goto(`${ORIGIN}/recipes`)
  await page.getByTestId('recipe-draft').fill('Chicken traybake')
  // Exact: the photo importer beside it is also an "Add recipe from a photo".
  await page.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await page.waitForURL('**/recipes/**', { timeout: 20_000 })
  log('put one recipe in the library')

  // Filled in from the phone, because that is where recipes get written and
  // because cook mode on the wall has nothing to show without it. The first step
  // carries a duration for the timer to find and an aside in its own paragraph
  // for the tip callout; the last carries a range, which resolves to its top.
  const ingredientBox = page.getByPlaceholder('Add an ingredient')
  for (const [line, quantity] of [['chicken thighs', '8'], ['squash', '1'], ['olive oil', '2 tbsp']]) {
    await ingredientBox.fill(line)
    await ingredientBox.press('Enter')
    await page.locator('main li', { hasText: line }).first().waitFor({ timeout: 10_000 })
    await page.locator('main li button', { hasText: line }).first().click()
    await page.getByLabel('Quantity').fill(quantity)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForTimeout(500)
  }
  for (const body of [
    'Brown the chicken for 8 mins.\n\nDo not crowd the tray or it steams.',
    'Add the squash and toss it in the fat.',
    'Roast for 25-30 mins.'
  ]) {
    await page.getByPlaceholder('Add a step').fill(body)
    await page.getByRole('button', { name: 'Add step' }).click()
    await page.locator('main').getByText(body.split('\n')[0]).first().waitFor({ timeout: 10_000 })
  }
  log('gave it three ingredients and three steps, from the phone')
  await page.setViewportSize(FRAME)

  await page.goto(`${ORIGIN}/shopping`)
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
  assert(text.includes('Plan this week'), 'the one filled action is offered')
  assert((await board().getByText('No meal').count()) >= 6, 'the week strip is six quiet no-meals')
  await shoot('noplan')
  log('with nothing planned Today offers exactly one action')

  // Sideways is still a fault at any width — a column wider than the window is
  // a layout that has gone wrong. Downwards is now simply scrolling.
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  }))
  assert(overflow.scrollW <= overflow.clientW, `nothing overflows sideways: ${JSON.stringify(overflow)}`)

  // --- Following it plans a real week ---------------------------------------
  //
  // The board's one action is a way to the plan now rather than a generator in
  // the hero: filling a week is a decision with a week's worth of consequences,
  // and it belongs on the page that shows the week. The board's job is to say
  // that there is nothing planned and to open the door.
  await board().getByRole('link', { name: /Plan this week/ }).click()
  await page.waitForURL('**/plan', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Fill empty nights' }).click()
  await page.getByText(/nights? planned/).waitFor({ timeout: 20_000 })
  await openBoard()
  await board().getByText('Chicken traybake').first().waitFor({ timeout: 20_000 })

  const entries = (await readTable('meal_plan_entries')).filter(e => !e.deleted_at)
  assert(entries.length > 0, 'pressing the button wrote real plan entries')
  assert(await boardState() === 'nominal', `and the board is nominal now, got ${await boardState()}`)
  log(`the button generated ${entries.length} nights, and the hero picked tonight's up`)

  // --- nominal: the things only the board derives ---------------------------
  text = await boardText()
  assert(text.includes('Tonight'), 'the eyebrow is about tonight')
  // The eat time, not the start time: a recipe typed in as a bare name has no
  // prep or cook minutes, so there is nothing to count back from. The
  // arithmetic itself is covered in tests/board.test.ts.
  assert(/Tonight \d\d:\d\d/.test(text), `the card badges when to eat, saw: ${text.slice(0, 300)}`)
  assert(/\d+ servings?/.test(text), `the dinner says how many it is for, saw: ${text.slice(0, 300)}`)
  assert(text.includes('Start cooking'), 'and cook mode is one press from the wall')
  assert(text.includes('Plan generated'), 'the header now says how long ago the plan was made')
  assert(/Week \d+/.test(text), 'and which week of the year this is')
  await shoot('nominal')
  log('tonight is a dish, a time, a portion count and a way into cooking it')

  // No roster on the board, and no person chips to tap: who is eating is asked
  // and answered on the plan, which is where the week is decided. That move is
  // covered by acceptance-roster.mjs, on the page that now owns it.

  // --- the other three views ------------------------------------------------
  //
  // The header is the one thing that survives a view change, so it is asserted
  // across the move rather than on either side of it.
  const headerBefore = await page.locator('header').first().innerText()
  await frame().getByRole('link', { name: 'List', exact: true }).click()
  await page.waitForURL(`${ORIGIN}/shopping`, { timeout: 20_000 })
  const headerAfter = await page.locator('header').first().innerText()
  assert(headerBefore === headerAfter, 'the header is unchanged by navigating')
  assert(!(await page.locator('[data-tab-bar]').count()),
    'and the phone tab bar stays away at this width')

  text = await boardText()
  assert(/Chicken thighs|Squash|Nappies|Bin bags/.test(text), `the list view shows the list, saw: ${text.slice(0, 300)}`)

  // Ticking is the reason this view exists. A ticked row stays where it was,
  // struck through — where something was is how you check you did not miss it —
  // so what this asserts is the row's own state, not a shorter list.
  // By name, not by position: a ticked row sinks below the ones still to get,
  // so "the first row" is a different row a moment after it is pressed.
  const firstName = (await listRows().first().innerText()).split('\n')[0].trim()
  const beforeTick = await listRows().count()
  await tickBox(listRows().first()).click()
  await tickedBox(listRows().filter({ hasText: firstName }).first())
    .waitFor({ timeout: 10_000 })
  assert(await listRows().count() === beforeTick,
    'and the row stayed on screen rather than vanishing from under the finger')
  await shoot('view-list')
  log('the list ticks items off at desktop width, and the header never moved')

  await frame().getByRole('link', { name: 'Plan', exact: true }).click()
  await page.waitForURL('**/plan', { timeout: 20_000 })
  // Days down, three meals across: the wide layout swapped the component, not
  // just the widths.
  //
  // The days still to come, not seven — a week is read forwards, and what has
  // been cooked collapses into the strip along the top. This asked for seven and
  // so was a check that only passed on a Monday; it went unnoticed because the
  // sign-in above only worked after six in the evening, so nothing downstream of
  // it ran at all.
  const stillToCome = 7 - ((sixPm.getDay() + 6) % 7)
  assert(await page.locator('[data-plan-day]').count() === stillToCome,
    `the wide plan gives each of the ${stillToCome} days still to come a row`)
  for (const meal of ['BREAKFAST', 'LUNCH', 'DINNER']) {
    assert((await boardText()).includes(meal), `and ${meal.toLowerCase()} is a column of its own`)
  }

  // By name rather than by text: an empty cell in the grid is a plus and nothing
  // else — the column heading above it is what says which meal it is — so "Add
  // dinner" is its aria-label.
  const empties = page.locator('[data-plan-day]').getByRole('button', { name: 'Add dinner' })
  if (await empties.count()) {
    await empties.first().click()
    await page.waitForTimeout(800)
    await press(page.getByRole('dialog').getByText('Chicken traybake', { exact: true }).first())
    await page.waitForTimeout(1500)
    assert((await boardText()).includes('Chicken traybake'),
      'tapping an empty night and choosing a recipe plans it')
    log('the wide plan plans a night through the same editor the phone uses')
  }
  await shoot('view-week')

  // --- the library: pick on the left, decide on the right --------------------
  await frame().getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes', { timeout: 20_000 })
  assert((await boardText()).includes('Chicken traybake'), 'the library lists the recipes')

  const cards = () => frame().locator('[data-recipe-card]')
  const detail = () => frame().locator('[data-detail-name]')

  await press(cards().first())
  await page.waitForTimeout(400)
  assert(await detail().innerText() === 'Chicken traybake', 'picking a card fills the pane beside it')
  assert(await page.url().endsWith('/recipes'), 'and nothing navigated — choosing is not leaving')

  text = await boardText()
  // Case-insensitively: an ingredient is shown under the library's own name.
  assert(/chicken thighs/i.test(text), `the pane reads out the ingredients, saw: ${text.slice(0, 400)}`)
  // What the pane says about the shop is a button rather than a sentence now:
  // the dots beside the lines mark what is still to buy, and this is the press
  // that deals with them.
  assert(await frame().getByTestId('recipe-send-list').count() === 1,
    'and offers to put what it needs on the list')

  // Searching reaches into the recipes, not just across their names.
  const search = frame().getByTestId('recipe-search')
  await search.fill('squash')
  await page.waitForTimeout(300)
  assert(await cards().count() === 1, 'searching an ingredient finds the recipe it is in')
  await search.fill('lamb')
  await page.waitForTimeout(300)
  assert(await cards().count() === 0 && /nothing matches/i.test(await boardText()),
    'and a search for something nobody cooks says so rather than emptying the library')
  await search.fill('')
  await page.waitForTimeout(300)
  assert(await cards().count() === 1, 'clearing the search puts the library back')
  await shoot('view-recipes')

  // The one write this view makes: what the recipe needs, onto the list.
  await press(frame().getByTestId('recipe-send-list'))
  await page.waitForTimeout(1500)
  const shopped = (await readTable('items')).filter(i => !i.deleted_at).map(i => i.name.toLowerCase())
  assert(shopped.includes('chicken thighs') && shopped.includes('squash'),
    `sending the missing lines put them on the list, got ${JSON.stringify(shopped)}`)
  await page.waitForTimeout(500)
  assert(!(await frame().getByTestId('recipe-send-list').count()),
    'and having sent them, it stops offering to send them again')
  log('the library picks a recipe, reads it out, and shops for it without leaving')

  // Cook mode is entered from the board rather than from the library: the wall
  // is where somebody stands when they start cooking, and "Start cooking" on
  // tonight's card is the one door to it. The library's own footer offers the
  // recipe page, once.
  await openBoard()
  await press(board().getByRole('button', { name: 'Start cooking' }))
  await page.waitForURL('**/cook', { timeout: 20_000 })

  // --- cook mode: one step at a time, and the header gets out of the way -----
  const cook = () => frame().locator('[data-cook-mode]')
  const atStep = () => cook().getAttribute('data-cook-step')

  assert(await cook().count() === 1, 'opening a recipe opens cook mode')
  assert(!(await frame().getByRole('link', { name: 'Today', exact: true }).count()),
    'and the app header is gone — at the hob you are doing one thing')

  text = await boardText()
  // Case-insensitive: the headings are uppercased in CSS, and innerText
  // reports what is painted rather than what is in the markup.
  assert(/ingredients/i.test(text), `the ingredients stay beside the step, saw: ${text.slice(0, 300)}`)
  assert(text.includes('Brown the chicken'), 'the first step is the one on screen')
  assert(!text.includes('Add the squash'), 'and the second one is not, because it is not next yet')
  assert(text.includes('Do not crowd the tray'), 'the second paragraph became the tip')
  assert(await atStep() === '1/3', `it starts at the first step, got ${await atStep()}`)
  await shoot('view-recipe')

  // The timer is read out of the prose. Nothing about the step says "8 minutes"
  // in a column anywhere — "for 8 mins" is the whole source.
  // Named after the verb, not the noun in front of the number: "brown the
  // chicken for 8 mins" is a Brown, and naming it Chicken is the obvious wrong
  // answer that tests/cook.test.ts pins down.
  const timer = cook().locator('button', { hasText: 'Start brown 8 min' })
  assert(await timer.count() === 1, 'the duration in the prose became a timer, named after what it times')
  await timer.click()
  await page.waitForTimeout(1500)
  const running = await boardText()
  assert(!running.includes('Start brown 8 min'), 'tapping it starts it')
  // Whitespace stripped: the clock is a digit per element, so innerText reads
  // it as "7 : 5 9".
  assert(/7:5\d/.test(running.replace(/\s+/g, '')),
    `and it counts down in seconds, saw: ${running.slice(0, 300)}`)
  log('cook mode found a timer in the prose, named it and started it')

  // Ticking ingredients off is session state — nothing about tonight's cooking
  // belongs to the recipe, so none of this is written anywhere.
  const rows = cook().locator('ul button')
  await rows.nth(0).click()
  await rows.nth(1).click()
  await page.waitForTimeout(400)
  assert((await boardText()).includes('2 / 3'), 'the checklist counts what is out of the fridge')

  await frame().getByRole('button', { name: 'Next step' }).click()
  await page.waitForTimeout(300)
  assert(await atStep() === '2/3', `Next moves one step, got ${await atStep()}`)
  assert((await boardText()).includes('Add the squash'), 'and shows that step')

  // The pan is still on the heat two steps later, which is the entire reason
  // that step's segment of the bar opens out into its timer instead of the
  // timer scrolling away with the step that set it.
  const pin = frame().locator('[data-cook-pinned]')
  assert(await pin.count() === 1, 'the running timer opened out of the step bar')
  const pinText = await pin.innerText()
  // Whitespace stripped for the clock, which is a digit per element.
  assert(/Brown/.test(pinText) && /\d:\d\d/.test(pinText.replace(/\s+/g, '')),
    `named and still counting, saw: ${pinText}`)

  await pin.click()
  await page.waitForTimeout(300)
  assert(await atStep() === '1/3', `and pressing it goes back to the pan, got ${await atStep()}`)
  assert(!(await frame().locator('[data-cook-pinned]').count()),
    'where the segment closes again, because the timer is on screen at full size')
  log('a running timer opens out of the step bar and leads you back to it')

  await frame().getByRole('button', { name: 'Next step' }).click()
  await page.waitForTimeout(300)
  await frame().getByRole('button', { name: 'Next step' }).click()
  await page.waitForTimeout(300)
  assert(await atStep() === '3/3', `to the last one, got ${await atStep()}`)
  assert(await frame().getByRole('link', { name: 'Finish' }).count() === 1,
    'where Next becomes Finish, because there is nothing after the last step')
  await shoot('view-recipe-last')

  await frame().getByRole('button', { name: 'Previous' }).click()
  await page.waitForTimeout(300)
  assert(await atStep() === '2/3', `and Previous goes back, got ${await atStep()}`)
  log('the method walks one step at a time, forwards and back')

  await frame().getByRole('link', { name: 'Exit' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await board().waitFor({ timeout: 20_000 })
  log('and leaving it puts the whole app back')

  await frame().getByRole('link', { name: 'Recipes', exact: true }).click()
  await page.waitForURL('**/recipes', { timeout: 20_000 })

  await frame().getByRole('link', { name: 'Today', exact: true }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await board().waitFor({ timeout: 20_000 })
  log('and every view is one press from every other')

  // --- the shopping card is the list, not a summary of it -------------------
  //
  // Ticked from the Today card rather than from a phone or the list view, which
  // is how it will actually happen: the tablet is what you are standing in
  // front of while you unpack a bag.
  await openBoard()
  const shoppingCard = board().locator('[data-board-card="shopping"]')
  assert(/SHOPPING \d+ items?/i.test(await boardText()),
    'the card says how much is on the list')

  const rowsBefore = await shoppingCard.locator('button').count()
  // One more than were ticked already: the list view above ticked one of its
  // own, and it is still ticked, because that is what ticking does.
  const tickedBefore = (await readTable('items')).filter(i => i.checked && !i.deleted_at).length
  await shoppingCard.locator('button').first().click()
  await page.waitForTimeout(1200)
  const ticked = (await readTable('items')).filter(i => i.checked && !i.deleted_at)
  assert(ticked.length === tickedBefore + 1,
    `ticking a row from Today wrote it through, got ${ticked.length} after ${tickedBefore}`)
  assert(await shoppingCard.locator('button').count() === rowsBefore,
    'and the row stayed on screen, struck through rather than vanishing')

  await press(board().getByRole('button', { name: 'Clear done' }))
  await page.waitForTimeout(1200)
  assert((await readTable('items')).some(i => i.checked && i.deleted_at),
    'and Clear done removed it')
  log('the Today card ticks items off and clears them without leaving the page')

  // --- emptylist: only the shopping card changes ----------------------------
  await page.goto(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 20_000 })
  // Ticking no longer takes a row off the screen, so this walks the rows that
  // are still unticked and then clears the lot in one press — which is what
  // somebody unpacking the bags does anyway.
  const untickedRows = () =>
    listRows().filter({ has: page.locator('[role="checkbox"][data-state="unchecked"]') })
  for (let guard = 0; guard < 20; guard++) {
    if (!(await untickedRows().count())) break
    await tickBox(untickedRows().first()).click()
    await page.waitForTimeout(700)
  }
  await press(page.getByRole('button', { name: 'Clear checked' }))
  await page.getByText('Nothing on the list').waitFor({ timeout: 10_000 })
  assert(!(await listRows().count()), 'the list is empty now')

  await openBoard()
  text = await boardText()
  assert(text.includes('Nothing to buy'), `the empty list is a result, not a blank card, saw: ${text.slice(0, 300)}`)
  assert(text.includes('Chicken traybake'), 'while the rest of the board is untouched')
  await shoot('emptylist')
  log('ticking the list off turns the shopping card green and leaves everything else alone')

  // --- offline: the design has no error screen ------------------------------
  await ctx.setOffline(true)
  // The board notices on its own 30s tick; nudge it rather than wait for one.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  // In the header, not the board: staleness is a fact about the device, and it
  // is said once, beside the day.
  await frame().getByText(/Offline/).first().waitFor({ timeout: 20_000 })

  text = await boardText()
  assert(text.includes('Offline'), 'the header states the staleness in words')
  assert(text.includes('Chicken traybake'), 'and every fact stays on screen')
  assert(!/error|failed|try again/i.test(text), `no error screen anywhere, saw: ${text.slice(0, 300)}`)
  assert(!(await page.locator('[role="progressbar"], .animate-spin').count()), 'and no spinner either')

  // The now-marker asserts a time the board can no longer verify, so it goes.
  const markerGone = !(await board().locator('.bg-primary\\/70').count())
  assert(markerGone, 'the now-marker is removed when offline')
  await shoot('offline')
  log('losing the network dimmed the schedule and captioned it, losing nothing')

  await ctx.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await page.waitForTimeout(2000)
  assert((await boardText()).length > 0, 'and it comes back')
  log('and it recovers when the network does')

  // --- the same routes at phone width ---------------------------------------
  //
  // Not a second copy of the run above: the point is only that the narrow shape
  // is the other layout of the same pages, on the same data, with the tab bar
  // instead of the header.
  await page.setViewportSize(PHONE)
  await openBoard()
  assert(await page.locator('[data-tab-bar]').count() === 1,
    'at phone width the tab bar is back')
  assert(!(await page.getByRole('link', { name: 'Today', exact: true }).and(page.locator('header a')).count()),
    'and the desktop header is gone')
  text = await boardText()
  assert(text.includes('Chicken traybake'), `Today is the same page on a phone, saw: ${text.slice(0, 300)}`)

  const narrow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  }))
  assert(narrow.scrollW <= narrow.clientW + 1, `and nothing overflows sideways: ${JSON.stringify(narrow)}`)
  await shoot('phone-today')

  await page.goto(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 20_000 })
  await shoot('phone-list')
  log('the same routes answer at 390x844 with the tab bar instead of the header')

  console.log(`\n  PASS — two shapes, four states, no spinners and no error screens`)
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
