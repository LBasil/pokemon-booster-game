import { supabase } from '@/lib/supabaseClient'

export const BOOSTER_SIZE = 10

/**
 * Draws one booster's worth of cards.
 * @param {string|null} setId - a specific set id, or null for "any set" boosters.
 */
export async function drawBooster(setId) {
  const { data, error } = setId
    ? await supabase.rpc('random_cards_by_set', { num_cards: BOOSTER_SIZE, p_set_id: setId })
    : await supabase.rpc('random_cards', { num_cards: BOOSTER_SIZE })

  if (error) throw error
  return data
}

/**
 * Opens `count` boosters of the given set (or "any set" if setId is null),
 * drawing each one sequentially so the UI can animate them one at a time.
 * @param {string|null} setId
 * @param {number} count
 * @param {(booster: object[], index: number) => void} [onBoosterOpened]
 */
export async function openBoosters(setId, count, onBoosterOpened) {
  const boosters = []
  for (let i = 0; i < count; i++) {
    const cards = await drawBooster(setId)
    boosters.push(cards)
    onBoosterOpened?.(cards, i)
  }
  return boosters
}

/** Flattens a list of boosters into a single list of cards. */
export function flattenBoosters(boosters) {
  return boosters.flat()
}
