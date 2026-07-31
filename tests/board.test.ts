import { describe, expect, it } from 'vitest'
import {
  buildBoard,
  buildRecipeLibrary,
  LEFTOVER_REHEAT_MINUTES,
  type BoardEvent,
  type BoardInput,
  type BoardNight,
  type BoardPerson,
  type LibraryInput,
  type LibraryLine,
  type LibraryRecipe
} from '../app/utils/board'

// One household, four people, so that every state below is the same family under
// different facts — which is the thing the view model claims to be.
const NAOMI: BoardPerson = {
  id: 'naomi', name: 'Naomi', date_of_birth: '1990-04-02', created_at: '2026-01-01T09:00:00.000Z'
}
const LUKE: BoardPerson = {
  id: 'luke', name: 'Luke', date_of_birth: '1988-11-20', created_at: '2026-01-01T09:00:01.000Z'
}
const SOPHIA: BoardPerson = {
  id: 'sophia', name: 'Sophia', date_of_birth: '2024-11-14', created_at: '2026-01-01T09:00:02.000Z'
}
const ARABELLA: BoardPerson = {
  id: 'arabella', name: 'Arabella', date_of_birth: '2025-10-05', created_at: '2026-01-01T09:00:03.000Z'
}
const PEOPLE = [NAOMI, LUKE, SOPHIA, ARABELLA]
const EVERYONE = PEOPLE.map(person => person.id)

const THURSDAY = '2026-07-30'

/** Local-time instant on the Thursday the design was drawn for. */
function at(time: string, date = THURSDAY): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(year!, month! - 1, day!, hours!, minutes!)
}

function night(date: string, dish: string | null, present = EVERYONE): BoardNight {
  return {
    date,
    presentIds: present,
    meal: dish
      ? {
          entryId: `entry-${date}`,
          recipeId: `recipe-${dish}`,
          dish,
          minutes: 35,
          servings: 4,
          note: 'tray + one pan',
          eatTime: '18:00',
          cookPersonId: 'luke',
          updatedAt: '2026-07-26T18:04:00.000Z'
        }
      : null
  }
}

const WEEK = [
  night(THURSDAY, 'Chicken traybake'),
  night('2026-07-31', 'Lentil ragù'),
  night('2026-08-01', 'Fish pie'),
  night('2026-08-02', 'Roast chicken'),
  night('2026-08-03', 'Leftover soup'),
  night('2026-08-04', 'Pasta al forno'),
  night('2026-08-05', 'Sausage & mash'),
  night('2026-08-06', 'Chilli')
]

function event(
  id: string,
  time: string,
  title: string,
  personId: string | null = null,
  date = THURSDAY
): BoardEvent {
  return {
    id,
    title,
    person_id: personId,
    all_day: false,
    starts_at: at(time, date).toISOString(),
    start_date: date,
    end_date: date
  }
}

const EVENTS = [
  event('hv', '12:30', 'Health visitor', 'arabella'),
  event('pickup', '15:15', 'Nursery pickup', 'sophia'),
  event('choir', '18:30', 'Naomi — choir', 'naomi'),
  event('bins', '20:00', 'Bins out', 'luke'),
  event('school', '08:15', 'School run', 'luke', '2026-07-31')
]

function input(overrides: Partial<BoardInput> = {}): BoardInput {
  return {
    now: at('17:12'),
    nights: WEEK,
    people: PEOPLE,
    constraints: [{ person_id: 'sophia', kind: 'dislike', tag: 'chilli' }],
    events: EVENTS,
    hasCalendar: true,
    toBuy: [
      { entryId: `entry-${THURSDAY}`, name: 'Chicken thighs', qty: '1 kg' },
      { entryId: `entry-${THURSDAY}`, name: 'Feta', qty: null },
      // Another night's, so the hero has to filter rather than take the lot.
      { entryId: 'entry-2026-07-31', name: 'Red lentils', qty: '500 g' }
    ],
    shopping: {
      count: 14,
      everUsed: true
    },
    recipeCount: 6,
    offline: false,
    lastSyncedAt: at('17:11').toISOString(),
    weather: { icon: 'i-lucide-cloud', temperature: 21 },
    ...overrides
  }
}

