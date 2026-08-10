import { describe, expect, it } from 'vitest'
import { duration, nextUnplannedDate, weekStats, type NightLike } from '../app/utils/plan-stats'

function night(date: string, entries: NightLike['entries'] = []): NightLike {
  return { date, entries }
}

function cooked(name: string, prep: number | null, cook: number | null) {
  return { leftover: false, recipe: { name, prep_minutes: prep, cook_minutes: cook } }
}

const WEEK = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']

describe('weekStats', () => {
  it('counts a night with anything on it as planned', () => {
    const stats = weekStats([
      night(WEEK[0]!, [cooked('Chilli', 10, 20)]),
      night(WEEK[1]!),
      night(WEEK[2]!)
    ])
    expect(stats.plannedCount).toBe(1)
    expect(stats.emptyCount).toBe(2)
  })

  /**
   * A takeaway is a decision, not a gap. Counting it as unplanned is what made
   * the aside keep asking to fill a Friday somebody had already dealt with.
   */
  it('counts a skipped night as planned', () => {
    const skipped = { leftover: false, recipe: null }
    const stats = weekStats([night(WEEK[0]!, [skipped]), night(WEEK[1]!)])
    expect(stats.plannedCount).toBe(1)
    expect(stats.emptyCount).toBe(1)
  })

  it('adds up prep and cook across the week', () => {
    const stats = weekStats([
      night(WEEK[0]!, [cooked('Chilli', 10, 20)]),
      night(WEEK[1]!, [cooked('Roast', 20, 90)])
    ])
    expect(stats.totalMinutes).toBe(140)
  })

  it('charges nothing for a leftovers night, because reheating is not cooking', () => {
    const stats = weekStats([
      night(WEEK[0]!, [cooked('Lasagne', 15, 100)]),
      night(WEEK[1]!, [{ leftover: true, recipe: { name: 'Lasagne', prep_minutes: 15, cook_minutes: 100 } }])
    ])
    expect(stats.totalMinutes).toBe(115)
    expect(stats.plannedCount).toBe(2)
  })

  it('names the night that will ambush you', () => {
    const stats = weekStats([
      night(WEEK[0]!, [cooked('Chilli', 10, 20)]),
      night(WEEK[1]!, [cooked('Roast', 20, 90)]),
      night(WEEK[2]!, [cooked('Pasta', 5, 15)])
    ])
    expect(stats.longest).toMatchObject({ date: WEEK[1], minutes: 110, name: 'Roast' })
  })

  it('has no longest cook when nothing takes any time', () => {
    expect(weekStats([night(WEEK[0]!, [cooked('Sandwiches', null, null)])]).longest).toBeNull()
  })

  /**
   * A week the house is away for half of is not half unplanned. Counting those
   * nights is what had the aside sitting at "3 of 7" on a week with nothing left
   * to decide.
   */
  it('leaves a night nobody is eating on out of the count entirely', () => {
    const away = new Set([WEEK[2], WEEK[3]])
    const stats = weekStats(
      [
        night(WEEK[0]!, [cooked('Chilli', 10, 20)]),
        night(WEEK[1]!),
        night(WEEK[2]!),
        night(WEEK[3]!)
      ],
      date => away.has(date)
    )
    expect(stats.plannedCount).toBe(1)
    expect(stats.emptyCount).toBe(1)
    expect(stats.total).toBe(2)
  })

  /**
   * Somebody hosting, or a roster that is wrong. Either way there is a dish, and
   * a dish is a night the week is asking about.
   */
  it('counts an away night that has a dinner on it anyway', () => {
    const stats = weekStats(
      [night(WEEK[0]!, [cooked('Roast', 20, 90)]), night(WEEK[1]!)],
      () => true
    )
    expect(stats.plannedCount).toBe(1)
    expect(stats.total).toBe(1)
    expect(stats.emptyCount).toBe(0)
    expect(stats.totalMinutes).toBe(110)
  })

  it('has a total of zero on a week nobody is home for at all', () => {
    const stats = weekStats(WEEK.map(date => night(date)), () => true)
    expect(stats.total).toBe(0)
    expect(stats.emptyCount).toBe(0)
  })
})

describe('duration', () => {
  it('says hours only once there are any', () => {
    expect(duration(45)).toBe('45m')
    expect(duration(60)).toBe('1h')
    expect(duration(130)).toBe('2h 10m')
  })
})

describe('nextUnplannedDate', () => {
  const today = WEEK[0]!

  it('offers the first night still open', () => {
    const nights = [night(WEEK[0]!, [cooked('Chilli', 10, 20)]), night(WEEK[1]!), night(WEEK[2]!)]
    expect(nextUnplannedDate(nights, today)).toBe(WEEK[1])
  })

  it('looks forward from the night you are on', () => {
    const nights = WEEK.map(date => night(date))
    expect(nextUnplannedDate(nights, today, WEEK[3])).toBe(WEEK[4])
  })

  /**
   * Otherwise pressing "next" from Wednesday stops at Sunday with Tuesday still
   * empty, and the week never finishes.
   */
  it('wraps to the earlier nights still open', () => {
    const nights = WEEK.map((date, i) => (i >= 4 ? night(date, [cooked('Chilli', 10, 20)]) : night(date)))
    expect(nextUnplannedDate(nights, today, WEEK[6])).toBe(WEEK[0])
  })

  it('never offers a night that has been and gone', () => {
    const nights = WEEK.map(date => night(date))
    expect(nextUnplannedDate(nights, WEEK[3]!)).toBe(WEEK[3])
    expect(nextUnplannedDate(nights, WEEK[3]!, WEEK[6])).toBe(WEEK[3])
  })

  it('has nothing left to offer on a full week', () => {
    const nights = WEEK.map(date => night(date, [cooked('Chilli', 10, 20)]))
    expect(nextUnplannedDate(nights, today)).toBeNull()
  })

  /** Walking somebody onto a Wednesday the whole house is away for asks nothing. */
  it('walks past a night nobody is eating on', () => {
    const nights = WEEK.map(date => night(date))
    const away = new Set([WEEK[0], WEEK[1]])
    expect(nextUnplannedDate(nights, today, null, date => away.has(date))).toBe(WEEK[2])
  })

  /** Which is what turns the footer button into "Review week". */
  it('has nothing left to offer when every open night is an away night', () => {
    const nights = WEEK.map(date => night(date))
    expect(nextUnplannedDate(nights, today, null, () => true)).toBeNull()
  })
})
