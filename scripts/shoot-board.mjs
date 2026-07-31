// Screenshot every view at both shapes: the kitchen tablet and a phone.
//
// A design harness, not an acceptance test: it seeds a household straight into
// Postgres and then only ever looks. `pnpm acceptance:board` is what asserts;
// this is what you open next to the design to see whether they agree.
//
//   pnpm supabase start && pnpm generate && node scripts/shoot-board.mjs
//
// Needs SUPABASE_SECRET_KEY in .env — see .env.example.

import { createServer } from 'node:http'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright'

try {
  process.loadEnvFile('.env')
} catch {
  // CI exports the keys instead and has no .env at all.
}

const PORT = 4003
const ORIGIN = `http://localhost:${PORT}`
const ROOT = '.output/public'
const SHOTS = '.acceptance/board-design'
const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SECRET = process.env.SUPABASE_SECRET_KEY
const FRAME = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }

if (!SECRET) {
  console.error('SUPABASE_SECRET_KEY is not set. Add it to .env.')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8'
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

const headers = {
  'apikey': SECRET,
  'Authorization': `Bearer ${SECRET}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
}

const insert = async (table, rows) => {
  const res = await fetch(`${API}/rest/v1/${table}`, {
    method: 'POST', headers, body: JSON.stringify(rows)
  })
  if (!res.ok) throw new Error(`${table}: ${await res.text()}`)
  return res.json()
}

const email = `design-${Date.now()}@example.com`
const link = await (await fetch(`${API}/auth/v1/admin/generate_link`, {
  method: 'POST', headers, body: JSON.stringify({ type: 'magiclink', email, redirect_to: ORIGIN })
})).json()

const uuid = () => crypto.randomUUID()
const now = new Date()
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function plus(days) {
  const date = new Date(now)
  date.setDate(date.getDate() + days)
  return iso(date)
}

function yearsAgo(years) {
  const date = new Date(now)
  date.setFullYear(date.getFullYear() - years)
  return iso(date)
}

const householdId = uuid()
await insert('households', [{ id: householdId, name: 'Design', invite_code: `DSGN${Date.now() % 100000}` }])

const people = [
  { id: uuid(), name: 'Luke', date_of_birth: yearsAgo(38), auth_user_id: link.id },
  { id: uuid(), name: 'Naomi', date_of_birth: yearsAgo(36), auth_user_id: null },
  { id: uuid(), name: 'Sophia', date_of_birth: yearsAgo(3), auth_user_id: null },
  { id: uuid(), name: 'Arabella', date_of_birth: yearsAgo(1), auth_user_id: null }
].map(p => ({ ...p, household_id: householdId }))
await insert('people', people)
await insert('dietary_constraints', [{
  id: uuid(), household_id: householdId, person_id: people[2].id, kind: 'dislike', tag: 'chilli'
}])

const aisleId = uuid()
await insert('aisles', [{ id: aisleId, household_id: householdId, name: 'Chilled', sort_order: 1 }])

const DISHES = [
  ['Lemon chicken with orzo', 20, 15], ['Slow-roast pork tacos', 25, 150],
  ['Miso salmon, greens', 10, 15], ['Chickpea curry', 10, 20],
  ['Sausage traybake', 10, 30], ['Pasta e fagioli', 10, 10],
  ['Leftovers night', null, null]
]
const recipes = DISHES.map(([name, prep, cook]) => ({
  id: uuid(), household_id: householdId, name, base_servings: 4,
  prep_minutes: prep, cook_minutes: cook, method: null
}))
await insert('recipes', recipes)

// Tonight's dish carries a full method, because cook mode reads things out of
// the prose that three placeholder lines would never exercise: a duration for
// the timer, a range (which resolves to its top), a step that mentions no time
// at all, and an aside in its own paragraph that becomes the tip callout.
const COOK_STEPS = [
  'Brown the chicken thighs skin-side down for 8 mins, until the skin lifts away from the pan on its own.'
  + '\n\nDo not move them before then — the skin releases when it is ready, not when you are.',
  'Turn them, give them 2 mins on the other side, then lift onto a plate.',
  'Soften the onion and garlic in the fat left behind.',
  'Stir in the orzo and toast for 1 min.',
  'Pour in the stock and the juice of a lemon, then settle the chicken back on top.',
  'Cover and cook for 15-18 mins, until the orzo is tender and the chicken is cooked through.'
  + '\n\nCheck it at 15 — orzo goes from right to claggy quickly.',
  'Off the heat, stir through the spinach until it collapses.',
  'Crumble over the feta and rest for 2 mins.',
  'Zest the second lemon over the top and serve.'
]

const PLAIN_STEPS = [
  'Soften the onion in a wide pan.', 'Add everything else.', 'Simmer until it looks right.'
]

await insert('recipe_steps', recipes.flatMap((recipe, index) =>
  (index === 0 ? COOK_STEPS : PLAIN_STEPS).map((body, i) => ({
    id: uuid(), household_id: householdId, recipe_id: recipe.id, body, sort_order: i + 1
  }))
))

// Eleven lines on tonight's dish: enough for the checklist to reach the bottom
// of its card and show whether the count in the footer and the scroll behave.
await insert('recipe_ingredients', [
  ['chicken thighs, bone in', '8'], ['olive oil', '2 tbsp'], ['onion, finely chopped', '1'],
  ['garlic cloves, sliced', '3'], ['orzo', '300g'], ['chicken stock', '700ml'],
  ['lemons', '2'], ['baby spinach', '200g'], ['feta', '200g'],
  ['dried oregano', '1 tsp'], ['black pepper', null]
].map(([name, quantity], index) => ({
  id: uuid(), household_id: householdId, recipe_id: recipes[0].id,
  name, quantity, aisle_id: aisleId, sort_order: index + 1
})))

await insert('attendance', people.flatMap(person =>
  [0, 1, 2, 3, 4, 5, 6].map(offset => ({
    id: uuid(), household_id: householdId, person_id: person.id,
    date: plus(offset), meal: 'dinner', present: true
  }))
))

const entries = recipes.map((recipe, i) => ({
  id: uuid(), household_id: householdId, date: plus(i), meal: 'dinner',
  recipe_id: recipe.id, servings: 4,
  note: i === 0 ? 'one pan' : null,
  eat_time: i === 0 ? '18:30' : null,
  cook_person_id: i === 0 ? people[0].id : null
}))
await insert('meal_plan_entries', entries)

// Two of tonight's ingredients still outstanding, two others already ticked, so
// the Shopping card has both halves and Tonight has something to still buy.
await insert('shopping_list_items', [
  { name: 'Chicken thighs', quantity: '1 kg', checked: false, plan: 0 },
  { name: 'Feta', quantity: '200 g', checked: false, plan: 0 },
  { name: 'Orzo', quantity: '500 g', checked: false, plan: null },
  { name: 'Baby spinach', quantity: '1 bag', checked: false, plan: null },
  { name: 'Lemons', quantity: '3', checked: true, plan: null },
  { name: 'Olive oil', quantity: '1 bottle', checked: true, plan: null }
].map(row => ({
  id: uuid(), household_id: householdId, name: row.name, quantity: row.quantity,
  aisle_id: aisleId, checked: row.checked,
  checked_at: row.checked ? new Date().toISOString() : null,
  source: row.plan === null ? 'adhoc' : 'plan',
  plan_entry_id: row.plan === null ? null : entries[row.plan].id,
  added_by: people[1].id
})))

const eventAt = (h, m) => {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return d
}
await insert('calendar_events', [
  ['08:15', 'School run', 2], ['13:00', 'Lunch with Priya', 1], ['17:00', 'Football pickup', 3]
].map(([time, title, personIndex]) => {
  const [h, m] = time.split(':').map(Number)
  return {
    id: uuid(), household_id: householdId, calendar_id: 'design', external_id: uuid(),
    title, person_id: people[personIndex].id, all_day: false,
    starts_at: eventAt(h, m).toISOString(), ends_at: eventAt(h + 1, m).toISOString(),
    start_date: iso(now), end_date: iso(now)
  }
})).catch(e => console.warn('  (calendar seed skipped:', String(e).slice(0, 120), ')'))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: FRAME })
const page = await ctx.newPage()
page.on('pageerror', e => console.error('  page error:', e.message))
page.on('console', m => m.type() === 'error' && console.error('  console:', m.text().slice(0, 200)))

const shoot = async (name) => {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
  console.log(`  shot ${name}`)
}

try {
  await page.goto(link.action_link)
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
  await page.waitForTimeout(4000)

  const VIEWS = [
    ['today', '/today'],
    ['list', '/'],
    ['week', '/plan'],
    ['recipes', '/recipes'],
    // Cook mode, on the one recipe seeded with a method worth reading.
    ['cook', `/recipes/${recipes[0].id}/cook`]
  ]

  // Both shapes, so the pair can be looked at side by side.
  for (const [label, viewport] of [['', FRAME], ['phone-', PHONE]]) {
    await page.setViewportSize(viewport)
    for (const [name, path] of VIEWS) {
      await page.goto(`${ORIGIN}${path}`)
      await page.waitForTimeout(2500)
      await shoot(`${label}${name}`)
      const wide = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
      if (wide) console.log(`  ${label}${name} OVERFLOWS SIDEWAYS`)
    }
  }

  console.log(`\n  screenshots in ${SHOTS}/\n`)
} catch (e) {
  console.error('  FAILED:', e.message.split('\n')[0])
  console.error('  url   :', page.url())
  await shoot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  server.close()
}