describe('nominal', () => {
  const board = buildBoard(input())

  it('is about tonight', () => {
    expect(board.state).toBe('nominal')
    expect(board.hero.eyebrow).toBe('Tonight')
    expect(board.hero.hasMeal).toBe(true)
    expect(board.hero.dish).toBe('Chicken traybake')
    expect(board.hero.date).toBe(THURSDAY)
  })

  it('works out when to start cooking from the recipe', () => {
    // Two facts in two places: the badge says when to eat, the footer says when
    // to get up. A single pill carrying both was read as neither.
    expect(board.hero.timing).toBe('18:00')
    expect(board.hero.startBy).toBe('start by 17:25')
    expect(board.hero.dishMeta).toBe('35 min · 4 servings · tray + one pan')
  })

  it('shows only what tonight still needs, and only tonight\'s', () => {
    expect(board.hero.toBuy).toEqual([
      { name: 'Chicken thighs', qty: '1 kg' },
      { name: 'Feta', qty: null }
    ])
  })

  it('names the cook', () => {
    expect(board.hero.cook?.label).toBe('Luke cooks')
    expect(board.hero.cook?.initial).toBe('L')
  })

  it('gives each person the portion their age calls for', () => {
    const notes = Object.fromEntries(board.hero.roster.map(p => [p.id, p.note]))
    // An adult portion is the default and goes unsaid; everything else is the
    // whole reason the roster exists.
    expect(notes.naomi).toBe('')
    expect(notes.sophia).toBe('Toddler portion · no chilli')
    expect(notes.arabella).toBe('Purée')
  })

  it('counts only the people who eat food', () => {
    // Arabella is eight months old: present, weaning, and counted. A newborn
    // would not be.
    expect(board.hero.eatingCount).toBe('Four for dinner')
  })

  it('warns about the person who leaves during the meal', () => {
    const naomi = board.hero.roster.find(p => p.id === 'naomi')
    expect(naomi?.warn).toBe('Out 18:30 — plate up first')
    expect(board.hero.roster.find(p => p.id === 'luke')?.warn).toBeNull()
  })

  it('puts dinner in the schedule and flags the clash', () => {
    const meal = board.schedule.rows.find(r => r.meal)
    expect(meal?.title).toBe('Dinner — Chicken traybake')
    const choir = board.schedule.rows.find(r => r.title === 'Naomi — choir')
    expect(choir?.meta).toBe('Naomi · clashes with dinner')
  })

  it('counts the day\'s events in the card badge, dinner aside', () => {
    expect(board.schedule.empty).toBe(false)
    expect(board.schedule.badge).toBe('4 events')
  })

  it('shows the now marker in the right place', () => {
    expect(board.schedule.nowAt).toBe('17:12')
    // Between the 15:15 pickup and the 18:00 meal.
    expect(board.schedule.rows[board.schedule.nowIndex]?.title).toBe('Dinner — Chicken traybake')
  })

  it('says how long ago the plan was made', () => {
    expect(board.header.plan.generated).toBe(true)
    expect(board.header.plan.label).toMatch(/^Plan generated · \d+ days ago$/)
  })

  it('numbers the week the way everyone else numbers it', () => {
    expect(board.header.weekLabel).toBe('Week 31')
  })

  it('lists the six days after today, none highlighted', () => {
    expect(board.week.map(w => w.dish)).toEqual([
      'Lentil ragù', 'Fish pie', 'Roast chicken', 'Leftover soup', 'Pasta al forno', 'Sausage & mash'
    ])
    expect(board.week.map(w => w.dateLabel)).toEqual(['31', '01', '02', '03', '04', '05'])
    expect(board.week.every(w => w.meta === '35 min')).toBe(true)
    expect(board.week.some(w => w.highlighted)).toBe(false)
  })
})

