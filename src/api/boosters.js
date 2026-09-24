import { supabase } from '@/lib/supabaseClient'

export const BOOSTER_SIZE = 10

// PostgREST's "function not found" code: migration 0003 isn't applied yet
const MISSING_FUNCTION = 'PGRST202'

/**
 * Draws one booster (10 cards) built slot by slot like a real pack — see
 * open_booster() in supabase/migrations/0003_realistic_boosters.sql.
 * @param {string|null} setId - a specific set id, or null for a pack from a random set.
 */
export async function drawBooster(setId) {
  const { data, error } = await supabase.rpc('open_booster', { p_set_id: setId })
  if (error?.code === MISSING_FUNCTION) return drawUniformBooster(setId)
  if (error) throw error
  return data
}

// Pre-0003 fallback: 10 cards drawn uniformly (far too many rares)
async function drawUniformBooster(setId) {
  console.warn('[boosters] open_booster() not found, run supabase/migrations/0003_realistic_boosters.sql')
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
