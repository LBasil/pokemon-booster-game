import { supabase } from '@/lib/supabaseClient'

// Boards per game mode (Community's Challenge | Unlimited switch). The
// challenge ones rank the separate challenge collection (migration 0007).
export const LEADERBOARDS = {
  challenge: ['challenge_unique', 'challenge_value'],
  unlimited: ['hit_rate', 'best_pull', 'complete_sets'],
}

/** Luck-based leaderboards over public profiles (see leaderboard() in migration 0004). */
export async function fetchLeaderboard(kind, limit = 20) {
  const { data, error } = await supabase.rpc('leaderboard', { p_kind: kind, p_limit: limit })
  if (error) throw error
  return data
}

/**
 * Most recent big pulls by public profiles: both game modes (see `mode`), or
 * only `mode`'s ('challenge' | 'unlimited') when given.
 */
export async function fetchFeed(limit = 30, mode = null) {
  let query = supabase
    .from('pull_feed')
    .select('id, username, card_id, card_name, image_small, bucket, set_id, mode, pulled_at')
    .order('pulled_at', { ascending: false })
    .limit(limit)
  if (mode) query = query.eq('mode', mode)
  const { data, error } = await query
  if (error) throw error
  return data
}

/**
 * Live feed through Supabase Realtime (pull_feed is in the supabase_realtime
 * publication). Returns an unsubscribe function.
 */
export function subscribeToFeed(onPull) {
  const channel = supabase
    .channel('pull-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pull_feed' }, (payload) => onPull(payload.new))
    .subscribe()
  return () => supabase.removeChannel(channel)
}
