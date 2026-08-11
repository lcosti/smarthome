import { describe, expect, it } from 'vitest'
import type { PlanEntryRow } from '../app/utils/db'
import { daysBetween, planMove } from '../app/utils/plan-move'

const HOUSEHOLD = '11111111-1111-1111-1111-111111111111'
const STAMP = '2026-07-30T10:00:00.000Z'
const NOW = '2026-08-01T09:00:00.000Z'

function entry(overrides: Partial<PlanEntryRow> = {}): PlanEntryRow {
  return {
    id: 'entry-mon',
    household_id: HOUSEHOLD,
    date: '2026-08-03',
    meal: 'dinner',
    recipe_id: 'recipe-chilli',
    servings: 4,
    note: null,
    leftover_of_entry_id: null,
    deleted_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides
  } as PlanEntryRow
}

/** The rows a move produced, keyed by id, for asserting on one at a time. */
function byId(rows: PlanEntryRow[]) {
  return new Map(rows.map(row => [row.id, row]))
}

describe('daysBetween', () => {
  it('counts whole days across a month boundary', () => {
    expect(daysBetween('2026-07-31', '2026-08-02')).toBe(2)
    expect(daysBetween('2026-08-02', '2026-07-31')).toBe(-2)
    expect(daysBetween('2026-08-02', '2026-08-02')).toBe(0)
  })
})

describe('moving a night', () => {
  it('moves a dish onto an empty night', () => {
    const rows = planMove([entry()], 'entry-mon', '2026-08-07', 'dinner', NOW)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.date).toBe('2026-08-07')
    expect(rows[0]!.updated_at).toBe(NOW)
  })

  it('carries the cook with the dish', () => {
    // The move spreads the whole row, so this holds for free — the test pins it
    // so a field-by-field rewrite cannot quietly drop who is at the stove.
    const rows = planMove(
      [entry({ cook_person_id: 'person-luke' })],
      'entry-mon',
      '2026-08-07',
      'dinner',
      NOW
    )

    expect(rows[0]!.cook_person_id).toBe('person-luke')
  })

  it('does nothing when a night is dropped on itself', () => {
    expect(planMove([entry()], 'entry-mon', '2026-08-03', 'dinner', NOW)).toEqual([])
  })

  it('does nothing for an entry it cannot see', () => {
    expect(planMove([entry()], 'entry-gone', '2026-08-07', 'dinner', NOW)).toEqual([])
  })

  it('swaps the two nights when the target already has a dinner', () => {
    // A drag rearranges the week. Nothing is overwritten and nothing is lost.
    const rows = byId(planMove(
      [entry(), entry({ id: 'entry-fri', date: '2026-08-07', recipe_id: 'recipe-pasta' })],
      'entry-mon',
      '2026-08-07',
      'dinner',
      NOW
    ))

    expect(rows.size).toBe(2)
    expect(rows.get('entry-mon')!.date).toBe('2026-08-07')
    expect(rows.get('entry-fri')!.date).toBe('2026-08-03')
  })

  it('swaps with the target date’s dinner and leaves its lunch alone', () => {
    // A day is three slots now, and a move stays within its own. Swapping a
    // dinner with whatever happened to be first on the target date would sit
    // Friday's lunch on Monday's dinner and rename both.
    const rows = byId(planMove(
      [
        entry(),
        entry({ id: 'entry-fri-lunch', date: '2026-08-07', meal: 'lunch', recipe_id: 'recipe-soup' }),
        entry({ id: 'entry-fri', date: '2026-08-07', recipe_id: 'recipe-pasta' })
      ],
      'entry-mon',
      '2026-08-07',
      'dinner',
      NOW
    ))

    expect(rows.size).toBe(2)
    expect(rows.get('entry-mon')!.date).toBe('2026-08-07')
    expect(rows.get('entry-fri')!.date).toBe('2026-08-03')
    expect(rows.has('entry-fri-lunch')).toBe(false)
  })

  it('moves onto a date whose only entry is another meal without swapping it', () => {
    const rows = planMove(
      [entry(), entry({ id: 'entry-fri-lunch', date: '2026-08-07', meal: 'lunch' })],
      'entry-mon',
      '2026-08-07',
      'dinner',
      NOW
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('entry-mon')
    expect(rows[0]!.date).toBe('2026-08-07')
  })

  it('ignores a deleted night sitting on the target date', () => {
    const rows = planMove(
      [entry(), entry({ id: 'entry-fri', date: '2026-08-07', deleted_at: NOW })],
      'entry-mon',
      '2026-08-07',
      'dinner',
      NOW
    )

    expect(rows).toHaveLength(1)
  })
})

