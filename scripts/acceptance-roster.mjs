// The roster, driven end to end in a real browser:
//
//   a child with an allergy -> a night they are not eating -> and it stays said
//
// The parts worth checking are the ones that only look right by accident: a life
// stage that was derived rather than typed, an absence that survives a reload,
// and — the load-bearing one — that saying "Tom is out on Tuesday" writes exactly
// one row and says nothing at all about anybody else. No row means present is the
// contract the generator will read, so a stray row for a person who is home would
// be a bug that hides until Phase 4.
//
// Runs against the production bundle in .output/public. Each run creates its own
// household, so it needs no seed data and can be repeated.
//
//   pnpm supabase start && pnpm generate && pnpm acceptance:roster
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
  body: JSON.stringify({ type: 'magiclink', email: `roster-${Date.now()}@example.com`, redirect_to: ORIGIN })
})).json()

let step = 0
const log = m => console.log(`  ${String(++step).padStart(2)}. ${m}`)
function assert(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`)
}

/**
 * A date of birth that is a toddler whenever this runs, rather than a literal
 * that quietly becomes a child in a year's time.
 */
function yearsAgo(years) {
  const date = new Date()
  date.setFullYear(date.getFullYear() - years)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
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

/** Tom's chip in the night's roll-call, in the state it claims to be in. */
const tomChip = state => page.getByRole('button', { name: `Tom is ${state} — press to change` })

/** Open the first night of the plan, whatever is or is not on it. */
async function openFirstNight() {
  await page.getByRole('link', { name: 'Plan', exact: true }).click()
  await page.waitForURL('**/plan')
  // The phone shows one night at a time now: the night on screen is the first
  // one still open, and its empty state is the way into the editor.
  await page.getByRole('button', { name: 'Add dinner' }).first().click()
  await page.locator('[role="dialog"]').getByText('Who\'s home').waitFor({ timeout: 10_000 })
}

try {
  await page.goto(link.action_link)
  await page.waitForURL('**/welcome', { timeout: 20_000 })
  await page.getByPlaceholder('The Costis').fill('Roster')
  await page.getByPlaceholder('Luke').fill('Luke')
  await page.getByRole('button', { name: 'Create household' }).click()
  await page.waitForURL(`${ORIGIN}/`, { timeout: 20_000 })
  await page.goto(`${ORIGIN}/shopping`)
  await page.getByPlaceholder('Add an item').waitFor({ timeout: 15_000 })
  log('signed in and created a household')

  // --- A child with no login ------------------------------------------------
  await page.goto(`${ORIGIN}/people`)
  await page.locator('main').getByText('Luke').first().waitFor({ timeout: 15_000 })

  await page.getByPlaceholder('Add somebody').fill('Tom')
  await page.locator('main input[type="date"]').fill(yearsAgo(2))
  await page.getByRole('button', { name: 'Add person' }).click()
  await page.locator('main').getByText('Tom').first().waitFor({ timeout: 10_000 })

  const people = (await readTable('people')).filter(p => !p.deleted_at)
  assert(people.length === 2, `the household has two people, got ${people.length}`)
  const tom = people.find(p => p.name === 'Tom')
  assert(tom, 'Tom is in the household')
  assert(tom.auth_user_id === null, 'a child is a row with no login')
  log('added a child with no auth account')

  const listed = await mainText()
  assert(listed.includes('Toddler'), `the stage was derived, not typed, saw: ${listed.slice(0, 200)}`)
  assert(listed.includes('2y'), `the age is shown so a mistyped year is obvious, saw: ${listed.slice(0, 200)}`)
  // Luke has no date of birth at all, and is assumed to be the one cooking.
  assert(listed.includes('Adult'), 'the signed-in adult is still an adult')
  log('the life stage came from the date of birth, with nobody asked')

  // --- An allergy, kept distinguishable from a dislike ---------------------
  await page.locator('main button', { hasText: 'Tom' }).first().click()
  const editor = page.locator('[role="dialog"]')
  await editor.getByPlaceholder('peanuts').fill('peanuts')
  await editor.getByRole('button', { name: 'Add', exact: true }).click()
  await editor.getByText('peanuts').first().waitFor({ timeout: 10_000 })
  await editor.getByRole('button', { name: 'Save' }).click()
  await page.locator('main').getByText('peanuts').first().waitFor({ timeout: 10_000 })

  const constraints = (await readTable('dietary_constraints')).filter(c => !c.deleted_at)
  assert(constraints.length === 1, `one constraint, got ${constraints.length}`)
  assert(constraints[0].kind === 'allergy', `recorded as an allergy, got ${constraints[0].kind}`)
  assert(constraints[0].person_id === tom.id, 'the allergy belongs to Tom')
  log('recorded a peanut allergy as a hard constraint, not a dislike')

  // Removing somebody who is signed in would be removing a member, so the app
  // does not offer it. Tom, who has no login, can be removed.
  await page.locator('main button', { hasText: 'Luke' }).first().click()
  const lukeHasRemove = await editor.getByRole('button', { name: 'Remove' }).count()
  assert(lukeHasRemove === 0, 'a signed-in person cannot be removed: their row is the membership')
  await editor.getByRole('button', { name: 'Save' }).click()
  log('the signed-in adult has no Remove button, because their row is the membership')

  // --- One night off --------------------------------------------------------
  await openFirstNight()
  const emptyRoster = (await readTable('attendance')).length
  assert(emptyRoster === 0, `nobody home is written until somebody says otherwise, got ${emptyRoster}`)
  log('opening a night wrote no attendance rows at all')

  // "Who's home" is a checkbox group, so each person is a checkbox with their
  // name — not a button.
  await page.locator('[role="dialog"]').getByRole('checkbox', { name: 'Tom' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Done' }).click()

  // The phone's roll-call is a row of chips under the night, one per person,
  // each saying what is true about tonight rather than what pressing it does.
  await tomChip('out').waitFor({ timeout: 10_000 })
  log('marked Tom out, and the night says so')

  // The contract the generator will read: exactly one row, for the one person
  // who is not eating. Luke is present and has nothing written about him.
  const roster = (await readTable('attendance')).filter(a => !a.deleted_at)
  assert(roster.length === 1, `exactly one row, for the exception only, got ${roster.length}`)
  assert(roster[0].person_id === tom.id, 'the row is about Tom')
  assert(roster[0].present === false, 'the row records the absence')
  assert(roster[0].meal === 'dinner', `the meal matches the plan entries, got ${roster[0].meal}`)
  log('one row for the one absence, and nothing written about anybody at home')

  // --- And it stays said ----------------------------------------------------
  await page.reload()
  await tomChip('out').waitFor({ timeout: 15_000 })
  log('the absence survived a reload, so it round-tripped through the server')

  // --- Marking somebody back in updates, never deletes ---------------------
  await openFirstNight()
  // "Who's home" is a checkbox group, so each person is a checkbox with their
  // name — not a button.
  await page.locator('[role="dialog"]').getByRole('checkbox', { name: 'Tom' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForTimeout(1000)

  await tomChip('eating in').waitFor({ timeout: 10_000 })
  assert(!(await tomChip('out').count()), 'nobody is away now')
  const flipped = (await readTable('attendance'))
  assert(flipped.length === 1, `the same row was reused, got ${flipped.length}`)
  assert(flipped[0].present === true, 'coming back is the row flipping, not a delete')
  assert(!flipped[0].deleted_at, 'and it is not a soft delete either')
  assert(flipped[0].id === roster[0].id, 'the id is derived from the cell, so it never moves')
  log('marking Tom back in flipped the row rather than deleting it')

  console.log('\n  PASS — a derived stage, a hard allergy, and one row for one absence\n')
} catch (e) {
  console.error(`\n  ${e.message.split('\n').slice(0, 8).join('\n  ')}\n`)
  console.error('  url  :', page.url())
  console.error('  main :', (await mainText().catch(() => '')).slice(0, 400))
  console.error('  people:', JSON.stringify((await readTable('people').catch(() => []))
    .map(r => ({ name: r.name, dob: r.date_of_birth, login: !!r.auth_user_id, deleted: r.deleted_at }))))
  console.error('  attendance:', JSON.stringify((await readTable('attendance').catch(() => []))
    .map(r => ({ person: r.person_id, date: r.date, present: r.present, deleted: r.deleted_at }))))
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
