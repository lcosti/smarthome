import { describe, expect, it } from 'vitest'
import {
  chipColors,
  HUES,
  initialOf,
  personColors,
  personHue,
  type HueSubject
} from '../app/utils/person-colors'

function person(id: string, created_at: string): HueSubject {
  return { id, created_at }
}

const HOUSEHOLD = [
  person('naomi', '2026-01-01T09:00:00.000Z'),
  person('luke', '2026-01-01T09:00:01.000Z'),
  person('sophia', '2026-02-01T10:00:00.000Z'),
  person('arabella', '2026-06-01T11:00:00.000Z')
]

describe('personHue', () => {
  it('assigns the rotation in joining order', () => {
    expect(HOUSEHOLD.map(p => personHue(p.id, HOUSEHOLD))).toEqual([25, 232, 148, 305])
  })

  it('does not depend on the order the array arrives in', () => {
    const shuffled = [HOUSEHOLD[3]!, HOUSEHOLD[0]!, HOUSEHOLD[2]!, HOUSEHOLD[1]!]
    for (const p of HOUSEHOLD) {
      expect(personHue(p.id, shuffled)).toBe(personHue(p.id, HOUSEHOLD))
    }
  })

  it('keeps everybody else fixed when a new person joins', () => {
    // The whole point of ordering by created_at: the baby aging up, or a
    // grandparent being added, must not repaint the wall overnight.
    const withGran = [...HOUSEHOLD, person('gran', '2026-07-30T12:00:00.000Z')]
    for (const p of HOUSEHOLD) {
      expect(personHue(p.id, withGran)).toBe(personHue(p.id, HOUSEHOLD))
    }
    expect(personHue('gran', withGran)).toBe(HUES[4])
  })

  it('breaks a created_at tie by id rather than by array order', () => {
    const same = '2026-01-01T09:00:00.000Z'
    const a = [person('b', same), person('a', same)]
    expect(personHue('a', a)).toBe(HUES[0])
    expect(personHue('b', a)).toBe(HUES[1])
  })

  it('gives an unknown person a colour rather than undefined', () => {
    expect(HUES).toContain(personHue('nobody', HOUSEHOLD))
  })

  it('wraps round for a household larger than the palette', () => {
    const many = Array.from({ length: HUES.length + 1 }, (_, i) =>
      person(`p${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`)
    )
    expect(personHue(`p${HUES.length}`, many)).toBe(HUES[0])
  })
})

describe('personColors', () => {
  it('is a pure function of hue at fixed lightness and chroma', () => {
    expect(personColors(232)).toEqual({
      ring: 'oklch(0.72 0.13 232)',
      tint: 'oklch(0.32 0.06 232)',
      ink: 'oklch(0.88 0.10 232)',
      nameInk: 'oklch(0.92 0.008 75)'
    })
  })

  it('drops the hue entirely for somebody who is out', () => {
    const absent = personColors(232, { absent: true })
    expect(absent).toEqual(personColors(25, { absent: true }))
    expect(absent.ring).not.toContain('232')
  })
})

describe('chipColors', () => {
  it('carries the same hue at lower chroma than the avatar', () => {
    expect(chipColors(25)).toEqual({
      bg: 'oklch(0.23 0.03 25)',
      border: 'oklch(0.40 0.06 25)',
      tint: 'oklch(0.34 0.06 25)',
      ink: 'oklch(0.86 0.09 25)',
      ring: 'oklch(0.76 0.13 25)',
      text: 'oklch(0.90 0.02 25)'
    })
  })
})

describe('initialOf', () => {
  it('takes the first letter, uppercased', () => {
    expect(initialOf('naomi')).toBe('N')
    expect(initialOf('  luke ')).toBe('L')
  })

  it('handles an accented or non-Latin first letter without splitting it', () => {
    expect(initialOf('Émile')).toBe('É')
    expect(initialOf('Árabella')).toBe('Á')
  })

  it('never returns an empty string', () => {
    expect(initialOf('')).toBe('?')
    expect(initialOf('   ')).toBe('?')
  })
})
