// Slice docs/rebuild-prompt.md into pastable bundles under docs/prompts/.
//
// The master document is one thing to read and too big to paste into most
// no-code tools' prompt boxes. This cuts it along its own section headings into
// eight steps, each small enough to paste and each carrying the standing brief
// by reference rather than by copy — so there is still exactly one place a fact
// about this app is written down.
//
//   node scripts/split-rebuild-prompt.mjs
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'

const SRC = new URL('../docs/rebuild-prompt.md', import.meta.url)
const OUT = new URL('../docs/prompts/', import.meta.url)

const source = await readFile(SRC, 'utf8')

/**
 * Every `## ` and `### ` heading, with the body that follows it. Sliced on `##`
 * so a bundle can ask for a whole numbered section, and indexed on `###` too so
 * it can ask for one screen out of section 6.
 */
function index(text) {
  const lines = text.split('\n')
  const sections = new Map()
  let current = null
  let fenced = false

  for (const line of lines) {
    // Headings inside a fenced block are SQL comments, not structure.
    if (line.startsWith('```')) fenced = !fenced

    const level = !fenced && /^#{2,3} /.test(line) ? line.match(/^#+/)[0].length : 0
    if (level) {
      const heading = line.replace(/^#{2,3} /, '')
      // `## 4. Data model` puts a period after its number; `### 6.4 /shopping`
      // does not, so accept either. An UNNUMBERED heading is ordinary content —
      // `### Colour` under the design system belongs to it, and treating it as a
      // boundary silently truncated every section that had one.
      const key = heading.match(/^(\d+[a-z]?(?:\.\d+)?)[.\s]/)?.[1]
      if (key) {
        current = { key, lines: [line] }
        sections.set(key, current)
        continue
      }
      if (level === 2) { current = null; continue }
    }
    if (current) current.lines.push(line)
  }

  for (const s of sections.values()) s.text = s.lines.join('\n').trimEnd()
  return sections
}

const sections = index(source)

/**
 * A section and every numbered subsection under it, in document order.
 *
 * A numbered `###` closes its parent's own text, so asking for section 8 has to
 * pick up 8.1 to 8.6 as well or it returns nothing but the introduction.
 */
function take(keys) {
  const wanted = []
  for (const key of keys) {
    const family = [...sections.keys()].filter(k => k === key || k.startsWith(key + '.'))
    if (!family.length) throw new Error(`section ${key} not found in rebuild-prompt.md`)
    wanted.push(...family)
  }
  return [...new Set(wanted)].map(k => sections.get(k).text).join('\n\n')
}

const PREAMBLE = `> **Standing context.** Steps 1 to 8 build one application. Give the tool
> \`00-standing-brief.md\` first — that is what this app is, how it looks and what
> its routes are — and keep it in the tool's project knowledge or system prompt if
> it has one. Each step below assumes it.
>
> Attach the screenshots named in each step. They settle in one look what a
> paragraph of layout prose only approximates.

`

const BUNDLES = [
  {
    file: '00-standing-brief.md',
    title: 'Standing brief — read this first',
    shots: [],
    lead: `This is the brief for an application built over eight steps. Read it, ask
nothing yet, and build nothing yet. Every step that follows assumes it.`,
    // The build order and the acceptance tests belong here rather than in a step:
    // every step below finishes by naming one of those tests.
    keys: ['1', '2', '2b', '3', '9', '10', '11'],
    appendix: true
  },
  {
    file: '01-data-and-offline.md',
    title: 'Step 1 — the data model and the offline layer',
    shots: [],
    lead: `Build only the data model and the sync layer. No screens beyond whatever you
need to prove it works. Finish by demonstrating acceptance test 1.

If your platform cannot keep a copy of the data on the device, say so, then build
§5b in place of §5 — it is at the end of this file.`,
    keys: ['4', '5', '5b']
  },
  {
    file: '01b-no-device-storage.md',
    title: 'Step 1b — the fallback, if the platform cannot store data on the device',
    shots: [],
    lead: `Send this **only** if the tool has told you it cannot keep a copy of the data on
the device. It replaces §5 and changes nothing else. Everything in steps 2 to 8
still applies exactly as written.`,
    keys: ['5b']
  },
  {
    file: '02-shopping-list.md',
    title: 'Step 2 — the shopping list',
    shots: ['wide-shopping.png', 'phone-shopping.png', 'phone-settings.png'],
    lead: `Build the shopping list and the aisle settings, and nothing else. This is the
screen used daily and the one that has to beat typing into a group chat. It must
open offline.`,
    keys: ['6.4', '6.12']
  },
  {
    file: '03-recipes-and-plan.md',
    title: 'Step 3 — the recipe library, the plan, and deriving the list',
    shots: ['wide-recipes.png', 'phone-recipes.png', 'wide-recipe-detail.png', 'wide-plan.png', 'phone-plan.png'],
    lead: `Build the recipe library, the recipe editor, the weekly plan, and the
derivation that turns a planned week into shopping list rows. Finish by
demonstrating acceptance test 3.`,
    keys: ['6.5', '6.6', '6.7', '7.5']
  },
  {
    file: '04-ingredients.md',
    title: 'Step 4 — canonical ingredients and aggregation',
    shots: ['phone-ingredients.png', 'wide-shopping.png'],
    lead: `Make two recipes wanting the same thing become one line on the list. Finish by
demonstrating acceptance test 4.`,
    keys: ['7.3', '7.4', '7.6', '7.7', '6.10']
  },
  {
    file: '05-people-and-roster.md',
    title: 'Step 5 — people, life stages and who is eating',
    shots: ['phone-people.png'],
    lead: `Build the roster. Finish by demonstrating acceptance test 5 — whose
load-bearing assertion is about a row that does not exist.`,
    keys: ['6.9', '7.1', '7.2']
  },
  {
    file: '06-generator.md',
    title: 'Step 6 — the weekly generator',
    shots: ['wide-plan.png'],
    lead: `Build the generator and wire it to the fill button on the plan. Finish by
demonstrating acceptance test 6.`,
    keys: ['7.8']
  },
  {
    file: '07-import.md',
    title: 'Step 7 — recipe import and the other server-side work',
    shots: ['phone-recipes.png'],
    lead: `Build the server-side functions. Finish by demonstrating acceptance test 7.`,
    keys: ['8']
  },
  {
    file: '08-today-and-cook.md',
    title: 'Step 8 — Today, cook mode, chores, pantry',
    shots: ['wide-today.png', 'phone-today.png', 'wide-cook.png', 'phone-cook.png', 'phone-pantry.png'],
    lead: `Build the kitchen board and everything left. Finish by demonstrating
acceptance test 8.`,
    keys: ['6.3', '6.8', '7.9', '6.11', '7.10']
  }
]

// Clear the generated bundles, one by one — never the whole folder. README.md
// lives here and is written by hand, and a `rm -rf` on the directory took it
// with it the first time.
await mkdir(OUT, { recursive: true })
for (const { file } of BUNDLES) await rm(new URL(file, OUT), { force: true })

const written = []
for (const bundle of BUNDLES) {
  // Appendix A is unnumbered, so it is sliced by its heading rather than indexed.
  const appendix = bundle.appendix
    ? '\n\n' + source.slice(source.indexOf('## Appendix A'), source.indexOf('## Appendix B')).trimEnd()
    : ''
  const body = take(bundle.keys) + appendix
  const shots = bundle.shots.length
    ? `**Screenshots to attach:** ${bundle.shots.map(s => `\`docs/screenshots/${s}\``).join(', ')}\n\n`
    : ''
  const text = `# ${bundle.title}\n\n${PREAMBLE}${bundle.lead}\n\n${shots}---\n\n${body}\n`
  await writeFile(new URL(bundle.file, OUT), text)
  written.push({ file: bundle.file, words: text.split(/\s+/).length })
}

console.table(written)
