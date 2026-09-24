import { rarityBucket } from '@/utils/rarity'

// Collection entries are { card_id, quantity, acquired_at, cards: {...} }
// as returned by fetchCollection().

export const RARITY_FILTERS = ['all', 'common', 'rare', 'ultra', 'secret']
export const SORTS = ['recent', 'rarity', 'name', 'quantity', 'set']

const BUCKET_RANK = { common: 0, uncommon: 1, rare: 2, holo: 3, ultra: 4, secret: 5 }
const bucketOf = (card) => card.rarity_bucket ?? rarityBucket(card.rarity)

// Which rarity filter chip a card falls under
const FILTER_OF_BUCKET = { common: 'common', uncommon: 'common', rare: 'rare', holo: 'rare', ultra: 'ultra', secret: 'secret' }

/** Collector number from a card id: "sv3pt5-173" -> "173", "swsh45sv-SV107" -> "SV107". */
export function cardNumber(cardId) {
  const dash = cardId.lastIndexOf('-')
  return dash === -1 ? cardId : cardId.slice(dash + 1)
}

// Lowercase and strip accents so "pokemon" matches "Pokémon"
const normalize = (text) =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/**
 * @param {object[]} entries
 * @param {{ query?: string, setId?: string, rarity?: string, duplicates?: boolean, dex?: number|null }} filters
 */
export function filterEntries(entries, { query = '', setId = '', rarity = 'all', duplicates = false, dex = null } = {}) {
  const needle = normalize(query)
  return entries.filter((entry) => {
    const card = entry.cards
    if (setId && card.set_id !== setId) return false
    if (dex && card.national_pokedex_number !== dex) return false
    if (rarity !== 'all' && FILTER_OF_BUCKET[bucketOf(card)] !== rarity) return false
    if (duplicates && entry.quantity < 2) return false
    if (needle && !normalize(card.name).includes(needle)) return false
    return true
  })
}

const byNumber = (a, b) => cardNumber(a.card_id).localeCompare(cardNumber(b.card_id), undefined, { numeric: true })

/**
 * Returns a sorted copy.
 * @param {object[]} entries
 * @param {string} sort - one of SORTS
 * @param {Record<string, { release_date?: string }>} [setsById] - for the "set" sort
 */
export function sortEntries(entries, sort, setsById = {}) {
  const sorted = [...entries]
  const compare = {
    recent: (a, b) => (b.acquired_at ?? '').localeCompare(a.acquired_at ?? ''),
    rarity: (a, b) =>
      BUCKET_RANK[bucketOf(b.cards)] - BUCKET_RANK[bucketOf(a.cards)] || (b.cards.value ?? 0) - (a.cards.value ?? 0),
    name: (a, b) => a.cards.name.localeCompare(b.cards.name) || byNumber(a, b),
    quantity: (a, b) => b.quantity - a.quantity || a.cards.name.localeCompare(b.cards.name),
    // Newest set first, then collector number order within a set
    set: (a, b) =>
      (setsById[b.cards.set_id]?.release_date ?? '').localeCompare(setsById[a.cards.set_id]?.release_date ?? '') ||
      a.cards.set_id.localeCompare(b.cards.set_id) ||
      byNumber(a, b),
  }[sort]
  return compare ? sorted.sort(compare) : sorted
}

/**
 * Per-set completion for every set the user has at least one card from,
 * most complete first.
 * @returns {{ set: object, owned: number, total: number, percent: number }[]}
 */
export function setProgress(entries, sets) {
  const owned = new Map()
  for (const entry of entries) owned.set(entry.cards.set_id, (owned.get(entry.cards.set_id) ?? 0) + 1)

  return sets
    .filter((set) => owned.has(set.id))
    .map((set) => {
      const count = owned.get(set.id)
      const total = Math.max(set.total ?? 0, count)
      return { set, owned: count, total, percent: (count / total) * 100 }
    })
    .sort((a, b) => b.percent - a.percent || (b.set.release_date ?? '').localeCompare(a.set.release_date ?? ''))
}

/** Summary numbers for the header. Value is the Cardmarket average price at import time. */
export function collectionStats(entries) {
  let totalCards = 0
  let value = 0
  const sets = new Set()
  for (const entry of entries) {
    totalCards += entry.quantity
    value += (entry.cards.value ?? 0) * entry.quantity
    sets.add(entry.cards.set_id)
  }
  return { uniqueCards: entries.length, totalCards, setsStarted: sets.size, value }
}

/**
 * Every card of a set in collector-number order, each with how many copies
 * the player owns (0 = an empty slot in the binder).
 * @param {object[]} setCards - rows from fetchSetCards()
 * @param {object[]} entries - the player's collection entries
 * @returns {{ card: object, quantity: number }[]}
 */
export function binderSlots(setCards, entries) {
  const owned = new Map(entries.map((entry) => [entry.card_id, entry.quantity]))
  return [...setCards]
    .sort((a, b) => cardNumber(a.id).localeCompare(cardNumber(b.id), undefined, { numeric: true }))
    .map((card) => ({ card, quantity: owned.get(card.id) ?? 0 }))
}

/**
 * National Pokédex progress: for each number 1..size, the cards owned for
 * that Pokémon (the first one's name labels the slot).
 * @returns {{ number: number, owned: number, name: string|null }[]}
 */
export function pokedexSlots(entries, size) {
  const byNumber = new Map()
  for (const entry of entries) {
    const number = entry.cards.national_pokedex_number
    if (!number || number > size) continue
    const slot = byNumber.get(number) ?? { owned: 0, name: null }
    slot.owned++
    // "Charizard ex" -> keep the shortest name seen, closest to the species name
    if (!slot.name || entry.cards.name.length < slot.name.length) slot.name = entry.cards.name
    byNumber.set(number, slot)
  }
  return Array.from({ length: size }, (_, i) => ({ number: i + 1, owned: 0, name: null, ...byNumber.get(i + 1) }))
}
