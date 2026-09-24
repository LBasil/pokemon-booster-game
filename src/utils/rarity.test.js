import { describe, expect, it } from 'vitest'
import { bestPull, rarityBucket, rarityTier, sortForReveal } from './rarity'

describe('rarityBucket', () => {
  it.each([
    [null, 'common'],
    ['Common', 'common'],
    ['Promo', 'common'],
    ['Uncommon', 'uncommon'],
    ['Rare', 'rare'],
    ['Rare Holo', 'holo'],
    ['Rare Holo GX', 'holo'],
    ['Rare Holo VMAX', 'holo'],
    ['Holo Rare VSTAR', 'holo'],
    ['Double Rare', 'holo'],
    ['Radiant Rare', 'holo'],
    ['ACE SPEC Rare', 'holo'],
    ['LEGEND', 'holo'],
    ['Rare Ultra', 'ultra'],
    ['Ultra Rare', 'ultra'],
    ['Illustration Rare', 'ultra'],
    ['Trainer Gallery Rare Holo', 'ultra'],
    ['Rare Holo Star', 'ultra'],
    ['MEGA_ATTACK_RARE', 'ultra'],
    ['Special Illustration Rare', 'secret'],
    ['Hyper Rare', 'secret'],
    ['Mega Hyper Rare', 'secret'],
    ['Rare Secret', 'secret'],
    ['Rare Rainbow', 'secret'],
    ['Some Future Rare', 'holo'],
    ['Something new', 'common'],
  ])('%s -> %s', (rarity, bucket) => {
    expect(rarityBucket(rarity)).toBe(bucket)
  })
})

describe('rarityTier', () => {
  it('groups buckets into three visual tiers', () => {
    expect(rarityTier({ rarity: 'Uncommon' })).toBe('common')
    expect(rarityTier({ rarity: 'Double Rare' })).toBe('rare')
    expect(rarityTier({ rarity: 'Hyper Rare' })).toBe('ultra')
  })

  it('prefers the bucket computed by the database', () => {
    expect(rarityTier({ rarity: 'Common', rarity_bucket: 'secret' })).toBe('ultra')
  })
})

describe('sortForReveal', () => {
  it('puts rarer cards last and keeps draw order within a bucket', () => {
    const cards = [
      { id: 'a', rarity: 'Rare Ultra' },
      { id: 'b', rarity: 'Common' },
      { id: 'c', rarity: 'Rare Holo' },
      { id: 'd', rarity: 'Common' },
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
  it('prefers the highest bucket, then the highest value', () => {
    const cards = [
      { id: 'a', rarity: 'Rare Holo', value: 50 },
      { id: 'b', rarity: 'Illustration Rare', value: 3 },
      { id: 'c', rarity: 'Ultra Rare', value: 12 },
    ]
    expect(bestPull(cards).id).toBe('c')
  })

  it('returns null for an empty list', () => {
    expect(bestPull([])).toBeNull()
  })
})