describe('a leftovers night', () => {
  // What useBoardNights hands over for a night eating an earlier night's
  // cooking: the source's dish, and reheat minutes rather than the recipe's own.
  const reheating = {
    ...night(THURSDAY, 'Leftovers · Roast chicken')!,
    meal: {
      ...night(THURSDAY, 'Leftovers · Roast chicken').meal!,
      minutes: LEFTOVER_REHEAT_MINUTES,
      leftover: true
    }
  }
  const board = buildBoard(input({ nights: [reheating, ...WEEK.slice(1)] }))

  it('says what is being finished off', () => {
    expect(board.hero.dish).toBe('Leftovers · Roast chicken')
  })

  it('gets people up to reheat it, not to cook it', () => {
    expect(board.hero.startBy).toBe('start by 17:45')
    expect(board.hero.dishMeta).toBe('15 min · 4 servings · tray + one pan')
  })
})

describe('noplan', () => {
  const board = buildBoard(input({
    nights: [night(THURSDAY, null), ...WEEK.slice(1).map(n => ({ ...n, meal: null }))]
  }))

  it('offers the one action there is', () => {
    expect(board.state).toBe('noplan')
    expect(board.hero.hasMeal).toBe(false)
    expect(board.hero.noMeal?.title).toBe('No plan for tonight')
    expect(board.hero.noMeal?.action).toEqual({ label: 'Generate this week’s plan', to: null })
  })

  it('says the plan was never generated', () => {
    expect(board.header.plan.generated).toBe(false)
    expect(board.header.plan.label).toBe('Plan not generated')
  })

  it('says "No meal" rather than leaving a gap', () => {
    expect(board.week.every(w => w.empty && w.dish === 'No meal' && w.meta === '')).toBe(true)
  })

  it('has no meal row in the schedule', () => {
    expect(board.schedule.rows.some(r => r.meal)).toBe(false)
  })
})

describe('nobodyhome', () => {
  const board = buildBoard(input({
    nights: [{ ...night(THURSDAY, null), presentIds: [] }, ...WEEK.slice(1)]
  }))

  it('offers nothing, because there is nothing to do', () => {
    expect(board.state).toBe('nobodyhome')
    expect(board.hero.noMeal?.title).toBe('Nobody home for dinner')
    expect(board.hero.noMeal?.action).toBeNull()
  })

  it('strikes everybody through', () => {
    expect(board.hero.roster.every(p => p.absent)).toBe(true)
    expect(board.hero.eatingCount).toBe('Nobody for dinner')
  })

  it('does not warn about a clash for somebody already out', () => {
    expect(board.hero.roster.every(p => p.warn === null)).toBe(true)
  })
})