describe('moving a dish between meals', () => {
  it('rewrites the meal along with the date', () => {
    // Tuesday's dinner becomes Friday's lunch. The row has to arrive calling
    // itself what the column it landed in says, or the plan reads one way and
    // the data another.
    const rows = planMove([entry()], 'entry-mon', '2026-08-07', 'lunch', NOW)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.date).toBe('2026-08-07')
    expect(rows[0]!.meal).toBe('lunch')
  })

  it('changes meal on the same day', () => {
    // Same date, different slot: still a move, and the old code called it a
    // no-op because it only ever compared dates.
    const rows = planMove([entry()], 'entry-mon', '2026-08-03', 'lunch', NOW)

    expect(rows).toHaveLength(1)
    expect(rows[0]!.meal).toBe('lunch')
  })

  it('does nothing when dropped back on the slot it is already in', () => {
    expect(planMove([entry()], 'entry-mon', '2026-08-03', 'dinner', NOW)).toEqual([])
  })

  it('sends the displaced dish back to the slot the dragged one came from', () => {
    // Monday dinner onto Friday lunch, so Friday's lunch takes Monday's dinner —
    // both halves of the swap change day and meal, or one of them lands in a
    // slot that is already occupied.
    const rows = byId(planMove(
      [
        entry(),
        entry({ id: 'entry-fri-lunch', date: '2026-08-07', meal: 'lunch', recipe_id: 'recipe-soup' })
      ],
      'entry-mon',
      '2026-08-07',
      'lunch',
      NOW
    ))

    expect(rows.size).toBe(2)
    expect(rows.get('entry-mon')).toMatchObject({ date: '2026-08-07', meal: 'lunch' })
    expect(rows.get('entry-fri-lunch')).toMatchObject({ date: '2026-08-03', meal: 'dinner' })
  })

  it('leaves the target date’s other meals where they are', () => {
    const rows = planMove(
      [entry(), entry({ id: 'entry-fri', date: '2026-08-07', recipe_id: 'recipe-pasta' })],
      'entry-mon',
      '2026-08-07',
      'breakfast',
      NOW
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('entry-mon')
  })

  it('cuts a leftovers link when the two ends land on one day', () => {
    // Lunch eating what dinner cooked the same day is not what the gap rule
    // models, and the safe answer is the documented one: the night keeps its own
    // copy of the recipe and cooks it.
    const rows = byId(planMove(
      [entry(), entry({ id: 'entry-tue', date: '2026-08-04', leftover_of_entry_id: 'entry-mon' })],
      'entry-tue',
      '2026-08-03',
      'lunch',
      NOW
    ))

    expect(rows.get('entry-tue')!.leftover_of_entry_id).toBeNull()
  })

  it('keeps a leftovers link that changes meal but stays a day apart', () => {
    const rows = byId(planMove(
      [entry(), entry({ id: 'entry-tue', date: '2026-08-04', leftover_of_entry_id: 'entry-mon' })],
      'entry-tue',
      '2026-08-04',
      'lunch',
      NOW
    ))

    expect(rows.get('entry-tue')).toMatchObject({ meal: 'lunch', leftover_of_entry_id: 'entry-mon' })
  })
})

describe('leftovers links across a move', () => {
  /** Monday cooks; Tuesday eats what is left of it. */
  const pair = () => [
    entry(),
    entry({ id: 'entry-tue', date: '2026-08-04', leftover_of_entry_id: 'entry-mon' })
  ]

  it('keeps the link when the two nights stay within a couple of days', () => {
    const rows = byId(planMove(pair(), 'entry-tue', '2026-08-05', 'dinner', NOW))

    expect(rows.get('entry-tue')!.leftover_of_entry_id).toBe('entry-mon')
  })

  it('cuts the link when the leftovers night moves out of reach', () => {
    // Three days later is not leftovers any more. The night keeps its own copy
    // of the recipe and goes back to cooking it, which is what that copy is for.
    const rows = byId(planMove(pair(), 'entry-tue', '2026-08-06', 'dinner', NOW))

    expect(rows.get('entry-tue')!.leftover_of_entry_id).toBeNull()
  })

  it('cuts the link when the leftovers night lands before its source', () => {
    const rows = byId(planMove(pair(), 'entry-tue', '2026-08-02', 'dinner', NOW))

    expect(rows.get('entry-tue')!.leftover_of_entry_id).toBeNull()
  })

  it('cuts the link when the night that cooked moves away instead', () => {
    // Same broken claim from the other end: dragging Monday to Friday leaves
    // Tuesday eating something that will not be cooked until after it.
    const rows = byId(planMove(pair(), 'entry-mon', '2026-08-07', 'dinner', NOW))

    expect(rows.get('entry-mon')!.date).toBe('2026-08-07')
    expect(rows.get('entry-tue')!.leftover_of_entry_id).toBeNull()
  })

  it('leaves an already-stale pair alone when neither end was dragged', () => {
    // Repairing it would change a night nobody touched — and its shopping with
    // it. A drag only answers for the nights it moved.
    const stale = [
      entry(),
      entry({ id: 'entry-far', date: '2026-08-09', leftover_of_entry_id: 'entry-mon' }),
      entry({ id: 'entry-sat', date: '2026-08-08', recipe_id: 'recipe-pasta' })
    ]
    const rows = byId(planMove(stale, 'entry-sat', '2026-08-05', 'dinner', NOW))

    expect(rows.has('entry-far')).toBe(false)
  })

  it('keeps a link whose other end this device cannot see', () => {
    // A source that has not synced yet is a gap in what this device knows, not
    // a broken plan. Cutting it here would push that gap to everybody.
    const rows = planMove(
      [entry({ id: 'entry-tue', date: '2026-08-04', leftover_of_entry_id: 'entry-elsewhere' })],
      'entry-tue',
      '2026-08-08',
      'dinner',
      NOW
    )

    expect(rows[0]!.leftover_of_entry_id).toBe('entry-elsewhere')
  })

  it('follows both nights when a swap carries the pair apart', () => {
    // Monday cooks, Tuesday eats it again, and Monday swaps with Saturday.
    const rows = byId(planMove(
      [...pair(), entry({ id: 'entry-sat', date: '2026-08-08', recipe_id: 'recipe-pasta' })],
      'entry-mon',
      '2026-08-08',
      'dinner',
      NOW
    ))

    expect(rows.get('entry-mon')!.date).toBe('2026-08-08')
    expect(rows.get('entry-sat')!.date).toBe('2026-08-03')
    expect(rows.get('entry-tue')!.leftover_of_entry_id).toBeNull()
  })
})
