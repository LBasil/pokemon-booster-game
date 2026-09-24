// pokemontcg.io has ~40 rarity labels across eras; the UI only needs 3 tiers.
const ULTRA = /ultra|secret|rainbow|illustration|hyper|shiny|vmax|vstar|legend|special|star|black white|crown/
const RARE = /rare|holo|amazing|radiant|prime|break|ace/

export const TIERS = ['common', 'rare', 'ultra']

/**
 * @param {string|null} rarity - raw rarity label from the cards table
 * @returns {'common'|'rare'|'ultra'}
 */
export function rarityTier(rarity) {
  const label = (rarity ?? '').toLowerCase()
  if (!label || label === 'common' || label === 'uncommon' || label === 'promo') return 'common'
  if (ULTRA.test(label)) return 'ultra'
  if (RARE.test(label)) return 'rare'
  return 'common'
}

/**
 * Orders a pack like a real reveal: commons first, the best pulls last.
 * Stable within a tier, so the draw order is otherwise preserved.
 */
export function sortForReveal(cards) {
  return [...cards].sort((a, b) => TIERS.indexOf(rarityTier(a.rarity)) - TIERS.indexOf(rarityTier(b.rarity)))
}

/** Highest-tier card, ties broken by market value. */
export function bestPull(cards) {
  let best = null
  for (const card of cards) {
    if (!best) {
      best = card
      continue
    }
    const tierDiff = TIERS.indexOf(rarityTier(card.rarity)) - TIERS.indexOf(rarityTier(best.rarity))
    if (tierDiff > 0 || (tierDiff === 0 && (card.value ?? 0) > (best.value ?? 0))) best = card
  }
  return best
}
