import { describe, expect, it } from 'vitest'
import { cardPriceEur } from './cardPrice'

describe('cardPriceEur', () => {
  it('uses the Cardmarket average sell price first', () => {
    const card = {
      cardmarket: { prices: { averageSellPrice: 4.2, trendPrice: 5 } },
      tcgplayer: { prices: { normal: { market: 10 } } },
    }
    expect(cardPriceEur(card)).toBe(4.2)
  })

  it('falls back to the Cardmarket trend price', () => {
    expect(cardPriceEur({ cardmarket: { prices: { averageSellPrice: 0, trendPrice: 3 } } })).toBe(3)
  })

  it('converts the TCGplayer market price when Cardmarket has none (recent sets)', () => {
    const card = {
      tcgplayer: { prices: { reverseHolofoil: { market: 0.27 }, normal: { market: 0.22, mid: 0.23 } } },
    }
    expect(cardPriceEur(card, 0.9)).toBe(0.2)
  })

  it('prefers the holofoil print over the reverse holo', () => {
    const card = { tcgplayer: { prices: { reverseHolofoil: { market: 1 }, holofoil: { market: 20 } } } }
    expect(cardPriceEur(card, 1)).toBe(20)
  })

  it('uses the mid price, then any other variant, when needed', () => {
    expect(cardPriceEur({ tcgplayer: { prices: { normal: { market: null, mid: 2 } } } }, 1)).toBe(2)
    expect(cardPriceEur({ tcgplayer: { prices: { somethingNew: { market: 7 } } } }, 1)).toBe(7)
  })

  it('returns 0 when no price is known', () => {
    expect(cardPriceEur({})).toBe(0)
    expect(cardPriceEur({ cardmarket: { prices: {} }, tcgplayer: { prices: {} } })).toBe(0)
  })
})
