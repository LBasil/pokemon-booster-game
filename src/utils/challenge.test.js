import { describe, expect, it } from 'vitest'
import {
  PACK_PRICE,
  affordablePacks,
  countdownParts,
  craftPrice,
  dailyReward,
  msUntilReset,
  msUntilWeeklyReset,
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
