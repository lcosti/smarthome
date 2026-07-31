import { describe, expect, it } from 'vitest'
import {
  buildBoard,
  type BoardEvent,
  type BoardInput,
  type BoardNight,
  type BoardPerson
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
    shopping: {
      count: 14,
      next: ['Squash — 1 medium', 'Natural yoghurt × 2', 'Chicken thighs — 8'],
      recentAdd: { personId: 'luke', label: 'Nappies', at: at('17:08').toISOString() },
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
    expect(board.hero.timing).toBe('Eat 18:00 · start 17:25')
    expect(board.hero.dishMeta).toBe('35 min · tray + one pan')
  })

  it('names the cook', () => {
    expect(board.hero.cook?.label).toBe('Luke cooks')
    expect(board.hero.cook?.initial).toBe('L')
  })

  it('gives each person the portion their age calls for', () => {
    const notes = Object.fromEntries(board.hero.roster.map(p => [p.id, p.note]))
    expect(notes.naomi).toBe('Adult portion')
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

  it('puts dinner in the schedule and badges the clash', () => {
    const badges = Object.fromEntries(board.schedule.rows.map(r => [r.title, r.badge]))
    expect(badges['Chicken traybake']).toBe('Meal')
    expect(badges['Naomi — choir']).toBe('Clash')
  })

  it('shows the now marker in the right place', () => {
    expect(board.schedule.nowAt).toBe('17:12')
    // Between the 15:15 pickup and the 18:00 meal.
    expect(board.schedule.rows[board.schedule.nowIndex]?.title).toBe('Chicken traybake')
  })

  it('says when the plan was generated', () => {
    expect(board.header.generatedAt).toMatch(/^Plan updated Sunday /)
  })

  it('credits the last person to add something', () => {
    expect(board.shopping.recentAdd?.label).toBe('Luke added Nappies · 4 min ago')
  })

  it('lists the six days after today, none highlighted', () => {
    expect(board.week.map(w => w.dish)).toEqual([
      'Lentil ragù', 'Fish pie', 'Roast chicken', 'Leftover soup', 'Pasta al forno', 'Sausage & mash'
    ])
    expect(board.week.some(w => w.highlighted)).toBe(false)
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
    expect(board.header.generatedAt).toBe('Plan not generated')
  })

  it('em-dashes the week', () => {
    expect(board.week.every(w => w.empty && w.dish === '—')).toBe(true)
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
    shopping: { count: 0, next: [], recentAdd: null, everUsed: false },
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
    expect(fresh.schedule.meta).toBe('No calendar connected')
    expect(fresh.schedule.overflow).toBe('')
  })

  it('does not congratulate an untouched shopping list', () => {
    expect(fresh.shopping.resolved).toBe(false)
    expect(fresh.shopping.foot).toBe('Tap to add')
  })
})

describe('emptylist', () => {
  const board = buildBoard(input({
    shopping: { count: 0, next: [], recentAdd: null, everUsed: true }
  }))

  it('changes only the shopping card', () => {
    expect(board.state).toBe('emptylist')
    expect(board.shopping.empty).toBe(true)
    expect(board.shopping.foot).toBe('Tap to add')
    expect(board.shopping.recentAdd).toBeNull()
    // The rest of the board is untouched.
    expect(board.hero.dish).toBe('Chicken traybake')
  })

  it('suppresses the toast even when something was just added', () => {
    const board = buildBoard(input({
      shopping: {
        count: 0,
        next: [],
        recentAdd: { personId: 'luke', label: 'Nappies', at: at('17:08').toISOString() },
        everUsed: true
      }
    }))
    expect(board.shopping.recentAdd).toBeNull()
  })

  it('celebrates a list that was cleared', () => {
    expect(board.shopping.resolved).toBe(true)
    expect(board.shopping.emptyTitle).toBe('Nothing to buy')
  })

  it('does not celebrate a list nobody has ever used', () => {
    // Green is the reward for clearing the list before a shop. Spending it on a
    // household that has never added anything makes it mean less.
    const fresh = buildBoard(input({
      shopping: { count: 0, next: [], recentAdd: null, everUsed: false }
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
    expect(board.schedule.meta).toBe('Last known · 15:58')
    expect(board.shopping.foot).toBe('Last synced 15:58')
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
    expect(fresh.shopping.foot).toBe('Tap for full list')
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
    expect(board.hero.foot).toBe('Tonight\'s chicken traybake is done')
  })

  it('highlights tomorrow in the week strip', () => {
    expect(board.week[0]).toMatchObject({ date: '2026-07-31', highlighted: true })
    expect(board.week.filter(w => w.highlighted)).toHaveLength(1)
  })

  it('shows tomorrow morning once today is spent', () => {
    const tomorrowRow = board.schedule.rows.find(r => r.badge === 'Tomorrow')
    expect(tomorrowRow).toBeDefined()
    expect(board.schedule.rows.filter(r => r.past).length).toBeGreaterThan(0)
  })

  it('marks tonight\'s meal as cooked', () => {
    expect(board.schedule.rows.some(r => r.title === 'Chicken traybake · cooked')).toBe(true)
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
    expect(board.schedule.meta).toBe('Nothing left today')
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
    expect(board.hero.foot).toBe('Plan is stored locally · tap for the recipe')
  })
})