describe('setup', () => {
  const EMPTY_WEEK = WEEK.map(n => ({ ...n, meal: null, presentIds: [] }))

  const fresh = buildBoard(input({
    nights: EMPTY_WEEK,
    people: [],
    constraints: [],
    events: [],
    hasCalendar: false,
    recipeCount: 0,
    shopping: { count: 0, everUsed: false },
    lastSyncedAt: null,
    offline: true
  }))

  it('does not claim nobody is home when there is nobody at all', () => {
    // An empty roster satisfies "nobody is eating", which is how a brand-new
    // board came to announce that the calendar had everyone out. There was no
    // everyone, and there was no calendar.
    expect(fresh.state).toBe('setup')
    expect(fresh.hero.noMeal?.title).toBe('Nothing set up yet')
    expect(fresh.hero.noMeal?.body).not.toContain('calendar')
  })

  it('points at the step that is actually next, not the generator', () => {
    // The generator skips every night it cannot feed, so sending somebody there
    // with no roster and no library is a button that silently does nothing.
    expect(fresh.hero.noMeal?.action).toEqual({ label: 'Add people', to: '/people' })
  })

  it('asks for recipes once the roster exists', () => {
    const withPeople = buildBoard(input({
      nights: EMPTY_WEEK.map(n => ({ ...n, presentIds: EVERYONE })),
      recipeCount: 0,
      hasCalendar: false
    }))
    expect(withPeople.state).toBe('setup')
    expect(withPeople.hero.noMeal?.action).toEqual({ label: 'Add recipes', to: '/recipes' })
  })

  it('shows what is done and what is left', () => {
    expect(fresh.hero.noMeal?.steps.map(s => s.done)).toEqual([false, false, false])
    // Each step says where it gets done; only the generator is done on the board.
    expect(fresh.hero.noMeal?.steps.map(s => s.to)).toEqual(['/people', '/recipes', null])
    const withPeople = buildBoard(input({
      nights: EMPTY_WEEK.map(n => ({ ...n, presentIds: EVERYONE })),
      recipeCount: 0
    }))
    expect(withPeople.hero.noMeal?.steps.map(s => s.done)).toEqual([true, false, false])
  })

  it('gives way as soon as the household can plan', () => {
    const ready = buildBoard(input({
      nights: EMPTY_WEEK.map(n => ({ ...n, presentIds: EVERYONE })),
      recipeCount: 6
    }))
    expect(ready.state).toBe('noplan')
  })

  it('never hides a meal somebody planned by hand', () => {
    // A library emptied after the fact must not take tonight's dinner off the
    // board — the meal is the whole point of the screen.
    const planned = buildBoard(input({ recipeCount: 0, people: [] }))
    expect(planned.state).not.toBe('setup')
    expect(planned.hero.dish).toBe('Chicken traybake')
  })

  it('does not cry staleness before it has ever held data', () => {
    expect(fresh.header.stale).toBe(false)
    expect(fresh.header.staleLabel).toBeNull()
  })

  it('says the calendar is absent rather than stale', () => {
    expect(fresh.schedule.empty).toBe(true)
    expect(fresh.schedule.badge).toBe('No calendar')
    expect(fresh.schedule.overflow).toBe('')
  })

  it('does not congratulate an untouched shopping list', () => {
    expect(fresh.shopping.resolved).toBe(false)
  })
})

describe('emptylist', () => {
  const board = buildBoard(input({
    shopping: { count: 0, everUsed: true }
  }))

  it('changes only the shopping card', () => {
    expect(board.state).toBe('emptylist')
    expect(board.shopping.empty).toBe(true)
    expect(board.shopping.count).toBe(0)
    // The rest of the board is untouched.
    expect(board.hero.dish).toBe('Chicken traybake')
  })

  it('celebrates a list that was cleared', () => {
    expect(board.shopping.resolved).toBe(true)
    expect(board.shopping.emptyTitle).toBe('Nothing to buy')
  })

  it('does not celebrate a list nobody has ever used', () => {
    // Green is the reward for clearing the list before a shop. Spending it on a
    // household that has never added anything makes it mean less.
    const fresh = buildBoard(input({
      shopping: { count: 0, everUsed: false }
    }))
    expect(fresh.shopping.resolved).toBe(false)
    expect(fresh.shopping.emptyTitle).toBe('Nothing on the list yet')
  })
})

describe('offline', () => {
  const board = buildBoard(input({ offline: true, lastSyncedAt: at('15:58').toISOString() }))

  it('states the staleness rather than hiding it', () => {
    expect(board.state).toBe('offline')
    expect(board.header.stale).toBe(true)
    expect(board.header.staleLabel).toBe('Offline · last synced 15:58')
    expect(board.schedule.badge).toBe('Last known · 15:58')
  })

  it('removes the now marker, because it cannot verify now', () => {
    expect(board.schedule.nowAt).toBeNull()
  })

  it('dims the schedule but keeps every row', () => {
    expect(board.schedule.dim).toBe(true)
    expect(board.schedule.rows.length).toBeGreaterThan(0)
    expect(board.hero.dish).toBe('Chicken traybake')
  })

  it('caveats the overflow line instead of counting', () => {
    expect(board.schedule.overflow).toBe('Events after 15:58 may have changed')
  })

  it('does not call a device stale before it has ever synced', () => {
    // Staleness is drift from something once known to be true. A device with no
    // known-good state behind it is new, not stale, and warning about it on the
    // first paint is crying wolf.
    const fresh = buildBoard(input({ offline: true, lastSyncedAt: null }))
    expect(fresh.header.stale).toBe(false)
    expect(fresh.header.staleLabel).toBeNull()
    expect(fresh.shopping.empty).toBe(false)
  })
})

