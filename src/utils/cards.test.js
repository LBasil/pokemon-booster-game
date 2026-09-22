import { describe, expect, it } from 'vitest'
import { groupCardsByQuantity } from './cards'

describe('groupCardsByQuantity', () => {
  it('returns one entry per unique card with quantity 1 when there are no duplicates', () => {
    const cards = [{ id: 'a' }, { id: 'b' }]
    expect(groupCardsByQuantity(cards)).toEqual([
      { card: { id: 'a' }, quantity: 1 },
      { card: { id: 'b' }, quantity: 1 },
    ])
  })

  it('aggregates duplicates and preserves first-seen order', () => {
    const cardA = { id: 'a', name: 'Pikachu' }
    const cardB = { id: 'b', name: 'Charizard' }
    const cards = [cardA, cardB, cardA, cardA]

    expect(groupCardsByQuantity(cards)).toEqual([
      { card: cardA, quantity: 3 },
      { card: cardB, quantity: 1 },
    ])
  })

  it('returns an empty array for an empty input', () => {
    expect(groupCardsByQuantity([])).toEqual([])
  })
})
