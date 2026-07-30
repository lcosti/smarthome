import { describe, expect, it } from 'vitest'
import { ageLabel, deriveLifeStage, STAGE_FROM_MONTHS } from '../app/utils/people'

describe('deriveLifeStage', () => {
  it('treats an unknown date of birth as an adult', () => {
    // Every person row written before Phase 4 belongs to somebody who signed in.
    expect(deriveLifeStage(null, '2026-07-30')).toBe('adult')
  })

  it('calls a newborn a baby', () => {
    expect(deriveLifeStage('2026-07-30', '2026-07-30')).toBe('baby')
    expect(deriveLifeStage('2026-06-01', '2026-07-30')).toBe('baby')
  })

  it('starts weaning on the six-month-versary, not the day before', () => {
    expect(deriveLifeStage('2026-01-15', '2026-07-14')).toBe('baby')
    expect(deriveLifeStage('2026-01-15', '2026-07-15')).toBe('weaning')
  })

  it('ends weaning on the first birthday', () => {
    expect(deriveLifeStage('2025-08-04', '2026-08-03')).toBe('weaning')
    expect(deriveLifeStage('2025-08-04', '2026-08-04')).toBe('toddler')
  })

  it('ends toddler on the third birthday', () => {
    expect(deriveLifeStage('2023-08-04', '2026-08-03')).toBe('toddler')
    expect(deriveLifeStage('2023-08-04', '2026-08-04')).toBe('child')
  })

  it('ends child on the thirteenth birthday', () => {
    expect(deriveLifeStage('2013-08-04', '2026-08-03')).toBe('child')
    expect(deriveLifeStage('2013-08-04', '2026-08-04')).toBe('adult')
  })

  it('ages a 29 February birth date up on 1 March', () => {
    // 2025 has no 29 February. The child is not briefly a month younger than
    // they were yesterday; the anniversary lands on the 1st.
    expect(deriveLifeStage('2024-02-29', '2025-02-28')).toBe('weaning')
    expect(deriveLifeStage('2024-02-29', '2025-03-01')).toBe('toddler')
    // Same again three years on, in another non-leap year.
    expect(deriveLifeStage('2024-02-29', '2027-02-28')).toBe('toddler')
    expect(deriveLifeStage('2024-02-29', '2027-03-01')).toBe('child')
    // A month-versary that does exist is not shifted.
    expect(deriveLifeStage('2024-02-29', '2024-08-28')).toBe('baby')
    expect(deriveLifeStage('2024-02-29', '2024-08-29')).toBe('weaning')
  })

  it('crosses a year boundary correctly', () => {
    expect(deriveLifeStage('2025-12-20', '2026-06-19')).toBe('baby')
    expect(deriveLifeStage('2025-12-20', '2026-06-20')).toBe('weaning')
  })

  it('reads a future date of birth as the youngest stage', () => {
    // A mistyped year, or a pregnancy entered early. Either way, not an adult.
    expect(deriveLifeStage('2027-01-01', '2026-07-30')).toBe('baby')
  })

  it('agrees with the boundary constants', () => {
    // Guards a rename of the constants against the branches drifting out of order.
    expect(STAGE_FROM_MONTHS.weaning).toBeLessThan(STAGE_FROM_MONTHS.toddler)
    expect(STAGE_FROM_MONTHS.toddler).toBeLessThan(STAGE_FROM_MONTHS.child)
    expect(STAGE_FROM_MONTHS.child).toBeLessThan(STAGE_FROM_MONTHS.adult)
  })
})

describe('ageLabel', () => {
  it('has nothing to say without a date of birth', () => {
    expect(ageLabel(null, '2026-07-30')).toBeNull()
  })

  it('counts months under two', () => {
    expect(ageLabel('2026-01-30', '2026-07-30')).toBe('6m')
    expect(ageLabel('2024-08-30', '2026-07-30')).toBe('23m')
  })

  it('counts years and months over two', () => {
    expect(ageLabel('2024-03-30', '2026-07-30')).toBe('2y 4m')
    expect(ageLabel('2023-07-30', '2026-07-30')).toBe('3y')
  })

  it('says so when the date is in the future', () => {
    expect(ageLabel('2027-01-01', '2026-07-30')).toBe('not born yet')
  })
})
