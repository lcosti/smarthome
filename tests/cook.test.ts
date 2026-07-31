import { describe, expect, it } from 'vitest'
import { findStepDuration, formatCountdown, splitStepBody } from '../app/utils/cook'

describe('splitStepBody', () => {
  it('treats a single paragraph as the whole step', () => {
    expect(splitStepBody('Soften the onion in the oil.')).toEqual({
      main: 'Soften the onion in the oil.',
      tip: null
    })
  })

  it('lifts a second paragraph out as the tip', () => {
    const body = 'Soak the porcini for 20 mins.\n\nKeep the soaking liquid.'
    expect(splitStepBody(body)).toEqual({
      main: 'Soak the porcini for 20 mins.',
      tip: 'Keep the soaking liquid.'
    })
  })

  it('keeps every paragraph after the first in the tip', () => {
    const body = 'Stir in the rice.\n\nOne ladle at a time.\n\nIt should never go dry.'
    expect(splitStepBody(body).tip).toBe('One ladle at a time.\n\nIt should never go dry.')
  })

  it('splits on Windows line endings too', () => {
    expect(splitStepBody('Do this.\r\n\r\nThen note that.').tip).toBe('Then note that.')
  })

  it('ignores a blank line that separates nothing', () => {
    expect(splitStepBody('Do this.\n\n   \n')).toEqual({ main: 'Do this.', tip: null })
  })

  it('trims the surrounding whitespace of both halves', () => {
    expect(splitStepBody('  Do this.  \n\n  And note that.  ')).toEqual({
      main: 'Do this.',
      tip: 'And note that.'
    })
  })

  it('survives an empty body', () => {
    expect(splitStepBody('')).toEqual({ main: '', tip: null })
  })
})

describe('findStepDuration', () => {
  it('reads minutes out of prose', () => {
    expect(findStepDuration('Soak the porcini in boiling water for 20 mins, then drain.'))
      .toEqual({ seconds: 1200, label: '20 min', name: 'Soak' })
  })

  it('accepts every way of writing the unit', () => {
    expect(findStepDuration('20 min')).toMatchObject({ seconds: 1200, label: '20 min' })
    expect(findStepDuration('20 minutes')).toMatchObject({ seconds: 1200, label: '20 min' })
    expect(findStepDuration('1 hour')).toMatchObject({ seconds: 3600, label: '1 hr' })
    expect(findStepDuration('2 hrs')).toMatchObject({ seconds: 7200, label: '2 hr' })
    expect(findStepDuration('90 seconds')).toMatchObject({ seconds: 90, label: '90 sec' })
    expect(findStepDuration('45 secs')).toMatchObject({ seconds: 45, label: '45 sec' })
  })

  it('counts in the unit the recipe chose', () => {
    // 90 seconds is not "2 min" — the cook is counting seconds.
    expect(findStepDuration('Blanch for 90 seconds.')?.label).toBe('90 sec')
  })

  it('understands a half', () => {
    expect(findStepDuration('Rest for 1½ hours.')).toMatchObject({ seconds: 5400, label: '1 hr 30 min' })
    expect(findStepDuration('Rest for 1 1/2 hours.')).toMatchObject({ seconds: 5400, label: '1 hr 30 min' })
    expect(findStepDuration('Rest for ½ hour.')).toMatchObject({ seconds: 1800, label: '30 min' })
  })

  it('takes the top of a range, so the timer never goes off early', () => {
    expect(findStepDuration('Simmer for 10-12 mins.')).toMatchObject({ seconds: 720, label: '12 min' })
    expect(findStepDuration('Simmer for 10 to 12 mins.')).toMatchObject({ seconds: 720, label: '12 min' })
    expect(findStepDuration('Simmer for 10–12 mins.')).toMatchObject({ seconds: 720, label: '12 min' })
  })

  it('takes the first duration when a step mentions several', () => {
    // The step leads with what you are about to do; the rest is context.
    expect(findStepDuration('Simmer 10 mins, then rest 5 mins.')).toMatchObject({
      seconds: 600,
      label: '10 min'
    })
  })

  it('is not fooled by quantities or oven settings', () => {
    expect(findStepDuration('Add 300g rice and cook on gas 6.')).toBeNull()
    expect(findStepDuration('Pour in 1 litre of stock.')).toBeNull()
    expect(findStepDuration('Serves 4.')).toBeNull()
    expect(findStepDuration('')).toBeNull()
  })

  it('ignores a time word that only starts with one', () => {
    expect(findStepDuration('Add 2 mincemeat jars.')).toBeNull()
  })

  it('does not care about case', () => {
    expect(findStepDuration('SOAK FOR 20 MINS')).toMatchObject({ seconds: 1200, label: '20 min' })
  })
})

describe('naming the timer', () => {
  const nameOf = (text: string) => findStepDuration(text)?.name ?? null

  it('names the timer after the verb the duration belongs to', () => {
    expect(nameOf('Soak for 20 mins.')).toBe('Soak')
    expect(nameOf('Roast for 25-30 mins.')).toBe('Roast')
    expect(nameOf('Cover and cook for 15 mins.')).toBe('Cook')
  })

  it('is not fooled by the noun sitting in front of the duration', () => {
    // "the word before for" would name this one Chicken.
    expect(nameOf('Brown the chicken for 8 mins.')).toBe('Brown')
  })

  it('takes the last verb before the duration, not the first', () => {
    expect(nameOf('Pour over 1 litre of boiling water. Soak for 20 mins.')).toBe('Soak')
  })

  it('reads a verb carrying a plain suffix', () => {
    expect(nameOf('Roasted for 30 mins.')).toBe('Roast')
  })

  it('treats a participle as description rather than as the action', () => {
    // Boiling water is what you pour in, not what you are waiting for. Timing
    // the participle would name this one Boil.
    expect(nameOf('Soak the porcini in boiling water for 20 mins.')).toBe('Soak')
    expect(nameOf('Leave the dough proving for 1 hour.')).toBeNull()
  })

  it('ignores a verb that comes after the duration', () => {
    expect(nameOf('Give it 5 mins, then simmer.')).toBeNull()
  })

  it('leaves the timer unnamed rather than guessing', () => {
    expect(nameOf('Give it 5 mins.')).toBeNull()
    expect(nameOf('20 mins.')).toBeNull()
  })

  it('title-cases whatever it found', () => {
    expect(nameOf('simmer for 10 mins')).toBe('Simmer')
    expect(nameOf('SIMMER FOR 10 MINS')).toBe('Simmer')
  })
})

describe('formatCountdown', () => {
  it('reads like a clock', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(5)).toBe('0:05')
    expect(formatCountdown(59)).toBe('0:59')
    expect(formatCountdown(1200)).toBe('20:00')
  })

  it('grows an hours field only when there are hours', () => {
    expect(formatCountdown(3599)).toBe('59:59')
    expect(formatCountdown(3600)).toBe('1:00:00')
    expect(formatCountdown(3725)).toBe('1:02:05')
  })

  it('clamps below zero rather than counting up', () => {
    expect(formatCountdown(-3)).toBe('0:00')
  })
})
