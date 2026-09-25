import { supabase } from '@/lib/supabaseClient'

// PostgREST's answer when a function doesn't exist (migration 0008 not applied yet)
const MISSING_FUNCTION = 'PGRST202'

/** Reports the caller's unlocked achievement ids (migration 0008); returns how many were new. */
export async function recordAchievements(ids) {
  const { data, error } = await supabase.rpc('record_achievements', { p_ids: ids })
  if (error) throw error
  return data
}

/**
 * How many players hold each achievement (anonymous counts).
 * @returns {Promise<{ players: number, holders: Record<string, number> } | null>} null before 0008
 */
export async function fetchAchievementRates() {
  const { data, error } = await supabase.rpc('achievement_rates')
  if (error?.code === MISSING_FUNCTION) return null
  if (error) throw error
  return {
    players: data[0]?.players ?? 0,
    holders: Object.fromEntries(data.map((row) => [row.achievement_id, row.holders])),
  }
}