describe('lateevening', () => {
  const board = buildBoard(input({ now: at('21:40') }))

  it('flips the hero to tomorrow', () => {
    expect(board.state).toBe('lateevening')
    expect(board.hero.eyebrow).toBe('Tomorrow · Friday')
    expect(board.hero.date).toBe('2026-07-31')
    expect(board.hero.dish).toBe('Lentil ragù')
    expect(board.hero.eatingCount).toBe('Four for dinner tomorrow')
    expect(board.hero.cook?.label).toBe('Luke cooks tomorrow')
  })

  it('says tonight is done', () => {
    expect(board.hero.foot).toBe('tonight\'s chicken traybake is done')
  })

  it('highlights tomorrow in the week strip', () => {
    expect(board.week[0]).toMatchObject({ date: '2026-07-31', highlighted: true })
    expect(board.week.filter(w => w.highlighted)).toHaveLength(1)
  })

  it('shows tomorrow morning once today is spent', () => {
    const tomorrowRow = board.schedule.rows.find(r => r.meta.includes('tomorrow'))
    expect(tomorrowRow).toBeDefined()
    expect(board.schedule.rows.filter(r => r.past).length).toBeGreaterThan(0)
  })

  it('marks tonight\'s meal as cooked', () => {
    expect(board.schedule.rows.some(r => r.title === 'Dinner — Chicken traybake · cooked')).toBe(true)
  })

  it('waits until the meal is actually over', () => {
    // Still at the table at 19:00 — an hour past an 18:00 dinner.
    expect(buildBoard(input({ now: at('19:00') })).state).toBe('nominal')
    expect(buildBoard(input({ now: at('19:31') })).state).toBe('lateevening')
  })

  it('falls back to the clock on a night with nothing planned', () => {
    const nights = [{ ...night(THURSDAY, null), presentIds: [] }, ...WEEK.slice(1)]
    expect(buildBoard(input({ now: at('19:00'), nights })).hero.date).toBe(THURSDAY)
    expect(buildBoard(input({ now: at('20:45'), nights })).hero.date).toBe('2026-07-31')
  })
})

describe('the schedule card', () => {
  it('never renders more rows than fit, and counts what it dropped', () => {
    const many = Array.from({ length: 16 }, (_, i) =>
      event(`e${i}`, `${String(8 + i).padStart(2, '0')}:00`, `Event ${i}`))
    const board = buildBoard(input({ events: many }))
    expect(board.schedule.rows.length).toBe(5)
    expect(board.schedule.overflow).toContain('earlier')
    expect(board.schedule.overflow).toContain('later')
  })

  it('spends its whole row budget once the day is behind it', () => {
    // Nothing upcoming, so the window reaches further back rather than showing
    // two rows and a lot of empty card.
    const board = buildBoard(input({ now: at('23:50') }))
    expect(board.schedule.rows).toHaveLength(5)
  })

  it('keeps recent history visible rather than starting at now', () => {
    const board = buildBoard(input())
    expect(board.schedule.rows.filter(r => r.past)).toHaveLength(2)
  })

  it('stays quiet when nothing was left out', () => {
    // "Nothing else today" under a visible 20:00 row would be the board
    // contradicting its own schedule.
    const board = buildBoard(input())
    expect(board.schedule.rows).toHaveLength(5)
    expect(board.schedule.overflow).toBe('')
  })

  it('says so when the day is spent', () => {
    const board = buildBoard(input({ now: at('23:50'), events: EVENTS, nights: WEEK.map(n => ({ ...n, meal: null })) }))
    expect(board.schedule.badge).toBe('4 events')
  })

  it('handles an all-day event without inventing a time for it', () => {
    const allDay: BoardEvent = {
      id: 'holiday',
      title: 'Bank holiday',
      person_id: null,
      all_day: true,
      starts_at: at('00:00').toISOString(),
      start_date: THURSDAY,
      end_date: '2026-07-31'
    }
    const board = buildBoard(input({ events: [allDay] }))
    expect(board.schedule.rows.find(r => r.id === 'holiday')?.time).toBe('All day')
  })

  it('spans an all-day event across the days it covers, exclusive of the last', () => {
    const trip: BoardEvent = {
      id: 'trip',
      title: 'Grandparents',
      person_id: 'sophia',
      all_day: true,
      starts_at: at('00:00').toISOString(),
      start_date: THURSDAY,
      end_date: '2026-08-01'
    }
    expect(buildBoard(input({ events: [trip] })).schedule.rows).toHaveLength(2)
    // On the Saturday it ends, it is over.
    const saturday = buildBoard(input({ now: at('17:12', '2026-08-01'), events: [trip] }))
    expect(saturday.schedule.rows.some(r => r.id === 'trip')).toBe(false)
  })
})

