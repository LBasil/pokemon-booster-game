import { supabase } from '@/lib/supabaseClient'

export const BOOSTER_SIZE = 10

// Raised by check_booster_rate() (migration 0005) past 60 packs a minute,
// by both open_my_booster and open_challenge_booster
export const RATE_LIMITED = 'too many boosters opened, slow down a little'

/**
 * Opens one booster: the server draws 10 cards with real pull rates, saves
 * them to the player's collection, logs the opening and posts hits to the
 * public feed, all in one call (open_my_booster(), migration 0004). The
 * client never writes collection rows itself.
 * @param {string|null} setId - a specific set id, or null for a pack from a random set.
 * @returns {Promise<object[]>} the 10 cards, in pack order
 */
export async function openBooster(setId) {
  const { data, error } = await supabase.rpc('open_my_booster', { p_set_id: setId })
  if (error) throw error
  return data
}
