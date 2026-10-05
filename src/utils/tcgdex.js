// French cards from TCGdex (migration 0029). pokemontcg.io is English only;
// scripts/populate.mjs (`fr`) matches its sets to TCGdex's and stores each
// card's French name, image and texts. The client only builds image URLs.

/** A card number as both APIs agree on it: "006" -> "6", "tg01" -> "TG1". */
export function normalizeNumber(number) {
  const text = String(number ?? '').trim().toUpperCase()
  const m = text.match(/^([A-Z]*)0*(\d+)([A-Z]*)$/)
  return m ? `${m[1]}${m[2]}${m[3]}` : text
}

/** A pokemontcg.io card id's number: "sv3pt5-6" -> "6", "swsh9tg-TG01" -> "TG01". */
export const numberOfId = (id) => String(id).slice(String(id).indexOf('-') + 1)

/**
 * The TCGdex set holding the same cards as one of ours, by number + English
 * name. At least `min` of our cards must match (names differ a little:
 * "δ", "◇"); below that, null (Celebrations' Classic Collection matched a
 * one-card promo set at 0%).
 * @param {{ id: string, name: string }[]} ourCards - the set's cards
 * @param {{ id: string, cards?: { localId: string, name: string }[] }[]} theirSets - TCGdex EN sets with their cards
 * @returns {string | null} the TCGdex set id
 */
export function matchSet(ourCards, theirSets, min = 0.6) {
  if (!ourCards.length) return null
  const key = (number, name) => `${normalizeNumber(number)}|${name.toLowerCase()}`
  const mine = new Set(ourCards.map((card) => key(numberOfId(card.id), card.name)))
  let best = null
  for (const set of theirSets) {
    const overlap = (set.cards ?? []).filter((card) => mine.has(key(card.localId, card.name))).length
    if (!best || overlap > best.overlap) best = { id: set.id, overlap }
  }
  return best && best.overlap >= min * mine.size ? best.id : null
}

/**
 * A TCGdex image in a size, from cards.image_fr (the base URL TCGdex gives).
 * low = ~245 px wide (like pokemontcg.io's small), high = ~600 px.
 * @param {string | null | undefined} base
 * @param {'small' | 'large'} size
 */
export const tcgdexImage = (base, size = 'small') => (base ? `${base}/${size === 'large' ? 'high' : 'low'}.webp` : null)