describe('the hero when offline', () => {
  it('says the plan is local rather than pretending it is live', () => {
    const board = buildBoard(input({ offline: true }))
    expect(board.hero.foot).toBe('stored locally')
  })
})

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

function recipe(
  id: string,
  name: string,
  extra: Partial<LibraryRecipe> = {}
): LibraryRecipe {
  return {
    id,
    name,
    image_url: null,
    base_servings: 4,
    prep_minutes: 10,
    cook_minutes: 25,
    ...extra
  }
}

function line(id: string, recipeId: string, name: string, quantity: string | null = null): LibraryLine {
  return { id, recipe_id: recipeId, name, quantity, aisle_id: 'chilled' }
}

const ORZO = recipe('orzo', 'Lemon chicken with orzo', { prep_minutes: 10, cook_minutes: 25 })
const RISOTTO = recipe('risotto', 'Mushroom risotto', { prep_minutes: 5, cook_minutes: 25 })
const PORK = recipe('pork', 'Slow-roast pork tacos', {
  prep_minutes: 20, cook_minutes: 160, base_servings: 6
})
const SALMON = recipe('salmon', 'Miso salmon and greens', {
  prep_minutes: 5, cook_minutes: 20, base_servings: 2
})

const LIBRARY_RECIPES = [ORZO, RISOTTO, PORK, SALMON]

const LIBRARY_LINES = [
  line('orzo-1', 'orzo', 'Chicken thighs', '1 kg'),
  line('orzo-2', 'orzo', 'Feta', '200 g'),
  line('orzo-3', 'orzo', 'Orzo', '500 g'),
  line('risotto-1', 'risotto', 'Chestnut mushrooms', '400 g')
]

function library(over: Partial<LibraryInput> = {}): LibraryInput {
  return {
    recipes: LIBRARY_RECIPES,
    lines: LIBRARY_LINES,
    planEntries: [],
    listItems: [],
    now: at('16:30'),
    query: '',
    facet: 'all',
    sort: 'recent',
    selectedId: null,
    ...over
  }
}

/** Cooked on these dates, all of them before the Thursday the tests sit on. */
const COOKED = [
  { date: '2026-07-26', recipe_id: 'orzo' },
  { date: '2026-07-09', recipe_id: 'orzo' },
  { date: '2026-07-20', recipe_id: 'risotto' },
  // Next Monday. On the plan, but not yet a time it was cooked.
  { date: '2026-08-03', recipe_id: 'salmon' }
]

