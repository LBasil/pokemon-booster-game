import { rarityBucket } from '@/utils/rarity'

// Every pack has exactly 10 cards (see open_booster), so the number of
// boosters opened can be derived from the cards pulled — no extra column.
export const CARDS_PER_BOOSTER = 10
export const boostersOpened = (totalCards) => Math.floor(totalCards / CARDS_PER_BOOSTER)

/**
 * Exact number of boosters opened in a mode, and how many of them the
 * server's detailed stats cover (booster_openings only exists since
 * migration 0004).
 *   unlimited: the collection only ever grows by whole 10-card packs, so
 *              cards / 10 is exact, older unlogged packs included
 *   challenge: recycling, crafting and trades move cards, so only the
 *              server's count is right (every challenge pack is logged)
 * @param {{ mode: string, totalCards: number, server?: { packs?: number, stats?: object } | null }} input
 * @returns {{ total: number, logged: number, unlogged: number, stats: object | null }}
 */
export function packSummary({ mode, totalCards, server }) {
  const logged = server?.stats?.packs ?? server?.packs ?? 0
  const total = mode === 'challenge' ? logged : Math.max(boostersOpened(totalCards), logged)
  return { total, logged, unlogged: total - logged, stats: server?.stats ?? null }
}

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

export const USERNAME_MIN = 2
export const USERNAME_MAX = 24

/** Returns an error key ('tooShort' | 'tooLong') or null; the name is trimmed first. */
export function validateUsername(name) {
  const trimmed = (name ?? '').trim()
  if (trimmed.length < USERNAME_MIN) return 'tooShort'
  if (trimmed.length > USERNAME_MAX) return 'tooLong'
  return null
}
