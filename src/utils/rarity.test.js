import { describe, expect, it } from 'vitest'
import { bestPull, rarityTier, sortForReveal } from './rarity'

describe('rarityTier', () => {
  it.each([
    [null, 'common'],
    ['Common', 'common'],
    ['Uncommon', 'common'],
    ['Promo', 'common'],
    ['Rare', 'rare'],
    ['Rare Holo', 'rare'],
    ['Rare Holo GX', 'rare'],
    ['Double Rare', 'rare'],
    ['Radiant Rare', 'rare'],
    ['ACE SPEC Rare', 'rare'],
    ['Rare Holo VMAX', 'ultra'],
    ['Rare Ultra', 'ultra'],
    ['Rare Secret', 'ultra'],
    ['Illustration Rare', 'ultra'],
    ['Special Illustration Rare', 'ultra'],
    ['Hyper Rare', 'ultra'],
    ['Rare Holo Star', 'ultra'],
    ['Something new', 'common'],
  ])('%s -> %s', (rarity, tier) => {
    expect(rarityTier(rarity)).toBe(tier)
  })
})

describe('sortForReveal', () => {
  it('puts rarer cards last and keeps draw order within a tier', () => {
    const cards = [
      { id: 'a', rarity: 'Rare Ultra' },
      { id: 'b', rarity: 'Common' },
      { id: 'c', rarity: 'Rare Holo' },
      { id: 'd', rarity: 'Uncommon' },
    ]
    expect(sortForReveal(cards).map((c) => c.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('does not mutate its input', () => {
    const cards = [{ id: 'a', rarity: 'Rare' }, { id: 'b', rarity: 'Common' }]
    sortForReveal(cards)
    expect(cards.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('bestPull', () => {
  it('prefers the highest tier, then the highest value', () => {
    const cards = [
      { id: 'a', rarity: 'Rare Holo', value: 50 },
      { id: 'b', rarity: 'Illustration Rare', value: 3 },
      { id: 'c', rarity: 'Hyper Rare', value: 12 },
    ]
    expect(bestPull(cards).id).toBe('c')
  })

  it('returns null for an empty list', () => {
    expect(bestPull([])).toBeNull()
  })
})
