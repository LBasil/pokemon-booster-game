import { supabase } from '@/lib/supabaseClient'

// Achievement data kept by the server, per game mode (migrations 0008 + 0009).
// Every call degrades gracefully while a migration is missing.

// PostgREST's answer when no function matches (migration not applied yet)
const MISSING_FUNCTION = 'PGRST202'

/** Reports the caller's unlocked achievement ids for a mode; returns how many were new. */
export async function recordAchievements(ids, mode = 'unlimited') {
  let { data, error } = await supabase.rpc('record_achievements', { p_ids: ids, p_mode: mode })
  // Before 0009: unlimited only, without the mode parameter
  if (error?.code === MISSING_FUNCTION && mode === 'unlimited') ({ data, error } = await supabase.rpc('record_achievements', { p_ids: ids }))
  if (error) throw error
  return data
}

/**
 * How many players hold each achievement in a mode (anonymous counts).
 * @returns {Promise<{ players: number, holders: Record<string, number> } | null>} null when unavailable
 */
export async function fetchAchievementRates(mode = 'unlimited') {
  let { data, error } = await supabase.rpc('achievement_rates', { p_mode: mode })
  if (error?.code === MISSING_FUNCTION && mode === 'unlimited') ({ data, error } = await supabase.rpc('achievement_rates'))
  if (error?.code === MISSING_FUNCTION) return null
  if (error) throw error
  return {
    players: data[0]?.players ?? 0,
    holders: Object.fromEntries(data.map((row) => [row.achievement_id, row.holders])),
  }
}

/**
 * What the collection alone doesn't tell: ids already unlocked (they stay
 * unlocked) and boosters opened in that mode. Own without a username.
 * @returns {Promise<{ unlocked: string[], packs: number } | null>} null before 0009, or for a private/unknown profile
 */
export async function fetchPlayerAchievements(mode, username = null) {
  const { data, error } = await supabase.rpc('player_achievements', { p_mode: mode, p_username: username })
  if (error?.code === MISSING_FUNCTION) return null
  if (error) throw error
  return data
}
