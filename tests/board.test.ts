import { describe, expect, it } from 'vitest'
import {
  buildBoard,
  buildRecipeLibrary,
  LEFTOVER_REHEAT_MINUTES,
  type BoardChore,
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
    events: EVENTS,
    hasCalendar: true,
    chores: [],
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
    // Two facts in two places: the badge says when to eat, the aside under the
    // buttons says when to get up. One pill carrying both was read as neither.
    expect(board.hero.timing).toBe('18:00')
    expect(board.hero.startBy).toBe('start by 17:25')
    expect(board.hero.minutes).toBe(35)
    expect(board.hero.servings).toBe('4 servings')
  })

  it('names the cook', () => {
    expect(board.hero.cook?.label).toBe('Luke cooks')
    expect(board.hero.cook?.initial).toBe('L')
  })

  it('puts dinner in the day, as an appointment among the others', () => {
    const meal = board.schedule.rows.find(r => r.meal)
    expect(meal?.title).toBe('Dinner — Chicken traybake')
    expect(board.schedule.rows.find(r => r.title === 'Naomi — choir')?.meta).toBe('Naomi')
  })

  it('counts the day\'s events in the card badge, dinner aside', () => {
    expect(board.schedule.empty).toBe(false)
    expect(board.schedule.badge).toBe('4 events')
  })

  it('puts the now marker at the minute it is', () => {
    expect(board.schedule.nowAt).toBe('17:12')
    // The grid opens at 08:00 and runs thirteen hours, so 17:12 is nine hours
    // and twelve minutes into it — expressed as a fraction of the whole, so the
    // card can draw the day at whatever height it has been given.
    expect(board.schedule.nowTop).toBeCloseTo((9 + 12 / 60) / 13)
    // Between the 15:15 pickup and the 18:00 meal, on the same scale.
    const pickup = board.schedule.rows.find(r => r.title === 'Nursery pickup')!
    const meal = board.schedule.rows.find(r => r.meal)!
    expect(pickup.top).toBeLessThan(board.schedule.nowTop)
    expect(meal.top).toBeGreaterThan(board.schedule.nowTop)
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

  it('names what else each night is spoken for by', () => {
    // The calendar is why a night gets moved, so the strip that plans the week
    // says so rather than making somebody check two screens against each other.
    expect(board.week[0]?.events).toEqual([
      { id: 'school', title: 'School run', hue: expect.any(Number) }
    ])
    expect(board.week[1]?.events).toEqual([])
  })

  it('stops at two events a night, being a sixth of a strip', () => {
    const friday = '2026-07-31'
    const busy = Array.from({ length: 5 }, (_, i) =>
      event(`f${i}`, `0${8 + i}:00`, `Thing ${i}`, null, friday))
    const board = buildBoard(input({ events: busy }))
    expect(board.week[0]?.events).toHaveLength(2)
  })

  it('carries a trip across every day it covers', () => {
    const trip: BoardEvent = {
      id: 'trip',
      title: 'Grandparents',
      person_id: 'sophia',
      all_day: true,
      starts_at: at('00:00').toISOString(),
      start_date: '2026-07-31',
      end_date: '2026-08-02'
    }
    const week = buildBoard(input({ events: [trip] })).week
    expect(week.filter(slot => slot.events.some(e => e.id === 'trip')).map(s => s.date))
      .toEqual(['2026-07-31', '2026-08-01'])
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
    expect(board.hero.minutes).toBe(LEFTOVER_REHEAT_MINUTES)
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
    expect(board.hero.noMeal?.action).toEqual({ label: 'Plan this week', to: '/plan' })
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
})

describe('setup', () => {
  const EMPTY_WEEK = WEEK.map(n => ({ ...n, meal: null, presentIds: [] }))

  const fresh = buildBoard(input({
    nights: EMPTY_WEEK,
    people: [],
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
    // Each step says where it gets done — the board points at a page every time.
    expect(fresh.hero.noMeal?.steps.map(s => s.to)).toEqual(['/people', '/recipes', '/plan'])
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

  it('takes the now marker down rather than letting it go stale', () => {
    // A board that cannot reach the server has no business drawing a line across
    // the day and calling it this moment.
    expect(board.schedule.nowAt).toBeNull()
    // The offset stays, because where to scroll is arithmetic on this device's
    // own clock rather than a claim about how fresh the data is.
    expect(board.schedule.nowTop).toBeGreaterThan(0)
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
    expect(board.hero.cook?.label).toBe('Luke cooks tomorrow')
  })

  it('highlights tomorrow in the week strip', () => {
    expect(board.week[0]).toMatchObject({ date: '2026-07-31', highlighted: true })
    expect(board.week.filter(w => w.highlighted)).toHaveLength(1)
  })

  it('shows tomorrow morning once today is spent', () => {
    // Above the grid, because it is not a point on today's clock face.
    const tomorrowRow = board.schedule.allDay.find(r => r.meta.includes('tomorrow'))
    expect(tomorrowRow?.title).toBe('School run')
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
  it('shows the whole day rather than a window onto it', () => {
    // The old card fitted five rows and counted the rest. A grid has room for
    // the day itself, so nothing is dropped and nothing has to be apologised for.
    const many = Array.from({ length: 12 }, (_, i) =>
      event(`e${i}`, `${String(8 + i).padStart(2, '0')}:00`, `Event ${i}`))
    const board = buildBoard(input({ events: many }))
    expect(board.schedule.rows).toHaveLength(13)
  })

  it('rules the grid by the hour, from eight to nine by default', () => {
    const board = buildBoard(input())
    expect(board.schedule.hours[0]).toEqual({ label: '08:00', top: 0 })
    expect(board.schedule.hours.at(-1)).toEqual({ label: '21:00', top: 1 })
    // The floor below which it stops stretching and starts scrolling.
    expect(board.schedule.height).toBe(13 * 48)
  })

  it('places each row at its own minute', () => {
    const board = buildBoard(input())
    const rows = Object.fromEntries(board.schedule.rows.map(r => [r.title, r.top]))
    // 12:30 is four and a half hours after the 08:00 the grid opens at, of the
    // thirteen it covers.
    expect(rows['Health visitor']).toBeCloseTo(4.5 / 13)
    expect(rows['Nursery pickup']).toBeCloseTo((7 + 15 / 60) / 13)
  })

  it('stretches to reach anything outside the working day', () => {
    const early = buildBoard(input({
      now: at('06:20'),
      events: [event('gym', '06:00', 'Swimming')]
    }))
    // Six in the morning through nine at night: sixteen hour lines, and the
    // swim sits on the very first of them.
    expect(early.schedule.hours).toHaveLength(16)
    expect(early.schedule.hours.at(-1)?.label).toBe('21:00')
    expect(early.schedule.rows[0]?.top).toBe(0)
  })

  it('lets an event speak for the hour it lands on', () => {
    // Two clocks printed in the same place is mush, and the event's own time is
    // the more useful of the two.
    const board = buildBoard(input({
      offline: true,
      nights: WEEK.map(n => ({ ...n, meal: null })),
      events: [event('market', '09:30', 'Farmers market')]
    }))
    const labels = board.schedule.hours.map(h => h.label)
    // A row's time is level with the first line of its title, so it crowds the
    // hour below it and clears the one above.
    expect(labels).toContain('09:00')
    expect(labels).not.toContain('10:00')
    expect(labels).toContain('11:00')
    // The rules themselves all stay, so the grid is still ruled by the hour.
    expect(board.schedule.hours).toHaveLength(14)
  })

  it('nudges rows apart rather than printing them on top of each other', () => {
    // Three things twenty minutes apart are sixteen pixels apart on a true
    // scale, which is not enough for a title and a name underneath it.
    const board = buildBoard(input({
      nights: WEEK.map(n => ({ ...n, meal: null })),
      events: [
        event('a', '10:00', 'One'),
        event('b', '10:20', 'Two'),
        event('c', '10:40', 'Three')
      ]
    }))
    const tops = board.schedule.rows.map(r => r.top)
    expect(tops[0]).toBeCloseTo(2 / 13)
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i]! - tops[i - 1]!).toBeGreaterThanOrEqual(44 / (13 * 48) - 1e-9)
    }
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
    // Above the grid rather than in it: giving it an hour would mean inventing
    // one and then drawing the invention to scale.
    expect(board.schedule.rows.some(r => r.id === 'holiday')).toBe(false)
    expect(board.schedule.allDay.find(r => r.id === 'holiday')?.time).toBe('All day')
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
    expect(buildBoard(input({ events: [trip] })).schedule.allDay).toHaveLength(1)
    const friday = buildBoard(input({ now: at('17:12', '2026-07-31'), events: [trip] }))
    expect(friday.schedule.allDay.some(r => r.id === 'trip')).toBe(true)
    // On the Saturday it ends, it is over.
    const saturday = buildBoard(input({ now: at('17:12', '2026-08-01'), events: [trip] }))
    expect(saturday.schedule.allDay.some(r => r.id === 'trip')).toBe(false)
  })
})

describe('chores on the schedule', () => {
  function boardChore(overrides: Partial<BoardChore> & { choreId: string }): BoardChore {
    return {
      completionId: `done-${overrides.choreId}`,
      date: THURSDAY,
      title: overrides.choreId,
      person_id: null,
      time: null,
      done: false,
      ...overrides
    }
  }

  it('slots a timed chore into the day at its time', () => {
    const board = buildBoard(input({
      chores: [boardChore({ choreId: 'recycling', title: 'Recycling out', time: '16:00' })]
    }))
    const titles = board.schedule.rows.map(r => r.title)
    expect(titles).toContain('Recycling out')
    expect(titles.indexOf('Recycling out')).toBeLessThan(titles.indexOf('Naomi — choir'))
    expect(titles.indexOf('Nursery pickup')).toBeLessThan(titles.indexOf('Recycling out'))
  })

  it('pins an untimed chore above everything with a clock on it', () => {
    const allDay: BoardEvent = {
      id: 'holiday',
      title: 'Bank holiday',
      person_id: null,
      all_day: true,
      starts_at: at('00:00').toISOString(),
      start_date: THURSDAY,
      end_date: '2026-07-31'
    }
    const board = buildBoard(input({
      events: [allDay, event('hv', '12:30', 'Health visitor')],
      chores: [boardChore({ choreId: 'plants', title: 'Water the plants' })],
      nights: WEEK.map(n => ({ ...n, meal: null }))
    }))
    // A chore with no time belongs above the grid beside the all-day events,
    // for the same reason they do: it has no hour to be drawn at.
    expect(board.schedule.allDay.map(r => r.title))
      .toEqual(['Bank holiday', 'Water the plants'])
    expect(board.schedule.allDay[1]?.time).toBe('Today')
    expect(board.schedule.rows.map(r => r.title)).toEqual(['Health visitor'])
  })

  it('carries whose it is, and says it is a chore', () => {
    const board = buildBoard(input({
      chores: [boardChore({ choreId: 'bins', title: 'Bins out', person_id: 'luke', time: '16:00' })]
    }))
    const row = board.schedule.rows.find(r => r.title === 'Bins out')
    expect(row?.meta).toBe('Luke · chore')
    expect(row?.chore).toEqual({ choreId: 'bins', date: THURSDAY, done: false })
  })

  it('says nothing about whose it is when it belongs to the house', () => {
    const board = buildBoard(input({
      chores: [boardChore({ choreId: 'bins', title: 'Bins out', time: '16:00' })]
    }))
    const row = board.schedule.rows.find(r => r.title === 'Bins out')
    expect(row?.meta).toBe('chore')
    expect(row?.hue).toBeNull()
  })

  it('keeps a done chore on the card, dimmed rather than dropped', () => {
    const board = buildBoard(input({
      chores: [boardChore({ choreId: 'bins', title: 'Bins out', time: '16:00', done: true })]
    }))
    const row = board.schedule.rows.find(r => r.title === 'Bins out')
    expect(row?.past).toBe(true)
    expect(row?.meta).toBe('done')
  })

  it('does not dim a chore just because its time has gone', () => {
    // A bin that was meant to go out at seven and did not is still a bin that
    // needs going out — unlike an appointment, which is simply over.
    const board = buildBoard(input({
      now: at('21:00'),
      chores: [boardChore({ choreId: 'bins', title: 'Bins out', time: '19:00' })]
    }))
    expect(board.schedule.rows.find(r => r.title === 'Bins out')?.past).toBe(false)
  })

  it('keeps an untimed chore out of the grid\'s reckoning', () => {
    // It has no hour, so it must not stretch the grid to reach one — the day
    // still opens at eight.
    const board = buildBoard(input({
      chores: [boardChore({ choreId: 'plants', title: 'Water the plants' })]
    }))
    expect(board.schedule.hours[0]?.label).toBe('08:00')
    expect(board.schedule.rows.some(r => r.chore)).toBe(false)
  })

  it('does not count chores as calendar events in the badge', () => {
    const board = buildBoard(input({
      chores: [boardChore({ choreId: 'bins', title: 'Bins out', time: '16:00' })]
    }))
    expect(board.schedule.badge).toBe('4 events')
  })

  it('shows a timeline for a household with chores and no calendar', () => {
    const board = buildBoard(input({
      events: [],
      hasCalendar: false,
      chores: [
        boardChore({ choreId: 'bins', title: 'Bins out', time: '16:00' }),
        boardChore({ choreId: 'plants', title: 'Water the plants' })
      ]
    }))
    expect(board.schedule.empty).toBe(false)
    expect(board.schedule.badge).toBe('2 chores')
    expect(board.schedule.rows.map(r => r.title)).toContain('Bins out')
  })

  it('fans a pile of chores at one time down the grid', () => {
    const board = buildBoard(input({
      nights: WEEK.map(n => ({ ...n, meal: null })),
      events: [],
      chores: Array.from({ length: 4 }, (_, i) =>
        boardChore({ choreId: `c${i}`, title: `Chore ${i}`, time: '16:00' }))
    }))
    const tops = board.schedule.rows.map(r => r.top)
    expect(tops).toHaveLength(4)
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i]! - tops[i - 1]!).toBeGreaterThanOrEqual(44 / (13 * 48) - 1e-9)
    }
  })

  it('offers tomorrow\'s first chore once tonight is spent', () => {
    const board = buildBoard(input({
      now: at('23:50'),
      events: [],
      chores: [boardChore({
        choreId: 'school-bag', title: 'School bags', date: '2026-07-31', time: '07:00'
      })]
    }))
    const row = board.schedule.allDay.find(r => r.title === 'School bags')
    expect(row?.meta).toBe('tomorrow')
    expect(row?.chore).toEqual({ choreId: 'school-bag', date: '2026-07-31', done: false })
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

  it('faceted on the shortlist, and tells the pane which way the button reads', () => {
    const shortlisted = recipe('miso', 'Miso aubergine', {
      shortlisted_at: '2026-08-01T09:00:00Z'
    })
    const model = buildRecipeLibrary(library({
      recipes: [...LIBRARY_RECIPES, shortlisted],
      facet: 'shortlist',
      selectedId: 'miso'
    }))

    expect(model.cards.map(c => c.id)).toEqual(['miso'])
    expect(model.facets.find(f => f.key === 'shortlist')?.count).toBe(1)
    expect(model.detail?.shortlisted).toBe(true)

    // Nothing shortlisted is the resting state, and it must not read as one.
    const none = buildRecipeLibrary(library({ selectedId: 'orzo' }))
    expect(none.facets.find(f => f.key === 'shortlist')?.count).toBe(0)
    expect(none.detail?.shortlisted).toBe(false)
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

  it('shows the household\'s own photograph over the source site\'s', () => {
    const shot = recipe('shot', 'Photographed here', {
      image_url: 'https://cdn.example/orzo.jpg',
      photo: 'data:image/jpeg;base64,AAAA'
    })
    const linked = recipe('linked', 'Imported only', { image_url: 'https://cdn.example/x.jpg' })
    const bare = recipe('bare', 'Neither')

    const model = buildRecipeLibrary(library({ recipes: [shot, linked, bare], lines: [] }))
    const imageOf = (id: string) => model.cards.find(card => card.id === id)?.image

    expect(imageOf('shot')).toBe('data:image/jpeg;base64,AAAA')
    expect(imageOf('linked')).toBe('https://cdn.example/x.jpg')
    expect(imageOf('bare')).toBe(null)

    // The detail pane resolves it the same way, not separately.
    expect(buildRecipeLibrary(library({
      recipes: [shot, linked, bare], lines: [], selectedId: 'shot'
    })).detail?.image).toBe('data:image/jpeg;base64,AAAA')
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
