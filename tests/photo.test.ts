import { describe, expect, it } from 'vitest'
import { squareCrop } from '../app/utils/photo'

describe('squareCrop', () => {
  it('takes the middle of a landscape photo', () => {
    expect(squareCrop(4000, 3000)).toEqual({ side: 3000, x: 500, y: 0 })
  })

  it('takes the middle of a portrait photo', () => {
    expect(squareCrop(3000, 4000)).toEqual({ side: 3000, x: 0, y: 500 })
  })

  it('leaves a square photo alone', () => {
    expect(squareCrop(512, 512)).toEqual({ side: 512, x: 0, y: 0 })
  })

  it('rounds an odd offset to a whole pixel', () => {
    expect(squareCrop(101, 100)).toEqual({ side: 100, x: 1, y: 0 })
  })
})
