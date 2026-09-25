// Challenge mode economy. Mirrors supabase/migrations/0005_challenge_mode.sql
// (challenge_recycle_value, challenge_craft_price, challenge_daily_reward,
// open_challenge_booster) — change both together. The server stays the
// authority: these values only drive labels and previews.
import { rarityLabelKey } from '@/utils/rarity'

export const START_COINS = 1000
export const PACK_PRICE = 100
// A hit (ultra or better) is guaranteed at the latest in this pack
export const PITY_AFTER = 10
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
 * @param {{ quantity: number, cards: object }[]} entries - collection rows
 * @returns {{ cards: number, coins: number }}
 */
export function recyclePreview(entries) {
  let cards = 0
  let coins = 0
  for (const entry of entries) {
    const extra = entry.quantity - 1
    if (extra > 0) {
      cards += extra
      coins += extra * recycleValue(entry.cards)
    }
  }
  return { cards, coins }
}

/** Packs left before the pity timer forces a hit (1 = the next one). */
export const packsUntilPity = (packsSinceHit) => Math.max(1, PITY_AFTER - (packsSinceHit ?? 0))

/** Milliseconds until missions and the daily reward reset (00:00 UTC). */
export function msUntilReset(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return next - now.getTime()
}

/** "5 h 12 min" / "12 min" style countdown parts. */
export function countdownParts(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 }
}
