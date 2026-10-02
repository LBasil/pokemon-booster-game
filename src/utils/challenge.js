// Challenge mode economy. Mirrors supabase/migrations/0005_challenge_mode.sql
// (challenge_recycle_value, challenge_craft_price, challenge_daily_reward)
// and 0006_challenge_no_pity.sql (open_challenge_booster) — change both
// together. Packs use the real pull rates (no pity timer). The server stays
// the authority: these values only drive labels and previews.
import { BUCKETS, rarityLabelKey } from '@/utils/rarity'

export const START_COINS = 1000
export const PACK_PRICE = 100
export const GOD_PACK_ODDS = 500

export const RECYCLE_VALUE = { common: 1, uncommon: 2, rare: 5, holo: 15, ultra: 60, secret: 200 }
export const CRAFT_PRICE = { common: 20, uncommon: 40, rare: 100, holo: 300, ultra: 1500, secret: 5000 }

export const recycleValue = (card) => RECYCLE_VALUE[rarityLabelKey(card)] ?? RECYCLE_VALUE.common
export const craftPrice = (card) => CRAFT_PRICE[rarityLabelKey(card)] ?? CRAFT_PRICE.common

/** Daily reward for the nth day in a row: 200, 250 … 500 from day 7. */
export const dailyReward = (streak) => 200 + 50 * Math.min(Math.max(streak, 1) - 1, 6)

/** How many packs `coins` can buy. */
export const affordablePacks = (coins) => Math.max(0, Math.floor((coins ?? 0) / PACK_PRICE))

/**
 * What recycling would give: every copy beyond the first.
 * @param {{ card_id: string, quantity: number, cards: object }[]} entries - collection rows
 * @param {Map<string, number> | null} [picked] - only these card ids, and that
 *   many copies of each, capped at the duplicates (recycle_card_copies, migration 0020)
 * @returns {{ cards: number, coins: number }}
 */
export function recyclePreview(entries, picked = null) {
  let cards = 0
  let coins = 0
  for (const entry of entries) {
    if (picked && !picked.get(entry.card_id)) continue
    const extra = picked ? Math.min(entry.quantity - 1, picked.get(entry.card_id)) : entry.quantity - 1
    if (extra > 0) {
      cards += extra
      coins += extra * recycleValue(entry.cards)
    }
  }
  return { cards, coins }
}

/**
 * The cards that have duplicates, grouped by rarity bucket (commons first,
 * the cheapest to let go), each group by name: the "Choose" recycle list.
 * @returns {{ bucket: string, entries: object[] }[]} only non-empty buckets
 */
export function duplicateGroups(entries) {
  const groups = new Map(BUCKETS.map((bucket) => [bucket, []]))
  for (const entry of entries) {
    if (entry.quantity > 1) groups.get(rarityLabelKey(entry.cards) ?? 'common')?.push(entry)
  }
  return [...groups]
    .filter(([, list]) => list.length)
    .map(([bucket, list]) => ({ bucket, entries: list.sort((a, b) => a.cards.name.localeCompare(b.cards.name) || a.card_id.localeCompare(b.card_id)) }))
}

/** Milliseconds until missions and the daily reward reset (00:00 UTC). */
export function msUntilReset(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return next - now.getTime()
}

/** Milliseconds until the weekly missions reset (Monday 00:00 UTC, migration 0011). */
export function msUntilWeeklyReset(now = new Date()) {
  const daysLeft = (8 - now.getUTCDay()) % 7 || 7 // getUTCDay: 0 = Sunday
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysLeft)
  return next - now.getTime()
}

/** "5 h 12 min" / "12 min" style countdown parts. */
export function countdownParts(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 }
}
