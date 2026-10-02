import { describe, expect, it } from 'vitest'
import {
  PACK_PRICE,
  affordablePacks,
  countdownParts,
  craftPrice,
  dailyReward,
  duplicateGroups,
  msUntilReset,
  msUntilWeeklyReset,
  recycleKeep,
  recyclePreview,
  recycleValue,
} from './challenge'

const card = (rarity_bucket) => ({ id: rarity_bucket, rarity_bucket })

describe('challenge economy', () => {
  it('prices cards by rarity bucket, crafting far above recycling', () => {
    expect(recycleValue(card('common'))).toBe(1)
    expect(recycleValue(card('secret'))).toBe(200)
    expect(craftPrice(card('ultra'))).toBe(1500)
    for (const bucket of ['common', 'uncommon', 'rare', 'holo', 'ultra', 'secret']) {
      expect(craftPrice(card(bucket))).toBeGreaterThanOrEqual(recycleValue(card(bucket)) * 20)
    }
  })

  it('falls back to the raw rarity label when the bucket is missing', () => {
    expect(recycleValue({ rarity: 'Rare Holo' })).toBe(15)
  })

  it('grows the daily reward for 7 days, then caps it', () => {
    expect([0, 1, 2, 6, 7, 8, 30].map(dailyReward)).toEqual([200, 200, 250, 450, 500, 500, 500])
  })

  it('counts affordable packs', () => {
    expect(affordablePacks(PACK_PRICE * 3 + 99)).toBe(3)
    expect(affordablePacks(99)).toBe(0)
    expect(affordablePacks(undefined)).toBe(0)
  })

  it('previews recycling: every copy beyond the first', () => {
    const entries = [
      { quantity: 3, cards: card('common') },
      { quantity: 1, cards: card('secret') },
      { quantity: 2, cards: card('ultra') },
    ]
    expect(recyclePreview(entries)).toEqual({ cards: 3, coins: 2 + 60 })
    expect(recyclePreview([])).toEqual({ cards: 0, coins: 0 })
  })

  it('previews a pick of cards and copies only', () => {
    const entries = [
      { card_id: 'a', quantity: 4, cards: card('common') },
      { card_id: 'b', quantity: 2, cards: card('ultra') },
      { card_id: 'c', quantity: 1, cards: card('rare') },
    ]
    expect(recyclePreview(entries, new Map([['b', 1], ['c', 1]]))).toEqual({ cards: 1, coins: 60 })
    expect(recyclePreview(entries, new Map([['a', 2]]))).toEqual({ cards: 2, coins: 2 })
    // capped at the duplicates, one copy always stays
    expect(recyclePreview(entries, new Map([['a', 9], ['b', 0]]))).toEqual({ cards: 3, coins: 3 })
    expect(recyclePreview(entries, new Map())).toEqual({ cards: 0, coins: 0 })
  })

  it('keeps more than one copy of each card when asked', () => {
    const entries = [
      { card_id: 'a', quantity: 4, cards: card('common') },
      { card_id: 'b', quantity: 2, cards: card('ultra') },
    ]
    expect(recyclePreview(entries, null, 2)).toEqual({ cards: 2, coins: 2 })
    expect(recyclePreview(entries, new Map([['a', 9]]), 3)).toEqual({ cards: 1, coins: 1 })
    expect(duplicateGroups(entries, 2).map((group) => group.entries.map((entry) => entry.card_id))).toEqual([['a']])
    expect(duplicateGroups(entries, 4)).toEqual([])
    expect(recycleKeep(3)).toBe(3)
    expect(recycleKeep(0)).toBe(1)
    expect(recycleKeep('2')).toBe(1)
    expect(recycleKeep(undefined)).toBe(1)
  })

  it('groups the cards with duplicates by rarity, then name', () => {
    const entry = (card_id, name, bucket, quantity) => ({ card_id, quantity, cards: { name, rarity_bucket: bucket } })
    const groups = duplicateGroups([
      entry('x1', 'Zubat', 'common', 2),
      entry('x2', 'Mew', 'secret', 3),
      entry('x3', 'Abra', 'common', 4),
      entry('x4', 'Onix', 'rare', 1), // no duplicate
    ])
    expect(groups.map((g) => g.bucket)).toEqual(['common', 'secret'])
    expect(groups[0].entries.map((e) => e.cards.name)).toEqual(['Abra', 'Zubat'])
  })

  it('resets at 00:00 UTC', () => {
    expect(msUntilReset(new Date('2026-09-25T22:30:00Z'))).toBe(90 * 60 * 1000)
    expect(msUntilReset(new Date('2026-12-31T23:59:00Z'))).toBe(60 * 1000)
    expect(countdownParts(90 * 60 * 1000)).toEqual({ hours: 1, minutes: 30 })
    expect(countdownParts(10)).toEqual({ hours: 0, minutes: 1 })
  })

  it('resets the weekly missions on Monday 00:00 UTC', () => {
    const hour = 60 * 60 * 1000
    expect(msUntilWeeklyReset(new Date('2026-09-27T23:00:00Z'))).toBe(hour) // Sunday night
    expect(msUntilWeeklyReset(new Date('2026-09-28T00:00:00Z'))).toBe(7 * 24 * hour) // just reset
    expect(msUntilWeeklyReset(new Date('2026-09-26T12:00:00Z'))).toBe(36 * hour) // Saturday noon
  })
})
