import { describe, expect, it } from 'vitest'
import { STAGE_FROM_MONTHS } from '../app/utils/people'
import { adultsAmong, defaultCook } from '../app/utils/plan-cook'

const ON = '2026-08-11'

const adult = (name: string, dob: string | null = '1990-05-01') => ({ name, date_of_birth: dob })
const child = (name: string) => ({ name, date_of_birth: '2020-02-01' })

describe('adultsAmong', () => {
  it('keeps adults and drops children', () => {
    const people = [adult('Luke'), adult('Amy'), child('Tom')]
    expect(adultsAmong(people, ON).map(p => p.name)).toEqual(['Luke', 'Amy'])
  })

  it('counts an unknown birth date as an adult', () => {
    // The documented default in deriveLifeStage: every row written before ages
    // existed belongs to somebody who signed in.
    expect(adultsAmong([adult('Gran', null)], ON)).toHaveLength(1)
  })

  it('promotes somebody on the birthday the stage threshold names', () => {
    // Derived at query time, so nobody edits anything when it happens.
    const months = STAGE_FROM_MONTHS.adult
    const person = { name: 'Kid', date_of_birth: '2013-08-11' }
    expect(adultsAmong([person], '2026-08-10')).toHaveLength(0)
    expect(adultsAmong([person], `${2013 + Math.floor(months / 12)}-08-11`)).toHaveLength(1)
  })
})

describe('defaultCook', () => {
  it('hands the night to the sole adult at the table', () => {
    const cook = defaultCook([adult('Amy'), child('Tom')], ON)
    expect(cook?.name).toBe('Amy')
  })

  it('claims nothing when two adults are home', () => {
    expect(defaultCook([adult('Luke'), adult('Amy')], ON)).toBeNull()
  })

  it('claims nothing when no adult is home', () => {
    expect(defaultCook([child('Tom')], ON)).toBeNull()
    expect(defaultCook([], ON)).toBeNull()
  })
})
