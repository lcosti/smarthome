import { describe, expect, it } from 'vitest'
import { NOT_COOKING, SKIP_REASONS, skipIcon, skipLabel } from '../app/utils/skip'

describe('skip reasons', () => {
  it('names a stored reason', () => {
    expect(skipLabel('takeaway')).toBe('Takeaway')
    expect(skipIcon('takeaway')).toBe('i-lucide-bike')
  })

  it('falls back to the plain statement for a reason it does not know', () => {
    // A token written by a newer client, or one retired since. The night is
    // still legible on this device; only the wording is lost.
    expect(skipLabel('freezer_night')).toBe(NOT_COOKING)
    expect(skipLabel(null)).toBe(NOT_COOKING)
    expect(skipIcon('freezer_night')).toBe('i-lucide-circle-slash')
  })

  it('has a distinct token and icon for every reason', () => {
    expect(new Set(SKIP_REASONS.map(r => r.value)).size).toBe(SKIP_REASONS.length)
    expect(new Set(SKIP_REASONS.map(r => r.icon)).size).toBe(SKIP_REASONS.length)
  })
})