describe('the recipe library', () => {
  it('counts a recipe as cooked only on nights that have already happened', () => {
    const model = buildRecipeLibrary(library({ planEntries: COOKED }))
    const card = (id: string) => model.cards.find(c => c.id === id)!

    expect(card('orzo').cookedCount).toBe(2)
    expect(card('orzo').meta).toBe('35 min · serves 4 · cooked 2×')
    // Planned for Monday, never actually cooked.
    expect(card('salmon').cookedCount).toBe(0)
    expect(card('salmon').meta).toBe('25 min · serves 2')
  })

  it('badges the recipes on this week, and only this week', () => {
    const model = buildRecipeLibrary(library({
      planEntries: [
        // The Friday of the week the tests sit in.
        { date: '2026-07-31', recipe_id: 'pork' },
        // Five weeks out. A 'FRI' badge for this would be read as tomorrow.
        { date: '2026-09-04', recipe_id: 'risotto' }
      ]
    }))

    expect(model.cards.find(c => c.id === 'pork')?.plannedDay).toBe('FRI')
    expect(model.cards.find(c => c.id === 'risotto')?.plannedDay).toBe(null)
  })

  it('counts each facet against the search, not against the library', () => {
    const all = buildRecipeLibrary(library({ planEntries: COOKED }))
    const count = (model: typeof all, key: string) =>
      model.facets.find(f => f.key === key)!.count

    expect(count(all, 'all')).toBe(4)
    // 35, 30, 180, 25 minutes: the risotto and the salmon.
    expect(count(all, 'quick')).toBe(2)
    // Serves 4, 4, 6, 2.
    expect(count(all, 'batch')).toBe(3)
    expect(count(all, 'never')).toBe(2)

    const searched = buildRecipeLibrary(library({ planEntries: COOKED, query: 'salmon' }))
    expect(count(searched, 'all')).toBe(1)
    expect(count(searched, 'quick')).toBe(1)
    expect(count(searched, 'batch')).toBe(0)
  })

  it('finds a recipe by something in it, not just by its name', () => {
    const model = buildRecipeLibrary(library({ query: 'feta' }))
    expect(model.cards.map(c => c.id)).toEqual(['orzo'])
    expect(model.noMatches).toBe(false)
  })

  it('says so when a search matches nothing, without claiming the library is empty', () => {
    const model = buildRecipeLibrary(library({ query: 'lamb' }))
    expect(model.cards).toHaveLength(0)
    expect(model.noMatches).toBe(true)
    expect(buildRecipeLibrary(library({ recipes: [] })).noMatches).toBe(false)
  })

  it('sorts by when it was last cooked, putting the never-cooked last', () => {
    const model = buildRecipeLibrary(library({ planEntries: COOKED, sort: 'recent' }))
    // Orzo on the 26th, risotto on the 20th, then the two nobody has cooked
    // — alphabetically between themselves.
    expect(model.cards.map(c => c.id)).toEqual(['orzo', 'risotto', 'salmon', 'pork'])
  })

  it('sorts by time, and by how often it gets cooked', () => {
    expect(buildRecipeLibrary(library({ sort: 'quickest' })).cards.map(c => c.id))
      .toEqual(['salmon', 'risotto', 'orzo', 'pork'])

    // The two nobody has cooked tie, and fall back to alphabetical: Miso, Slow-roast.
    expect(buildRecipeLibrary(library({ planEntries: COOKED, sort: 'cooked' })).cards.map(c => c.id))
      .toEqual(['orzo', 'risotto', 'salmon', 'pork'])
  })

  it('cannot call a recipe quick when it never said how long it takes', () => {
    const vague = recipe('vague', 'Something of Nanna’s', {
      prep_minutes: null, cook_minutes: null
    })
    const model = buildRecipeLibrary(library({ recipes: [...LIBRARY_RECIPES, vague], sort: 'quickest' }))

    expect(model.facets.find(f => f.key === 'quick')?.count).toBe(2)
    expect(model.cards.at(-1)?.id).toBe('vague')
    expect(model.cards.find(c => c.id === 'vague')?.meta).toBe('serves 4')
  })

  it('shows what the recipe still needs, counting a ticked item as bought', () => {
    const model = buildRecipeLibrary(library({
      selectedId: 'orzo',
      // ' feta ' rather than 'Feta': the same shopping trip, typed by somebody else.
      listItems: [{ name: ' feta ' }, { name: 'Orzo' }]
    }))

    expect(model.detail?.missing.map(l => l.name)).toEqual(['Chicken thighs'])
    expect(model.detail?.ingredients.map(l => l.onList)).toEqual([false, true, true])
    expect(model.detail?.sendLabel).toBe('Send 1 item to the shopping list')
    expect(model.detail?.missing[0]?.aisleId).toBe('chilled')
  })

  it('offers nothing to send when the list already has all of it', () => {
    const model = buildRecipeLibrary(library({
      selectedId: 'risotto',
      listItems: [{ name: 'Chestnut mushrooms' }]
    }))
    expect(model.detail?.sendLabel).toBe(null)
  })

  it('reads out when it was last cooked, most recent first', () => {
    const model = buildRecipeLibrary(library({ selectedId: 'orzo', planEntries: COOKED }))

    expect(model.detail?.eyebrow).toBe('Library · last cooked 4 days ago')
    expect(model.detail?.meta).toBe('35 min · serves 4 · cooked 2 times')
    expect(model.detail?.history.map(h => h.date)).toEqual(['2026-07-26', '2026-07-09'])
    expect(model.detail?.history[0]?.label).toBe('4 days ago')
    expect(model.detail?.history[1]?.label).toBe('3 weeks ago')
  })

  it('says so plainly when a recipe has never been cooked', () => {
    const model = buildRecipeLibrary(library({ selectedId: 'pork' }))
    expect(model.detail?.eyebrow).toBe('Library · never cooked')
    expect(model.detail?.history).toEqual([])
  })

  it('falls back to the first card when the selection is searched away', () => {
    const model = buildRecipeLibrary(library({ selectedId: 'pork', query: 'risotto' }))

    expect(model.detail?.id).toBe('risotto')
    expect(model.cards[0]?.selected).toBe(true)
    // Nothing to select at all is a pane with nothing in it, not a crash.
    expect(buildRecipeLibrary(library({ recipes: [], lines: [] })).detail).toBe(null)
  })
})

