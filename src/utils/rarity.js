// pokemontcg.io has ~45 rarity labels across eras. They're collapsed into 6
// buckets — this mirrors public.rarity_bucket() in
// supabase/migrations/0003_realistic_boosters.sql, keep both in sync.
const SECRET = new Set(['special illustration rare', 'hyper rare', 'mega hyper rare', 'rare secret', 'rare rainbow'])
const ULTRA = new Set([
  'ultra rare',
  'rare ultra',
  'illustration rare',
  'trainer gallery rare holo',
  'rare holo star',
  'rare shining',
  'rare shiny',
  'shiny rare',
  'rare shiny gx',
  'shiny ultra rare',
  'black white rare',
  'mega_attack_rare',
  'pikachu rare',
])

export const BUCKETS = ['common', 'uncommon', 'rare', 'holo', 'ultra', 'secret']

/**
 * @param {string|null} rarity - raw rarity label from the cards table
 * @returns {'common'|'uncommon'|'rare'|'holo'|'ultra'|'secret'}
 */
export function rarityBucket(rarity) {
  const label = (rarity ?? '').toLowerCase()
  if (!label || label === 'common' || label === 'promo') return 'common'
  if (label === 'uncommon') return 'uncommon'
  if (label === 'rare') return 'rare'
  if (SECRET.has(label)) return 'secret'
  if (ULTRA.has(label)) return 'ultra'
  if (label.includes('rare') || label.includes('holo') || label === 'legend' || label === 'classic collection') {
    return 'holo'
  }
  return 'common'
}

// Cards from open_booster carry the server-computed bucket; older rows don't
const bucketOf = (card) => card.rarity_bucket ?? rarityBucket(card.rarity)

/** Visual tier for halos and effects: commons/uncommons, rares/holos, hits. */
export function rarityTier(card) {
  const bucket = bucketOf(card)
  if (bucket === 'ultra' || bucket === 'secret') return 'ultra'
  if (bucket === 'rare' || bucket === 'holo') return 'rare'
  return 'common'
}

/** Bucket rank (0 = common … 5 = secret), for sorting. */
export const rarityRank = (card) => BUCKETS.indexOf(bucketOf(card))

/** The bucket, for labels ("Holo", "Secret rare"…). */
export const rarityLabelKey = (card) => bucketOf(card)

/**
 * Orders a pack like a real reveal: commons first, the best pulls last.
 * Stable within a bucket, so the draw order is otherwise preserved.
 */
export function sortForReveal(cards) {
  return [...cards].sort((a, b) => rarityRank(a) - rarityRank(b))
}

/** Highest-bucket card, ties broken by market value. */
export function bestPull(cards) {
  let best = null
  for (const card of cards) {
    const diff = best ? rarityRank(card) - rarityRank(best) : 1
    if (diff > 0 || (diff === 0 && (card.value ?? 0) > (best.value ?? 0))) best = card
  }
  return best
}
