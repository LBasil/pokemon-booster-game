import { describe, expect, it } from 'vitest'
import { flattenBoosters } from './boosters'

describe('flattenBoosters', () => {
  it('flattens multiple boosters into a single card list, preserving order', () => {
    const boosters = [
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'c' }],
    ]
    expect(flattenBoosters(boosters)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  })

  it('returns an empty array when there are no boosters', () => {
    expect(flattenBoosters([])).toEqual([])
  })
})