describe('the recipe library and the pantry', () => {
  /** Covers the named lines and nothing else. */
  const covering = (...names: string[]) => (line: LibraryLine) => names.includes(line.name)

  it('has an empty pantry facet when nothing has been recorded', () => {
    const model = buildRecipeLibrary(library())
    expect(model.facets.find(f => f.key === 'pantry')).toMatchObject({ label: 'From the pantry', count: 0 })
    expect(model.cards.every(c => !c.fromPantry)).toBe(true)
  })

  it('marks a recipe whose every ingredient is in the house', () => {
    const model = buildRecipeLibrary(library({
      pantryCovers: covering('Chestnut mushrooms')
    }))
    expect(model.cards.find(c => c.id === 'risotto')?.fromPantry).toBe(true)
    expect(model.cards.find(c => c.id === 'orzo')?.fromPantry).toBe(false)
    expect(model.facets.find(f => f.key === 'pantry')?.count).toBe(1)
  })

  it('needs every line covered, not most of them', () => {
    const model = buildRecipeLibrary(library({
      pantryCovers: covering('Feta', 'Orzo')
    }))
    expect(model.cards.find(c => c.id === 'orzo')?.fromPantry).toBe(false)
  })

  it('never calls a recipe with no ingredients cookable from thin air', () => {
    // Pork and salmon have no lines recorded at all.
    const model = buildRecipeLibrary(library({ pantryCovers: () => true }))
    expect(model.cards.find(c => c.id === 'pork')?.fromPantry).toBe(false)
    expect(model.facets.find(f => f.key === 'pantry')?.count).toBe(2)
  })

  it('filters down to what needs no shopping', () => {
    const model = buildRecipeLibrary(library({
      facet: 'pantry',
      pantryCovers: covering('Chestnut mushrooms')
    }))
    expect(model.cards.map(c => c.id)).toEqual(['risotto'])
  })

  it('stops offering to buy what is already in the cupboard', () => {
    const model = buildRecipeLibrary(library({
      selectedId: 'orzo',
      listItems: [{ name: 'Orzo' }],
      pantryCovers: covering('Feta')
    }))

    expect(model.detail?.missing.map(l => l.name)).toEqual(['Chicken thighs'])
    expect(model.detail?.ingredients.map(l => l.inPantry)).toEqual([false, true, false])
    expect(model.detail?.sendLabel).toBe('Send 1 item to the shopping list')
  })

  it('offers nothing to send when the cupboard covers the lot', () => {
    const model = buildRecipeLibrary(library({
      selectedId: 'risotto',
      pantryCovers: covering('Chestnut mushrooms')
    }))
    expect(model.detail?.sendLabel).toBe(null)
  })
})
