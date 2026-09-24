import { collectionStats, setProgress } from '@/utils/collection'
import { rarityBucket } from '@/utils/rarity'

// Every pack has exactly 10 cards (see open_booster), so the number of
// boosters opened can be derived from the cards pulled — no extra column.
export const CARDS_PER_BOOSTER = 10
export const boostersOpened = (totalCards) => Math.floor(totalCards / CARDS_PER_BOOSTER)

// Trainer ranks by boosters opened
export const RANKS = [
  { id: 'rookie', min: 0 },
  { id: 'trainer', min: 10 },
  { id: 'collector', min: 50 },
  { id: 'expert', min: 150 },
  { id: 'master', min: 400 },
  { id: 'legend', min: 1000 },
]

/** Current rank, the next one (null at the top) and progress toward it (0–1). */
export function rankFor(boosters) {
  let index = 0
  while (index + 1 < RANKS.length && boosters >= RANKS[index + 1].min) index++
  const rank = RANKS[index]
  const next = RANKS[index + 1] ?? null
  const progress = next ? (boosters - rank.min) / (next.min - rank.min) : 1
  return { rank, next, progress, level: index + 1 }
}

const bucketOf = (card) => card.rarity_bucket ?? rarityBucket(card.rarity)

/** Unique cards owned per rarity bucket. */
export function rarityBreakdown(entries) {
  const counts = { common: 0, uncommon: 0, rare: 0, holo: 0, ultra: 0, secret: 0 }
  for (const entry of entries) counts[bucketOf(entry.cards)]++
  return counts
}

/**
 * Achievements, in display order. Each has a current value and a target so
 * locked ones can show progress.
 * @param {object[]} entries - collection entries
 * @param {object[]} sets - all sets (for completion and release dates)
 * @returns {{ id: string, current: number, target: number, unlocked: boolean }[]}
 */
export function achievements(entries, sets) {
  const stats = collectionStats(entries)
  const boosters = boostersOpened(stats.totalCards)
  const buckets = rarityBreakdown(entries)
  const progress = setProgress(entries, sets)
  const bestSetPercent = progress.reduce((best, item) => Math.max(best, item.percent), 0)
  const releaseById = Object.fromEntries(sets.map((set) => [set.id, set.release_date ?? '']))
  const vintage = entries.some((entry) => {
    const date = releaseById[entry.cards.set_id]
    return date && date < '2003'
  })

  const list = [
    ['firstBooster', boosters, 1],
    ['tenBoosters', boosters, 10],
    ['hundredBoosters', boosters, 100],
    ['firstHolo', buckets.holo + buckets.ultra + buckets.secret, 1],
    ['firstUltra', buckets.ultra + buckets.secret, 1],
    ['firstSecret', buckets.secret, 1],
    ['hundredUnique', stats.uniqueCards, 100],
    ['thousandCards', stats.totalCards, 1000],
    ['tenSets', stats.setsStarted, 10],
    ['halfSet', Math.floor(bestSetPercent), 50],
    ['completeSet', Math.floor(bestSetPercent), 100],
    ['vintage', vintage ? 1 : 0, 1],
    ['bigValue', Math.floor(stats.value), 1000],
  ]
  return list.map(([id, current, target]) => ({
    id,
    current: Math.min(current, target),
    target,
    unlocked: current >= target,
  }))
}

export const USERNAME_MIN = 2
export const USERNAME_MAX = 24

/** Returns an error key ('tooShort' | 'tooLong') or null; the name is trimmed first. */
export function validateUsername(name) {
  const trimmed = (name ?? '').trim()
  if (trimmed.length < USERNAME_MIN) return 'tooShort'
  if (trimmed.length > USERNAME_MAX) return 'tooLong'
  return null
}
