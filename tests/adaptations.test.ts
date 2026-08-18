import { describe, expect, it } from 'vitest'
import {
  adaptationAudienceKey,
  adaptationId,
  asAdaptationStage,
  audienceLabel,
  householdAudiences,
  matchAdaptations,
  type AdaptationConstraintLike,
  type AdaptationPersonLike
} from '../app/utils/adaptations'

const TODAY = '2026-08-18'

function person(over: Partial<AdaptationPersonLike> & { id: string }): AdaptationPersonLike {
  return { name: over.id, date_of_birth: null, deleted_at: null, ...over }
}

function diet(personId: string, tag: string, deletedAt: string | null = null): AdaptationConstraintLike {
  return { person_id: personId, kind: 'diet', tag, deleted_at: deletedAt }
}

function adaptation(over: Partial<{ life_stage: string | null, diet_tag: string | null, deleted_at: string | null }>) {
  return { life_stage: null, diet_tag: null, deleted_at: null, ...over }
}

describe('householdAudiences', () => {
  it('puts an eight-month-old in the weaning audience', () => {
    const baby = person({ id: 'b', date_of_birth: '2025-12-10' })
    const audiences = householdAudiences([baby], [], TODAY)
    expect(audiences.stages.get('weaning')).toEqual([baby])
    expect(audiences.stages.has('toddler')).toBe(false)
  })

  it('retires weaning on its own as the baby ages up', () => {
    // Thirteen months old: same row, nothing edited, different answer.
    const child = person({ id: 'b', date_of_birth: '2025-07-10' })
    const audiences = householdAudiences([child], [], TODAY)
    expect(audiences.stages.has('weaning')).toBe(false)
    expect(audiences.stages.get('toddler')).toEqual([child])
  })

  it('gives a pre-weaning baby no audience at all', () => {
    const audiences = householdAudiences([person({ id: 'b', date_of_birth: '2026-05-10' })], [], TODAY)
    expect(audiences.stages.size).toBe(0)
  })

  it('reads a null date of birth as adult', () => {
    const adult = person({ id: 'a' })
    expect(householdAudiences([adult], [], TODAY).stages.get('adult')).toEqual([adult])
  })

  it('collects diets under the normalised tag', () => {
    const adult = person({ id: 'a' })
    const audiences = householdAudiences([adult], [diet('a', '  High  Protein ')], TODAY)
    expect(audiences.diets.get('high protein')).toEqual([adult])
  })

  it('ignores deleted people, deleted constraints and other kinds', () => {
    const gone = person({ id: 'gone', deleted_at: '2026-01-01T00:00:00.000Z' })
    const adult = person({ id: 'a' })
    const audiences = householdAudiences(
      [gone, adult],
      [
        diet('gone', 'high protein'),
        diet('a', 'keto', '2026-01-01T00:00:00.000Z'),
        { person_id: 'a', kind: 'preference', tag: 'spicy', deleted_at: null }
      ],
      TODAY
    )
    expect(audiences.diets.size).toBe(0)
    expect(audiences.stages.get('adult')).toEqual([adult])
  })
})

describe('matchAdaptations', () => {
  const household = [
    person({ id: 'mum' }),
    person({ id: 'tot', date_of_birth: '2024-06-10' }),
    person({ id: 'bub', date_of_birth: '2025-12-10' })
  ]

  it('matches on stage and on diet, youngest stage first then diets', () => {
    const audiences = householdAudiences(household, [diet('mum', 'high protein')], TODAY)
    const rows = [
      adaptation({ diet_tag: 'high protein' }),
      adaptation({ life_stage: 'toddler' }),
      adaptation({ life_stage: 'weaning' })
    ]
    expect(matchAdaptations(rows, audiences).map(m => audienceLabel(m.adaptation)))
      .toEqual(['Weaning', 'Toddler', 'high protein'])
  })

  it('names everybody the adaptation is for', () => {
    const twin = person({ id: 'bub2', date_of_birth: '2026-01-05' })
    const audiences = householdAudiences([...household, twin], [], TODAY)
    const [match] = matchAdaptations([adaptation({ life_stage: 'weaning' })], audiences)
    expect(match!.people.map(p => p.id)).toEqual(['bub', 'bub2'])
  })

  it('shows nothing for an audience nobody is', () => {
    const audiences = householdAudiences(household, [], TODAY)
    expect(matchAdaptations([adaptation({ life_stage: 'child' })], audiences)).toEqual([])
    expect(matchAdaptations([adaptation({ diet_tag: 'keto' })], audiences)).toEqual([])
  })

  it('skips a deleted adaptation', () => {
    const audiences = householdAudiences(household, [], TODAY)
    const rows = [adaptation({ life_stage: 'weaning', deleted_at: '2026-01-01T00:00:00.000Z' })]
    expect(matchAdaptations(rows, audiences)).toEqual([])
  })

  it('matches a diet however either side typed it', () => {
    const audiences = householdAudiences(household, [diet('mum', 'High Protein')], TODAY)
    expect(matchAdaptations([adaptation({ diet_tag: 'high  protein' })], audiences)).toHaveLength(1)
  })
})

describe('identity', () => {
  it('keys the audience by stage or normalised diet tag', () => {
    expect(adaptationAudienceKey({ life_stage: 'weaning', diet_tag: null })).toBe('stage:weaning')
    expect(adaptationAudienceKey({ life_stage: null, diet_tag: ' High  Protein ' })).toBe('diet:high protein')
  })

  it('mints the same id for the same recipe and audience, every time', () => {
    const a = adaptationId('h1', 'r1', 'stage:weaning')
    expect(adaptationId('h1', 'r1', 'stage:weaning')).toBe(a)
    expect(adaptationId('h1', 'r1', 'stage:toddler')).not.toBe(a)
    expect(adaptationId('h1', 'r2', 'stage:weaning')).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('narrows an unknown stage to null rather than guessing', () => {
    expect(asAdaptationStage('baby')).toBe(null)
    expect(asAdaptationStage('teen')).toBe(null)
    expect(asAdaptationStage('weaning')).toBe('weaning')
  })
})
