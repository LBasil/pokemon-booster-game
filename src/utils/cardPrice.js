// Picks a card's price in euros from a pokemontcg.io card. Used by
// scripts/populate.mjs (Node) — keep this file free of imports.
//
// Cardmarket (EUR) is the reference. Recent sets (Prismatic Evolutions,
// Mega Evolution...) only come with TCGplayer prices (USD): without this
// fallback they were stored at 0 and whole collections showed "0 €".

/** Rough USD -> EUR rate for TCGplayer prices; override with `USD_TO_EUR`. */
export const DEFAULT_USD_TO_EUR = 0.86

// Print variants, most representative first (a pulled card is the plain
// print; the reverse holo only when that's all TCGplayer lists)
const TCGPLAYER_VARIANTS = [
  'normal',
  'holofoil',
  'unlimitedHolofoil',
  'unlimited',
  '1stEditionHolofoil',
  '1stEditionNormal',
  '1stEdition',
  'reverseHolofoil',
]

const positive = (value) => (typeof value === 'number' && value > 0 ? value : null)

/**
 * @param {object} card - a card from the pokemontcg.io API
 * @param {number} [usdToEur]
 * @returns {number} euros, 0 when no price is known
 */
export function cardPriceEur(card, usdToEur = DEFAULT_USD_TO_EUR) {
  const cardmarket = card.cardmarket?.prices
  const eur = positive(cardmarket?.averageSellPrice) ?? positive(cardmarket?.trendPrice)
  if (eur) return eur

  const prices = card.tcgplayer?.prices ?? {}
  const variants = [...TCGPLAYER_VARIANTS, ...Object.keys(prices).filter((key) => !TCGPLAYER_VARIANTS.includes(key))]
  for (const variant of variants) {
    const usd = positive(prices[variant]?.market) ?? positive(prices[variant]?.mid)
    if (usd) return Math.round(usd * usdToEur * 100) / 100
  }
  return 0
}
